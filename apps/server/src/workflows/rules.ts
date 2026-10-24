import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';

// Declarative rules for Condition and Switch nodes (specification 6.2 and 8). A rule is one typed
// comparison or an `all` / `any` group. Operands are a binding the node declares or a literal, so a
// rule never reads anything its bindings did not freeze.

export type Operand = { binding: string } | { value: Json };
export type Comparison = {
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'in' | 'exists';
  left: Operand;
  right?: Operand;
};
export type Rule = { all: Rule[] } | { any: Rule[] } | Comparison;

const operand = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['binding'],
      properties: { binding: { type: 'string', pattern: '^[A-Za-z][\\w-]*$' } },
    },
    { type: 'object', additionalProperties: false, required: ['value'], properties: { value: {} } },
  ],
};

// Definitions for node configuration schemas, which must place them at their root: `$ref`
// resolves against the schema root.
export const ruleDefs = {
  rule: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['all'],
        properties: {
          all: { type: 'array', minItems: 1, maxItems: 50, items: { $ref: '#/$defs/rule' } },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['any'],
        properties: {
          any: { type: 'array', minItems: 1, maxItems: 50, items: { $ref: '#/$defs/rule' } },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'left'],
        properties: {
          op: { enum: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'in', 'exists'] },
          left: operand,
          right: operand,
        },
      },
    ],
  },
};
export const ruleRef = { $ref: '#/$defs/rule' };

const maxDepth = 4;

// Problems the schema cannot express: nesting depth, a missing right operand, and bindings the
// node does not declare. Each is a JSON pointer below `at` and a message.
export function ruleProblems(
  rule: Rule,
  declared: ReadonlySet<string>,
  at: string,
): Array<{ at: string; message: string }> {
  const problems: Array<{ at: string; message: string }> = [];
  const visit = (node: Rule, path: string, depth: number) => {
    if ('all' in node || 'any' in node) {
      const [key, children] = 'all' in node ? ['all', node.all] : ['any', node.any];
      if (depth >= maxDepth) {
        problems.push({ at: path, message: `Rules nest at most ${maxDepth} groups deep.` });
        return;
      }
      children.forEach((child, index) => visit(child, `${path}/${key}/${index}`, depth + 1));
      return;
    }
    if (node.op !== 'exists' && node.right === undefined) {
      problems.push({ at: `${path}/right`, message: `${node.op} compares two operands.` });
    }
    if (node.op === 'exists' && node.right !== undefined) {
      problems.push({ at: `${path}/right`, message: 'exists takes one operand.' });
    }
    for (const side of ['left', 'right'] as const) {
      const value = node[side];
      if (value && 'binding' in value && !declared.has(value.binding)) {
        problems.push({
          at: `${path}/${side}/binding`,
          message: `The rule uses undeclared binding ${value.binding}.`,
        });
      }
    }
  };
  visit(rule, at, 0);
  return problems;
}

const equal = (a: Json | undefined, b: Json | undefined): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => equal(item, b[index]))
    );
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => key in b && equal(a[key], (b as Record<string, Json>)[key]))
  );
};

const describe = (value: Json | undefined) =>
  value === undefined || value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

// Evaluates a rule against the execution's frozen bindings. Operands of the wrong type fail the
// node instead of evaluating to false, so a mistyped binding never silently picks a branch.
export function evaluateRule(rule: Rule, bindings: Record<string, Json>): boolean {
  if ('all' in rule) return rule.all.every((child) => evaluateRule(child, bindings));
  if ('any' in rule) return rule.any.some((child) => evaluateRule(child, bindings));
  const read = (side: Operand | undefined): Json | undefined =>
    side === undefined ? undefined : 'binding' in side ? bindings[side.binding] : side.value;
  const left = read(rule.left);
  const right = read(rule.right);
  const mismatch = () =>
    new ShiftError(
      'CONDITION_TYPE',
      `${rule.op} cannot compare ${describe(left)} with ${describe(right)}.`,
      422,
    );
  switch (rule.op) {
    case 'exists':
      return left !== undefined && left !== null;
    case 'eq':
      return equal(left, right);
    case 'ne':
      return !equal(left, right);
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      const comparable =
        (typeof left === 'number' && typeof right === 'number') ||
        (typeof left === 'string' && typeof right === 'string');
      if (!comparable) throw mismatch();
      const [a, b] = [left, right] as [number | string, number | string];
      return rule.op === 'lt'
        ? a < b
        : rule.op === 'lte'
          ? a <= b
          : rule.op === 'gt'
            ? a > b
            : a >= b;
    }
    case 'contains':
      if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
      if (Array.isArray(left)) return left.some((item) => equal(item, right));
      throw mismatch();
    case 'in':
      if (!Array.isArray(right)) throw mismatch();
      return right.some((item) => equal(item, left));
  }
}
