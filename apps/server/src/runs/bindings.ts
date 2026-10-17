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
  nodeId: string;
  sequence: number;
  output: OutputEnvelope;
}

export interface BindingScope {
  input: OutputEnvelope;
  trigger: Json;
  project: Json;
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

// Resolution never runs a producer. A missing required value fails before the executor runs; an
// optional node reference falls back only when the value is missing.
export function resolveBindings(
  bindings: Record<string, ValueSource>,
  scope: BindingScope,
): Record<string, Json> {
  const resolved: Record<string, Json> = {};
  for (const [name, source] of Object.entries(bindings)) {
    let value: unknown;
    switch (source.kind) {
      case 'literal':
        value = source.value;
        break;
      case 'input':
        value = lookup(scope.input, source.path);
        break;
      case 'trigger':
        value = lookup(scope.trigger, source.path);
        break;
      case 'project':
        value = lookup(scope.project, source.path);
        break;
      case 'node': {
        const matches = scope.chain.filter((entry) => entry.nodeId === source.nodeId);
        const producer = source.execution === 'latest' ? matches[0] : matches.at(-1);
        value = producer ? lookup(producer.output, source.path) : missing;
        if (value === missing && source.optional) value = source.fallback;
        break;
      }
    }
    if (value === missing) {
      throw bindingError(
        name,
        `no value at ${source.kind} ${JSON.stringify('path' in source ? source.path : [])}.`,
      );
    }
    resolved[name] = value as Json;
  }
  return resolved;
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
