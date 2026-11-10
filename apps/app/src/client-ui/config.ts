// What the builders edit, as pure functions: rules, literal values, a Transform's data and form
// schemas. A shape the plain widgets cannot show reads as `null` or `kept`, and stays as it came.

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const validName = (name: string) => /^[A-Za-z][\w-]*$/.test(name);

// ---------- Literal values ----------

export type ValueKind = 'text' | 'number' | 'boolean' | 'list' | 'null' | 'kept';

export function valueKind(value: unknown): ValueKind {
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value === null) return 'null';
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return 'list';
  return 'kept';
}

export const valueText = (value: unknown): string =>
  Array.isArray(value)
    ? value.join(', ')
    : typeof value === 'string'
      ? value
      : value === null
        ? ''
        : String(value ?? '');

// `undefined` when the text is not a value of this kind.
export function parseValue(kind: ValueKind, text: string): unknown {
  switch (kind) {
    case 'number': {
      const number = Number(text);
      return text.trim() === '' || !Number.isFinite(number) ? undefined : number;
    }
    case 'boolean':
      return text === 'true';
    case 'null':
      return null;
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
  if (kind === 'null') return null;
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

export type Group = 'all' | 'any';

// How the builder shows a rule: a test, a group of rules, or something it has no widget for.
export type RuleView =
  | { kind: 'test'; comparison: Comparison }
  | { kind: 'group'; group: Group; items: unknown[] }
  | { kind: 'kept' };

export function readRule(rule: unknown): RuleView {
  if (isComparison(rule)) return { kind: 'test', comparison: rule };
  if (isRecord(rule) && Object.keys(rule).length === 1) {
    const group = 'all' in rule ? 'all' : 'any' in rule ? 'any' : null;
    const items = group ? rule[group] : undefined;
    if (group && Array.isArray(items) && items.length > 0) return { kind: 'group', group, items };
  }
  return { kind: 'kept' };
}

// Groups nest at most this deep; the server refuses deeper rules.
export const ruleDepth = 4;

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

// The bounded calculations a template may hold (server workflows/document.ts), with how many
// operands each takes and what the builder calls it.
export const operations: Record<string, { arity: 1 | 2; label: string }> = {
  $add: { arity: 2, label: 'Add' },
  $subtract: { arity: 2, label: 'Subtract' },
  $multiply: { arity: 2, label: 'Multiply' },
  $length: { arity: 1, label: 'Count the items of' },
  $at: { arity: 2, label: 'The item of a list at' },
};

export type DataValue =
  | { kind: 'binding'; name: string }
  | { kind: 'value'; value: unknown }
  // A group of fields, which may hold bindings again.
  | { kind: 'object' }
  // A calculation from operands, each of which is a template again.
  | { kind: 'operation'; operation: string; operands: unknown[] }
  // Such as a list of objects. It stays as it came.
  | { kind: 'kept' };

export function readDataValue(value: unknown): DataValue {
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && typeof value['$binding'] === 'string')
      return { kind: 'binding', name: value['$binding'] };
    if (keys.length === 1 && Object.hasOwn(operations, keys[0]!)) {
      const operation = keys[0]!;
      const argument = value[operation];
      const operands = operations[operation]!.arity === 1 ? [argument] : argument;
      if (Array.isArray(operands) && operands.length === operations[operation]!.arity)
        return { kind: 'operation', operation, operands };
      return { kind: 'kept' };
    }
    return keys.some((key) => key.startsWith('$')) ? { kind: 'kept' } : { kind: 'object' };
  }
  return valueKind(value) === 'kept' ? { kind: 'kept' } : { kind: 'value', value };
}

// The calculation `operation` with these operands, keeping what still fits of the old ones.
export function withOperation(operation: string, operands: unknown[]): Raw {
  const arity = operations[operation]!.arity;
  const kept = [...operands, operation === '$at' ? 0 : 1].slice(0, arity);
  return { [operation]: arity === 1 ? kept[0] : kept };
}

// Where a template's calculations are malformed, as the server reports it at publish.
export function operationProblems(template: unknown, at = ''): { at: string; message: string }[] {
  if (Array.isArray(template))
    return template.flatMap((item, index) => operationProblems(item, `${at}/${index}`));
  if (!isRecord(template)) return [];
  const entries = Object.entries(template);
  const [key, argument] = entries[0] ?? [];
  if (entries.length === 1 && key!.startsWith('$') && key !== '$binding') {
    const known = Object.hasOwn(operations, key!) ? operations[key!]! : undefined;
    if (!known)
      return [
        { at, message: `Unknown operation ${key}. Use ${Object.keys(operations).join(', ')}.` },
      ];
    const operands = known.arity === 1 ? [argument] : argument;
    if (!Array.isArray(operands) || operands.length !== known.arity)
      return [
        {
          at: `${at}/${key}`,
          message: `${key} takes ${known.arity === 1 ? 'one operand' : `a list of ${known.arity} operands`}.`,
        },
      ];
    return operands.flatMap((item, index) =>
      operationProblems(item, known.arity === 1 ? `${at}/${key}` : `${at}/${key}/${index}`),
    );
  }
  return entries.flatMap(([name, child]) => operationProblems(child, `${at}/${name}`));
}

// ---------- Run variables ----------

// A variable's key, as the server accepts it.
export const variableKey = (key: string) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key);

// The keys Set variable nodes write, in the order they appear.
export function writtenKeys(nodes: { type: string; config: Raw }[]): string[] {
  const keys = nodes
    .filter((node) => node.type === 'set_variable' && typeof node.config['key'] === 'string')
    .map((node) => node.config['key'] as string)
    .filter(Boolean);
  return [...new Set(keys)];
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

export type FieldKind = 'text' | 'number' | 'integer' | 'boolean' | 'choice' | 'object' | 'array';

export interface SchemaField {
  name: string;
  schema: Raw;
  required: boolean;
  // null for what has no widget, such as a oneOf. It stays as it came.
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
    case 'object':
      return schema['properties'] === undefined || isRecord(schema['properties']) ? 'object' : null;
    case 'array':
      return isRecord(schema['items']) ? 'array' : null;
    default:
      return null;
  }
};

export const kindOf = (schema: unknown): FieldKind | null =>
  isRecord(schema) ? fieldKind(schema) : null;

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
  if (kind === 'object') return { ...shared, type: 'object', properties: {} };
  if (kind === 'array') return { ...shared, type: 'array', items: { type: 'string' } };
  return { ...shared, type: kind };
}

// A schema with nothing in it is left out, except where the node requires one. Other keywords
// are constraints the widgets do not show, so they keep it.
export const emptyToUndefined = (schema: Raw): Raw | undefined =>
  Object.keys(propertiesOf(schema)).length === 0 &&
  Object.keys(schema).every((key) => key === 'type' || key === 'properties')
    ? undefined
    : schema;

// A form the run input can render with widgets rather than asking for JSON: the human form
// dialect, which the request form already renders.
export function plainForm(schema: unknown): boolean {
  return isRecord(schema) && schema['type'] === 'object' && formProblem(schema) === null;
}

// ---------- Human forms ----------

// The server's form dialect (server workflows/forms.ts): the same problems, with the same pointers.
const formKeywords: Record<string, readonly string[]> = {
  string: ['minLength', 'maxLength', 'pattern', 'format', 'enum'],
  number: ['minimum', 'maximum', 'enum'],
  integer: ['minimum', 'maximum', 'enum'],
  boolean: [],
  object: ['properties', 'required', 'additionalProperties'],
  array: ['items', 'minItems', 'maxItems'],
};
const formCommon = ['type', 'title', 'description', 'default'];
export const formFormats = ['date', 'date-time', 'email', 'uri'];
// Objects and arrays nest at most this deep in a form.
export const formDepth = 4;

export function formProblem(form: unknown): { at: string; message: string } | null {
  const visit = (
    node: unknown,
    at: string,
    depth: number,
  ): { at: string; message: string } | null => {
    if (!isRecord(node)) return { at, message: 'A form field must be a schema object.' };
    const type = node['type'];
    if (typeof type !== 'string' || !(type in formKeywords))
      return {
        at: `${at}/type`,
        message: 'Use string, number, integer, boolean, object or array.',
      };
    const allowed = new Set([...formCommon, ...formKeywords[type]!]);
    const extra = Object.keys(node).find((key) => !allowed.has(key));
    if (extra)
      return { at: `${at}/${extra}`, message: `Forms do not support ${extra} on ${type}.` };
    if (typeof node['format'] === 'string' && !formFormats.includes(node['format']))
      return { at: `${at}/format`, message: 'Use date, date-time, email or uri.' };
    if (type === 'object') {
      if (depth >= formDepth) return { at, message: `Forms nest at most ${formDepth} levels.` };
      if (node['additionalProperties'] !== undefined && node['additionalProperties'] !== false)
        return {
          at: `${at}/additionalProperties`,
          message: 'Form objects accept only their fields.',
        };
      const properties = node['properties'] ?? {};
      if (!isRecord(properties))
        return { at: `${at}/properties`, message: 'properties must be an object.' };
      for (const [name, child] of Object.entries(properties)) {
        const found = visit(child, `${at}/properties/${name}`, depth + 1);
        if (found) return found;
      }
    }
    if (type === 'array') {
      if (depth >= formDepth) return { at, message: `Forms nest at most ${formDepth} levels.` };
      if (node['items'] === undefined) return { at, message: 'An array field needs items.' };
      return visit(node['items'], `${at}/items`, depth + 1);
    }
    return null;
  };
  if (!isRecord(form) || form['type'] !== 'object')
    return { at: '', message: 'A form is an object schema.' };
  return visit(form, '', 0);
}

// ---------- What a node's form does not show ----------

// Settings each node type has (server workflows/nodes.ts). Anything else in a config is shown as
// advanced and kept; the server refuses it at publish.
export const configKeys: Record<string, readonly string[]> = {
  manual_trigger: ['inputSchema'],
  transform: ['data'],
  agent: ['goal', 'model', 'readOnly', 'resultSchema', 'limits', 'session', 'reports', 'handoffs'],
  wait: ['durationMs', 'until'],
  condition: ['when'],
  switch: ['cases'],
  human_input: ['title', 'instructions', 'timeoutMs', 'form'],
  approval: ['title', 'instructions', 'timeoutMs', 'form', 'outcomes'],
  set_variable: ['key', 'value'],
  get_variable: ['key', 'optional', 'fallback'],
  end: ['outcome', 'reason'],
  command: [
    'mode',
    'executable',
    'args',
    'script',
    'cwd',
    'env',
    'credentials',
    'timeoutMs',
    'maxOutputBytes',
    'parseJson',
    'safeToRetry',
  ],
  http: [
    'method',
    'url',
    'headers',
    'credentialHeaders',
    'body',
    'timeoutMs',
    'maxResponseBytes',
    'responseSchema',
    'followRedirects',
    'safeToRetry',
  ],
  script: ['source', 'timeoutMs', 'resultSchema', 'safeToRetry'],
  git_status: ['maxEntries'],
  git_diff: ['against', 'paths', 'maxBytes'],
  git_create_branch: ['name'],
  git_commit: ['message', 'allowEmpty'],
  git_push: ['remote', 'branch', 'remoteBranch', 'transport', 'timeoutMs'],
  github_get_pr: ['number', 'head'],
  github_create_pr: ['head', 'base', 'title', 'body', 'draft'],
  github_update_pr: ['number', 'title', 'body', 'base', 'state'],
  github_verify_checks: ['commit', 'checks'],
  github_wait_checks: ['commit', 'checks', 'timeoutMs', 'intervalMs'],
  github_merge: ['number', 'method', 'expectedCommit', 'commitTitle', 'commitMessage'],
};

export function unknownConfig(type: string, config: Raw): Raw {
  const known = configKeys[type];
  if (!known) return {};
  return Object.fromEntries(Object.entries(config).filter(([key]) => !known.includes(key)));
}

// An HTTP node's config with another method. A read (GET, the default, HEAD or OPTIONS) has no
// body, so choosing one drops the body in the same edit instead of leaving a hidden one behind.
export function withMethod(config: Raw, method: string | undefined): Raw {
  const { method: _method, body, ...rest } = config;
  const reads = method === undefined || ['GET', 'HEAD', 'OPTIONS'].includes(method);
  return {
    ...rest,
    ...(method === undefined || method === 'GET' ? {} : { method }),
    ...(body === undefined || reads ? {} : { body }),
  };
}
