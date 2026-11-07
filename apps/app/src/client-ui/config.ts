// What the builders edit, as pure functions: rules, literal values, a Transform's data and form
// schemas. A shape the plain widgets cannot show reads as `null` or `kept`, and stays as it came.

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const validName = (name: string) => /^[A-Za-z][\w-]*$/.test(name);

// ---------- Literal values ----------

export type ValueKind = 'text' | 'number' | 'boolean' | 'list' | 'kept';

export function valueKind(value: unknown): ValueKind {
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return 'list';
  return 'kept';
}

export const valueText = (value: unknown): string =>
  Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : String(value ?? '');

// `undefined` when the text is not a value of this kind.
export function parseValue(kind: ValueKind, text: string): unknown {
  switch (kind) {
    case 'number': {
      const number = Number(text);
      return text.trim() === '' || !Number.isFinite(number) ? undefined : number;
    }
    case 'boolean':
      return text === 'true';
    case 'list':
      return text
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    default:
      return text;
  }
}

// What a value becomes when its kind is changed: as much of it as still fits.
export function convertValue(value: unknown, kind: ValueKind): unknown {
  return parseValue(kind, valueText(value)) ?? (kind === 'number' ? 0 : kind === 'list' ? [] : '');
}

// ---------- Paths ----------

// A path as the owner types it. A key holding a dot has no plain form, so it is not offered.
export const pathEditable = (path: unknown): boolean =>
  path === undefined ||
  (Array.isArray(path) && path.every((key) => typeof key === 'string' && !key.includes('.')));

export const pathText = (path: unknown): string => (Array.isArray(path) ? path.join('.') : '');

export const parsePath = (text: string): string[] =>
  text
    .split('.')
    .map((key) => key.trim())
    .filter(Boolean);

// ---------- Rules ----------

export type Operand = { binding: string } | { value: unknown };
export interface Comparison {
  op: string;
  left: Operand;
  right?: Operand;
}
export interface RuleShape {
  group: 'all' | 'any';
  items: Comparison[];
}

export const operators: [string, string][] = [
  ['eq', 'is'],
  ['ne', 'is not'],
  ['lt', 'is less than'],
  ['lte', 'is at most'],
  ['gt', 'is more than'],
  ['gte', 'is at least'],
  ['contains', 'contains'],
  ['in', 'is one of'],
  ['exists', 'exists'],
];

const isOperand = (value: unknown): value is Operand =>
  isRecord(value) && ('binding' in value || 'value' in value);

const isComparison = (value: unknown): value is Comparison =>
  isRecord(value) &&
  typeof value['op'] === 'string' &&
  isOperand(value['left']) &&
  (value['right'] === undefined || isOperand(value['right']));

// A rule the builder can show: one comparison, or one group of them. Deeper groups read as null.
export function readRule(rule: unknown): RuleShape | null {
  if (isComparison(rule)) return { group: 'all', items: [rule] };
  if (!isRecord(rule)) return null;
  const group = 'all' in rule ? 'all' : 'any' in rule ? 'any' : null;
  if (!group) return null;
  const items = rule[group];
  return Array.isArray(items) && items.length > 0 && items.every(isComparison)
    ? { group, items }
    : null;
}

export const writeRule = ({ group, items }: RuleShape): unknown =>
  items.length === 1 ? items[0] : { [group]: items };

export const blankComparison = (bindings: string[]): Comparison => ({
  op: 'eq',
  left: bindings[0] ? { binding: bindings[0] } : { value: '' },
  right: { value: '' },
});

// The operator decides how many operands there are, and `in` compares against a list.
export function withOperator(comparison: Comparison, op: string): Comparison {
  const { right, ...rest } = comparison;
  if (op === 'exists') return { ...rest, op };
  const given = right ?? { value: '' };
  return {
    ...rest,
    op,
    right:
      'value' in given
        ? { value: convertValue(given.value, op === 'in' ? 'list' : textOr(given.value)) }
        : given,
  };
}

// Leaving a list keeps text; other values stay of their own kind.
const textOr = (value: unknown): ValueKind => {
  const kind = valueKind(value);
  return kind === 'list' || kind === 'kept' ? 'text' : kind;
};

export function ruleBindings(rule: unknown): string[] {
  if (!isRecord(rule)) return [];
  if (Array.isArray(rule['all'])) return rule['all'].flatMap(ruleBindings);
  if (Array.isArray(rule['any'])) return rule['any'].flatMap(ruleBindings);
  return [rule['left'], rule['right']].flatMap((side) =>
    isRecord(side) && typeof side['binding'] === 'string' ? [side['binding']] : [],
  );
}

export function renameRuleBinding(rule: unknown, from: string, to: string): unknown {
  if (!isRecord(rule)) return rule;
  const copy: Raw = { ...rule };
  for (const group of ['all', 'any'])
    if (Array.isArray(copy[group]))
      copy[group] = (copy[group] as unknown[]).map((item) => renameRuleBinding(item, from, to));
  for (const side of ['left', 'right']) {
    const operand = copy[side];
    if (isRecord(operand) && operand['binding'] === from) copy[side] = { ...operand, binding: to };
  }
  return copy;
}

// Follows a renamed binding through a template: `{"$binding": name}` objects and `{{name}}` text.
export function renameTemplateBinding(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string')
    return value.replace(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g, (match, name) =>
      name === from ? `{{${to}}}` : match,
    );
  if (Array.isArray(value)) return value.map((item) => renameTemplateBinding(item, from, to));
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 1 && entries[0]![0] === '$binding')
      return entries[0]![1] === from ? { $binding: to } : value;
    return Object.fromEntries(
      entries.map(([key, child]) => [key, renameTemplateBinding(child, from, to)]),
    );
  }
  return value;
}

// ---------- A Transform's data ----------

export type DataValue =
  | { kind: 'binding'; name: string }
  | { kind: 'value'; value: unknown }
  // Nested, so it has no plain field. It stays as it came.
  | { kind: 'kept' };

export function readDataValue(value: unknown): DataValue {
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && typeof value['$binding'] === 'string')
      return { kind: 'binding', name: value['$binding'] };
    return { kind: 'kept' };
  }
  return valueKind(value) === 'kept' ? { kind: 'kept' } : { kind: 'value', value };
}

// Rewrites one key where it stands, so the fields keep their order.
export function renameKey(record: Raw, from: string, to: string): Raw {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key === from ? to : key, value]),
  );
}

export function freeName(base: string, used: Iterable<string>): string {
  const taken = new Set(used);
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) if (!taken.has(`${base}_${suffix}`)) return `${base}_${suffix}`;
}

// ---------- Form schemas ----------

export type FieldKind = 'text' | 'number' | 'integer' | 'boolean' | 'choice';

export interface SchemaField {
  name: string;
  schema: Raw;
  required: boolean;
  // null for what has no plain widget: nested objects and arrays. It stays as it came.
  kind: FieldKind | null;
}

const fieldKind = (schema: Raw): FieldKind | null => {
  switch (schema['type']) {
    case 'string':
      return Array.isArray(schema['enum']) ? 'choice' : 'text';
    case 'number':
    case 'integer':
    case 'boolean':
      return schema['type'];
    default:
      return null;
  }
};

// The fields of an object schema; null for a schema that is not one, like `true` or a `oneOf`.
export function readFields(schema: unknown): SchemaField[] | null {
  if (schema === undefined) return [];
  if (!isRecord(schema) || schema['type'] !== 'object') return null;
  if (schema['properties'] !== undefined && !isRecord(schema['properties'])) return null;
  const required = Array.isArray(schema['required']) ? schema['required'] : [];
  return Object.entries((schema['properties'] ?? {}) as Raw).map(([name, child]) => ({
    name,
    schema: isRecord(child) ? child : {},
    required: required.includes(name),
    kind: isRecord(child) ? fieldKind(child) : null,
  }));
}

const objectSchema = (schema: unknown): Raw =>
  isRecord(schema) ? schema : { type: 'object', properties: {} };

const propertiesOf = (schema: Raw) => (isRecord(schema['properties']) ? schema['properties'] : {});

const withRequired = (schema: Raw, required: string[]): Raw => {
  const { required: _old, ...rest } = schema;
  return required.length ? { ...rest, required } : rest;
};

const requiredOf = (schema: Raw): string[] =>
  Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];

export function addField(schema: unknown): Raw {
  const current = objectSchema(schema);
  const properties = propertiesOf(current);
  const name = freeName('field', Object.keys(properties));
  return { ...current, properties: { ...properties, [name]: { type: 'string' } } };
}

export function removeField(schema: unknown, name: string): Raw {
  const current = objectSchema(schema);
  const { [name]: _gone, ...properties } = propertiesOf(current);
  return withRequired(
    { ...current, properties },
    requiredOf(current).filter((item) => item !== name),
  );
}

export function renameField(schema: unknown, from: string, to: string): Raw {
  const current = objectSchema(schema);
  return withRequired(
    { ...current, properties: renameKey(propertiesOf(current), from, to) },
    requiredOf(current).map((item) => (item === from ? to : item)),
  );
}

export function setRequired(schema: unknown, name: string, required: boolean): Raw {
  const current = objectSchema(schema);
  const others = requiredOf(current).filter((item) => item !== name);
  return withRequired(current, required ? [...others, name] : others);
}

export function setField(schema: unknown, name: string, field: Raw): Raw {
  const current = objectSchema(schema);
  return { ...current, properties: { ...propertiesOf(current), [name]: field } };
}

// Keeps what every type shares; keywords of the old type would not apply to the new one.
export function withKind(field: Raw, kind: FieldKind): Raw {
  const shared = Object.fromEntries(
    Object.entries(field).filter(([key]) => key === 'title' || key === 'description'),
  );
  if (kind === 'text') return { ...shared, type: 'string' };
  if (kind === 'choice') return { ...shared, type: 'string', enum: [] };
  return { ...shared, type: kind };
}

// A schema with nothing in it is left out, except where the node requires one. Other keywords
// are constraints the widgets do not show, so they keep it.
export const emptyToUndefined = (schema: Raw): Raw | undefined =>
  Object.keys(propertiesOf(schema)).length === 0 &&
  Object.keys(schema).every((key) => key === 'type' || key === 'properties')
    ? undefined
    : schema;

// A form the run input can render with widgets rather than asking for JSON.
export function plainForm(schema: unknown): boolean {
  if (!isRecord(schema) || schema['type'] !== 'object') return false;
  const known = new Set(['type', 'properties', 'required', 'additionalProperties']);
  if (Object.keys(schema).some((key) => !known.has(key))) return false;
  return Object.values(propertiesOf(schema)).every(
    (child) => isRecord(child) && fieldKind(child) !== null,
  );
}
