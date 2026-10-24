// Registered node types (server specification sections 4.1 and 8). A published version pins each
// node's type version; a type version this server does not implement fails publication and start.

export interface NodeTypeDefinition {
  type: string;
  version: number;
  configSchema: object;
  ports: readonly string[];
  // Entry nodes start runs and cannot be connection targets.
  entry?: boolean;
}

const limits = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rejectedSubmissions: { type: 'integer', minimum: 1, maximum: 10 },
    corrections: { type: 'integer', minimum: 0, maximum: 5 },
    continuations: { type: 'integer', minimum: 0, maximum: 5 },
  },
};
const schema = { anyOf: [{ type: 'object' }, { type: 'boolean' }] };

export const nodeTypes: readonly NodeTypeDefinition[] = [
  {
    type: 'manual_trigger',
    version: 1,
    entry: true,
    ports: ['success'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { inputSchema: schema },
    },
  },
  {
    // Builds new data from a JSON template: `{"$binding": "<name>"}` is replaced by that binding.
    type: 'transform',
    version: 1,
    ports: ['success', 'error'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['data'],
      properties: { data: {} },
    },
  },
  {
    // `{{name}}` in the goal is replaced by the binding's value; non-strings render as JSON.
    type: 'agent',
    version: 1,
    ports: ['success', 'error'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['goal'],
      properties: {
        goal: { type: 'string', minLength: 1, maxLength: 20000 },
        model: { type: 'string', pattern: '^[^/\\s]+/\\S+$', maxLength: 200 },
        readOnly: { type: 'boolean' },
        resultSchema: schema,
        limits,
      },
    },
  },
  {
    // Waits for `durationMs` or until `until`, an ISO 8601 time with an offset that may use
    // `{{name}}` bindings, then passes its input through. The deadline is fixed when it starts.
    type: 'wait',
    version: 1,
    ports: ['success', 'error'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        durationMs: { type: 'integer', minimum: 0, maximum: 366 * 24 * 60 * 60 * 1000 },
        until: { type: 'string', minLength: 1, maxLength: 200 },
      },
    },
  },
  {
    type: 'end',
    version: 1,
    ports: [],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        outcome: { enum: ['COMPLETED', 'FAILED'] },
        reason: { type: 'string', maxLength: 4000 },
      },
    },
  },
];

export function nodeType(type: string, version: number): NodeTypeDefinition | undefined {
  return nodeTypes.find((candidate) => candidate.type === type && candidate.version === version);
}
