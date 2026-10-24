// Registered node types (server specification sections 4.1 and 8). A published version pins each
// node's type version; a type version this server does not implement fails publication and start.
import type { Json } from '../harness/types.js';
import { defaultOutcomes } from './forms.js';

export interface NodeTypeDefinition {
  type: string;
  version: number;
  configSchema: object;
  ports: readonly string[];
  // Ports that depend on the node's configuration, such as an approval's outcomes.
  portsFor?: (config: Json) => readonly string[];
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
const interaction = {
  title: { type: 'string', minLength: 1, maxLength: 200 },
  instructions: { type: 'string', maxLength: 20000 },
  timeoutMs: { type: 'integer', minimum: 1000, maximum: 366 * 24 * 60 * 60 * 1000 },
};

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
    // Asks the owner to fill in `form`. `title` and `instructions` may use `{{name}}` bindings.
    type: 'human_input',
    version: 1,
    ports: ['success', 'timeout', 'error'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'form'],
      properties: { ...interaction, form: { type: 'object' } },
    },
  },
  {
    // Asks the owner to choose one of `outcomes`, each an output port, with an optional form.
    type: 'approval',
    version: 1,
    ports: [...defaultOutcomes, 'timeout', 'error'],
    portsFor: (config) => [
      ...((config as { outcomes?: string[] } | null)?.outcomes ?? defaultOutcomes),
      'timeout',
      'error',
    ],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['title'],
      properties: {
        ...interaction,
        form: { type: 'object' },
        outcomes: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          uniqueItems: true,
          items: {
            type: 'string',
            pattern: '^[a-z][a-z0-9_]{0,39}$',
            not: { enum: ['timeout', 'error'] },
          },
        },
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
