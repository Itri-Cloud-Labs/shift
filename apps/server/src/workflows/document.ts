import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import { assertResultSchema } from '../runs/envelope.js';
import { formProblem } from './forms.js';
import { ruleProblems, type Rule } from './rules.js';
import { nodeType } from './nodes.js';

// The serialized workflow graph (server specification section 5). Renderer positions are
// presentation data; nothing about execution depends on them.

export type ValueSource =
  | { kind: 'literal'; value: Json }
  | { kind: 'input'; path: string[] }
  | { kind: 'trigger'; path: string[] }
  | { kind: 'project'; path: string[] }
  | {
      kind: 'node';
      nodeId: string;
      // The nearest or earliest successful execution on this run's path, or exactly one of them.
      execution: 'latest' | 'first' | { sequence: number } | { executionId: string };
      path: string[];
      optional?: boolean;
      fallback?: Json;
    };

export interface NodeDefinition {
  id: string;
  type: string;
  typeVersion: number;
  config: Json;
  bindings: Record<string, ValueSource>;
  retry: { maxAttempts: number; initialDelayMs: number; maxDelayMs: number };
  limits: { maxExecutionsPerRun: number };
  position: { x: number; y: number };
}

export interface ConnectionDefinition {
  id: string;
  fromNodeId: string;
  fromPort: string;
  toNodeId: string;
  toPort: 'input';
}

export interface WorkflowDocument {
  formatVersion: 1;
  execution: {
    workspace: { kind: 'new' };
    overlap: 'allow';
    limits: { maxExecutions: number; maxActiveMs: number };
  };
  nodes: NodeDefinition[];
  connections: ConnectionDefinition[];
  presentation: { viewport?: { x: number; y: number; zoom: number } };
}

export const maxDocumentBytes = 1024 * 1024;
const maxDepth = 32;
const identifier = '^[A-Za-z][A-Za-z0-9_-]{0,63}$';
const path = { type: 'array', items: { type: 'string', maxLength: 256 }, maxItems: 32 };

// Fills omitted defaults so hand-written documents stay short. The stored draft is normalized.
export function normalizeDocument(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const document = input as Record<string, unknown>;
  const execution = (document['execution'] ?? {}) as Record<string, unknown>;
  const nodes = document['nodes'];
  return {
    formatVersion: document['formatVersion'] ?? 1,
    ...document,
    execution: {
      workspace: { kind: 'new' },
      overlap: 'allow',
      ...execution,
      limits: {
        maxExecutions: 1000,
        maxActiveMs: 4 * 60 * 60 * 1000,
        ...((execution['limits'] as object | undefined) ?? {}),
      },
    },
    nodes: Array.isArray(nodes)
      ? nodes.map((node: unknown, index: number) =>
          typeof node === 'object' && node !== null
            ? {
                typeVersion: 1,
                config: {},
                bindings: {},
                retry: { maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 60000 },
                limits: { maxExecutionsPerRun: 50 },
                position: { x: index * 240, y: 0 },
                ...node,
              }
            : node,
        )
      : nodes,
    connections: document['connections'] ?? [],
    presentation: document['presentation'] ?? {},
  };
}

const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false });
const validateShape = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['formatVersion', 'execution', 'nodes', 'connections', 'presentation'],
  properties: {
    formatVersion: { const: 1 },
    execution: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace', 'overlap', 'limits'],
      properties: {
        workspace: {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { type: 'string' } },
        },
        overlap: { type: 'string' },
        limits: {
          type: 'object',
          additionalProperties: false,
          required: ['maxExecutions', 'maxActiveMs'],
          properties: {
            maxExecutions: { type: 'integer', minimum: 1, maximum: 100000 },
            maxActiveMs: { type: 'integer', minimum: 1000 },
          },
        },
      },
    },
    nodes: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'type',
          'typeVersion',
          'config',
          'bindings',
          'retry',
          'limits',
          'position',
        ],
        properties: {
          id: { type: 'string', pattern: identifier },
          type: { type: 'string', maxLength: 100 },
          typeVersion: { type: 'integer', minimum: 1 },
          config: {},
          bindings: {
            type: 'object',
            propertyNames: { pattern: identifier },
            additionalProperties: {
              type: 'object',
              required: ['kind'],
              properties: { kind: { type: 'string' } },
            },
          },
          retry: {
            type: 'object',
            additionalProperties: false,
            required: ['maxAttempts', 'initialDelayMs', 'maxDelayMs'],
            properties: {
              maxAttempts: { type: 'integer', minimum: 1, maximum: 100 },
              initialDelayMs: { type: 'integer', minimum: 0, maximum: 86_400_000 },
              maxDelayMs: { type: 'integer', minimum: 0, maximum: 86_400_000 },
            },
          },
          limits: {
            type: 'object',
            additionalProperties: false,
            required: ['maxExecutionsPerRun'],
            properties: { maxExecutionsPerRun: { type: 'integer', minimum: 1, maximum: 10000 } },
          },
          position: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: { x: { type: 'number' }, y: { type: 'number' } },
          },
        },
      },
    },
    connections: {
      type: 'array',
      maxItems: 2000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'fromNodeId', 'fromPort', 'toNodeId', 'toPort'],
        properties: {
          id: { type: 'string', pattern: identifier },
          fromNodeId: { type: 'string' },
          fromPort: { type: 'string', maxLength: 100 },
          toNodeId: { type: 'string' },
          toPort: { const: 'input' },
        },
      },
    },
    presentation: { type: 'object' },
  },
});

const validateSource = ajv.compile({
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'value'],
      properties: { kind: { const: 'literal' }, value: {} },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'path'],
      properties: { kind: { enum: ['input', 'trigger', 'project'] }, path },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'nodeId', 'execution', 'path'],
      properties: {
        kind: { const: 'node' },
        nodeId: { type: 'string' },
        execution: {
          oneOf: [
            { enum: ['latest', 'first'] },
            {
              type: 'object',
              additionalProperties: false,
              required: ['sequence'],
              properties: { sequence: { type: 'integer', minimum: 1 } },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['executionId'],
              properties: { executionId: { type: 'string', minLength: 1, maxLength: 100 } },
            },
          ],
        },
        path,
        optional: { type: 'boolean' },
        fallback: {},
      },
    },
  ],
});

const configValidators = new Map<string, ReturnType<typeof ajv.compile>>();

function depth(value: unknown, level = 0): number {
  if (typeof value !== 'object' || value === null) return level;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.reduce<number>(
    (deepest, child) => Math.max(deepest, depth(child, level + 1)),
    level,
  );
}

// `{{name}}` placeholders in strings and `{"$binding": "name"}` objects in templates.
// An ISO 8601 date and time with an explicit offset, as milliseconds since the epoch. Times without
// an offset are refused, so a deadline never depends on the server's time zone.
export function parseDeadline(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    return null;
  }
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

export function templateBindings(value: unknown): string[] {
  if (typeof value === 'string')
    return [...value.matchAll(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g)].map((m) => m[1]!);
  if (Array.isArray(value)) return value.flatMap(templateBindings);
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    if (
      entries.length === 1 &&
      entries[0]![0] === '$binding' &&
      typeof entries[0]![1] === 'string'
    ) {
      return [entries[0]![1]];
    }
    return entries.flatMap(([, child]) => templateBindings(child));
  }
  return [];
}

export interface Diagnostic {
  path: string;
  message: string;
}

// Structural and semantic checks a document must pass to be published or started. Features of
// later milestones are rejected explicitly instead of being stored and ignored.
export function diagnose(document: unknown): Diagnostic[] {
  const text = JSON.stringify(document) ?? '';
  if (Buffer.byteLength(text) > maxDocumentBytes) {
    return [{ path: '/', message: 'The document exceeds 1 MiB.' }];
  }
  if (depth(document) > maxDepth)
    return [{ path: '/', message: 'The document nests deeper than 32 levels.' }];
  if (!validateShape(document)) {
    return (validateShape.errors ?? []).map((error) => ({
      path: error.instancePath || '/',
      message: error.message ?? 'invalid',
    }));
  }
  const doc = document as WorkflowDocument;
  const problems: Diagnostic[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });
  if (doc.execution.workspace.kind !== 'new') {
    add(
      '/execution/workspace',
      'Only new workspaces are supported until workspace allocation (M08).',
    );
  }
  if (doc.execution.overlap !== 'allow') {
    add('/execution/overlap', 'Overlap policies arrive with triggers and admission (M12).');
  }
  const ids = new Set<string>();
  const entries: string[] = [];
  doc.nodes.forEach((node, index) => {
    const at = `/nodes/${index}`;
    if (ids.has(node.id)) add(`${at}/id`, `Duplicate node id ${node.id}.`);
    ids.add(node.id);
    const type = nodeType(node.type, node.typeVersion);
    if (!type) {
      add(`${at}/type`, `Unknown node type ${node.type} version ${node.typeVersion}.`);
      return;
    }
    if (type.entry) entries.push(node.id);
    const key = `${type.type}@${type.version}`;
    let validate = configValidators.get(key);
    if (!validate) configValidators.set(key, (validate = ajv.compile(type.configSchema)));
    if (!validate(node.config)) {
      for (const error of validate.errors ?? []) {
        add(`${at}/config${error.instancePath}`, error.message ?? 'invalid');
      }
      return;
    }
    const config = node.config as Record<string, Json>;
    for (const field of ['resultSchema', 'inputSchema'] as const) {
      if (config[field] === undefined) continue;
      try {
        assertResultSchema(config[field]);
      } catch {
        add(`${at}/config/${field}`, 'Not a valid JSON Schema 2020-12 document.');
      }
    }
    if (
      node.type === 'wait' &&
      (config['durationMs'] === undefined) === (config['until'] === undefined)
    ) {
      add(`${at}/config`, 'A wait needs either durationMs or until.');
    } else if (
      typeof config['until'] === 'string' &&
      templateBindings(config['until']).length === 0 &&
      parseDeadline(config['until']) === null
    ) {
      add(
        `${at}/config/until`,
        'Not an ISO 8601 time with a UTC offset, such as 2026-11-01T09:00:00Z.',
      );
    }
    if (node.retry.maxDelayMs < node.retry.initialDelayMs) {
      add(`${at}/retry/maxDelayMs`, 'The maximum delay is shorter than the initial delay.');
    }
    for (const [name, source] of Object.entries(node.bindings)) {
      if (!validateSource(source as unknown)) {
        add(
          `${at}/bindings/${name}`,
          (source as { kind: string }).kind === 'variable'
            ? 'Run variables arrive with M04a.'
            : 'Invalid value source.',
        );
      } else if (source.kind === 'node' && !doc.nodes.some((other) => other.id === source.nodeId)) {
        add(`${at}/bindings/${name}/nodeId`, `No node ${source.nodeId}.`);
      } else if (source.kind === 'node' && source.optional && source.fallback === undefined) {
        add(`${at}/bindings/${name}/fallback`, 'An optional binding needs an explicit fallback.');
      }
    }
    const declared = new Set(Object.keys(node.bindings));
    if (node.type === 'condition') {
      for (const problem of ruleProblems(config['when'] as Rule, declared, `${at}/config/when`)) {
        add(problem.at, problem.message);
      }
    }
    if (node.type === 'switch') {
      const ports = new Set<string>();
      (config['cases'] as Array<{ port: string; when: Rule }>).forEach((entry, index) => {
        const where = `${at}/config/cases/${index}`;
        if (ports.has(entry.port)) add(`${where}/port`, `Duplicate case port ${entry.port}.`);
        ports.add(entry.port);
        for (const problem of ruleProblems(entry.when, declared, `${where}/when`)) {
          add(problem.at, problem.message);
        }
      });
    }
    if (typeof config['form'] === 'object' && config['form'] !== null) {
      const problem = formProblem(config['form']);
      if (problem) add(`${at}/config/form${problem.at}`, problem.message);
      else {
        try {
          assertResultSchema(config['form']);
        } catch {
          add(`${at}/config/form`, 'Not a valid JSON Schema 2020-12 document.');
        }
      }
    }
    const templated = ['goal', 'data', 'until', 'title', 'instructions']
      .map((field) => config[field])
      .filter((value) => value !== undefined);
    for (const name of templateBindings(templated)) {
      if (!(name in node.bindings))
        add(`${at}/config`, `The template uses undeclared binding ${name}.`);
    }
  });
  if (entries.length !== 1) {
    add('/nodes', 'A workflow needs exactly one manual_trigger node.');
  }
  const connectionIds = new Set<string>();
  const usedPorts = new Set<string>();
  doc.connections.forEach((connection, index) => {
    const at = `/connections/${index}`;
    if (connectionIds.has(connection.id))
      add(`${at}/id`, `Duplicate connection id ${connection.id}.`);
    connectionIds.add(connection.id);
    const from = doc.nodes.find((node) => node.id === connection.fromNodeId);
    const to = doc.nodes.find((node) => node.id === connection.toNodeId);
    if (!from) add(`${at}/fromNodeId`, `No node ${connection.fromNodeId}.`);
    if (!to) add(`${at}/toNodeId`, `No node ${connection.toNodeId}.`);
    const fromType = from && nodeType(from.type, from.typeVersion);
    const ports = fromType && (fromType.portsFor?.(from.config) ?? fromType.ports);
    if (ports && !ports.includes(connection.fromPort)) {
      add(`${at}/fromPort`, `Node ${from.id} has no port ${connection.fromPort}.`);
    }
    const toType = to && nodeType(to.type, to.typeVersion);
    if (toType?.entry) add(`${at}/toNodeId`, 'Entry nodes cannot be connection targets.');
    // One chosen port and at most one edge for it: two edges are not a fan-out.
    const port = `${connection.fromNodeId}:${connection.fromPort}`;
    if (usedPorts.has(port)) add(at, `Port ${port} already has an outgoing connection.`);
    usedPorts.add(port);
  });
  return problems;
}

export function validateDocument(input: unknown): WorkflowDocument {
  const problems = diagnose(input);
  if (problems.length > 0) {
    throw new ShiftError(
      'INVALID_WORKFLOW',
      `Invalid workflow: ${problems
        .slice(0, 5)
        .map((problem) => `${problem.path} ${problem.message}`)
        .join('; ')}`,
      422,
      false,
      problems.map((problem) => problem.path),
      Object.fromEntries(problems.map((problem) => [problem.path, problem.message])),
    );
  }
  return input as WorkflowDocument;
}

// Key order does not change the hash, so equal documents publish with equal hashes.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const documentHash = (document: WorkflowDocument): string =>
  createHash('sha256').update(canonicalJson(document)).digest('hex');
