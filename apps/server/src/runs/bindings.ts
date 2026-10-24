import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import type { ValueSource } from '../workflows/document.js';

// Every edge carries one output envelope (specification 5). Shift constructs references and
// context; executors only produce `data`.
export interface OutputEnvelope {
  data: Json;
  references: {
    agentSession?: { kind: 'agent_session'; id: string; projectId: string };
    artifacts: Json[];
  };
  context: { handoffs: Json[] };
}

export const envelope = (data: Json, input?: OutputEnvelope): OutputEnvelope => ({
  data,
  references: { artifacts: [] },
  // Data nodes publish new data and preserve the incoming handoff context.
  // Envelopes written before definitions existed were bare `{ data }`.
  context: { handoffs: input?.context?.handoffs ?? [] },
});

export interface ChainEntry {
  id: string;
  nodeId: string;
  sequence: number;
  output: OutputEnvelope;
}

export interface BindingScope {
  input: OutputEnvelope;
  // The execution that produced `input`, which can be a failed one routed through `error`.
  inputExecutionId: string | null;
  trigger: Json;
  triggerExecutionId: string | null;
  project: Json;
  projectId: string | null;
  // Successful executions on the current predecessor chain, nearest first.
  chain: ChainEntry[];
}

const missing = Symbol('missing');

// JSON paths are token arrays, never evaluated expressions. Numeric tokens index arrays.
export function lookup(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const token of path) {
    if (Array.isArray(current) && /^\d+$/.test(token)) current = current[Number(token)];
    else if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
      current = Object.hasOwn(current, token)
        ? (current as Record<string, unknown>)[token]
        : missing;
    } else return missing;
    if (current === undefined) return missing;
  }
  return current;
}

const bindingError = (name: string, message: string) =>
  new ShiftError('BINDING_MISSING', `Binding ${name}: ${message}`, 422);

// Where a frozen binding value came from, so inspection can name its exact producer.
export type BindingSource =
  | { kind: 'literal' }
  | { kind: 'input' | 'trigger'; executionId: string | null; path: string[] }
  | { kind: 'project'; projectId: string | null; path: string[] }
  | {
      kind: 'node';
      nodeId: string;
      executionId: string | null;
      sequence: number | null;
      path: string[];
      fallback?: true;
    };

// Resolution never runs a producer. A missing required value fails before the executor runs; an
// optional node reference falls back only when the value is missing. An explicit execution selector
// must name an earlier successful execution on this run's path: anything else is a wrong selector,
// not a missing value, so it fails even when the binding is optional.
export function resolveBindings(
  bindings: Record<string, ValueSource>,
  scope: BindingScope,
): { values: Record<string, Json>; sources: Record<string, BindingSource> } {
  const values: Record<string, Json> = {};
  const sources: Record<string, BindingSource> = {};
  for (const [name, source] of Object.entries(bindings)) {
    let value: unknown;
    switch (source.kind) {
      case 'literal':
        value = source.value;
        sources[name] = { kind: 'literal' };
        break;
      case 'input':
        value = lookup(scope.input, source.path);
        sources[name] = { kind: 'input', executionId: scope.inputExecutionId, path: source.path };
        break;
      case 'trigger':
        value = lookup(scope.trigger, source.path);
        sources[name] = {
          kind: 'trigger',
          executionId: scope.triggerExecutionId,
          path: source.path,
        };
        break;
      case 'project':
        value = lookup(scope.project, source.path);
        sources[name] = { kind: 'project', projectId: scope.projectId, path: source.path };
        break;
      case 'node': {
        const matches = scope.chain.filter((entry) => entry.nodeId === source.nodeId);
        const selector = source.execution;
        const producer =
          selector === 'latest'
            ? matches[0]
            : selector === 'first'
              ? matches.at(-1)
              : matches.find((entry) =>
                  'sequence' in selector
                    ? entry.sequence === selector.sequence
                    : entry.id === selector.executionId,
                );
        if (!producer && typeof selector === 'object') {
          throw new ShiftError(
            'BINDING_UNAVAILABLE',
            `Binding ${name}: ${'sequence' in selector ? `sequence ${selector.sequence}` : `execution ${selector.executionId}`} of node ${source.nodeId} is not an earlier successful execution on this run's path.`,
            422,
          );
        }
        value = producer ? lookup(producer.output, source.path) : missing;
        sources[name] = {
          kind: 'node',
          nodeId: source.nodeId,
          executionId: producer?.id ?? null,
          sequence: producer?.sequence ?? null,
          path: source.path,
        };
        if (value === missing && source.optional) {
          value = source.fallback;
          sources[name] = { ...(sources[name] as object), fallback: true } as BindingSource;
        }
        break;
      }
    }
    if (value === missing) {
      throw bindingError(
        name,
        `no value at ${source.kind} ${JSON.stringify('path' in source ? source.path : [])}.`,
      );
    }
    values[name] = value as Json;
  }
  return { values, sources };
}

// `{"$binding": "<name>"}` objects are replaced by the binding's value.
export function renderTemplate(template: Json, bindings: Record<string, Json>): Json {
  if (Array.isArray(template)) return template.map((item) => renderTemplate(item, bindings));
  if (typeof template === 'object' && template !== null) {
    const entries = Object.entries(template);
    if (
      entries.length === 1 &&
      entries[0]![0] === '$binding' &&
      typeof entries[0]![1] === 'string'
    ) {
      return bindings[entries[0]![1]] ?? null;
    }
    return Object.fromEntries(
      entries.map(([key, value]) => [key, renderTemplate(value, bindings)]),
    );
  }
  return template;
}

// `{{name}}` placeholders in text; strings are inserted as-is, other values as JSON.
export function renderText(text: string, bindings: Record<string, Json>): string {
  return text.replace(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g, (_match, name: string) => {
    const value = bindings[name];
    return typeof value === 'string' ? value : JSON.stringify(value ?? null);
  });
}
