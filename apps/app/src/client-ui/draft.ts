import {
  hasInput,
  layout,
  outputPorts,
  readDocument,
  typeLabels,
  type DocumentNode,
} from './graph.js';

// Local edits of a workflow draft, as pure functions over the server's document. Each edit
// rewrites only what it changes, so fields this editor does not know yet are sent back as they
// came. Presentation coordinates never affect IDs, connections or execution.

export type Draft = Record<string, unknown>;
type Raw = Record<string, unknown>;

const nodesOf = (draft: Draft): Raw[] =>
  Array.isArray(draft['nodes']) ? (draft['nodes'] as Raw[]) : [];
const connectionsOf = (draft: Draft): Raw[] =>
  Array.isArray(draft['connections']) ? (draft['connections'] as Raw[]) : [];

export interface NodePosition {
  nodeId: string;
  x: number;
  y: number;
}

export function withPositions(draft: Draft, positions: NodePosition[]): Draft {
  const byId = new Map(positions.map((item) => [item.nodeId, item]));
  return {
    ...draft,
    nodes: nodesOf(draft).map((node) => {
      const moved = typeof node['id'] === 'string' ? byId.get(node['id']) : undefined;
      // Whole pixels keep the document small and stable.
      return moved
        ? { ...node, position: { x: Math.round(moved.x), y: Math.round(moved.y) } }
        : node;
    }),
  };
}

// A draft the server laid out in a plain row is shown with a computed layout. The first edit
// keeps that layout, so the graph does not jump when a node gets a real position.
export function withLayout(draft: Draft): Draft {
  const positions = layout(readDocument(draft));
  return withPositions(
    draft,
    [...positions].map(([nodeId, { x, y }]) => ({ nodeId, x, y })),
  );
}

// The types that can be added, in the order the picker shows them. Each starts with what its
// form needs; a missing required field is a diagnostic, not a blocked edit.
export const addableTypes = [
  'agent',
  'transform',
  'condition',
  'switch',
  'wait',
  'human_input',
  'approval',
  'end',
  'manual_trigger',
] as const;

const startingConfig: Record<string, Raw> = {
  wait: { durationMs: 60_000 },
  human_input: { form: { type: 'object', properties: {} } },
};

function freeId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix++) if (!used.has(`${base}_${suffix}`)) return `${base}_${suffix}`;
}

const nodeIds = (draft: Draft) => new Set(nodesOf(draft).map((node) => String(node['id'])));

export function addNode(
  draft: Draft,
  type: string,
  position: { x: number; y: number },
): { draft: Draft; nodeId: string } {
  const nodeId = freeId(type === 'manual_trigger' ? 'start' : type, nodeIds(draft));
  const node = {
    id: nodeId,
    type,
    config: structuredClone(startingConfig[type] ?? {}),
    position: { x: Math.round(position.x), y: Math.round(position.y) },
  };
  return { draft: { ...draft, nodes: [...nodesOf(draft), node] }, nodeId };
}

// A copy with a new ID and no connections, a little below and to the right.
export function duplicateNode(draft: Draft, nodeId: string): { draft: Draft; nodeId: string } {
  const source = nodesOf(draft).find((node) => node['id'] === nodeId);
  if (!source) return { draft, nodeId };
  const id = freeId(nodeId.replace(/_\d+$/, ''), nodeIds(draft));
  const position = (source['position'] ?? { x: 0, y: 0 }) as { x: number; y: number };
  const copy = {
    ...structuredClone(source),
    id,
    position: { x: position.x + 40, y: position.y + 40 },
  };
  return { draft: { ...draft, nodes: [...nodesOf(draft), copy] }, nodeId: id };
}

export function deleteNode(draft: Draft, nodeId: string): Draft {
  return {
    ...draft,
    nodes: nodesOf(draft).filter((node) => node['id'] !== nodeId),
    connections: connectionsOf(draft).filter(
      (item) => item['fromNodeId'] !== nodeId && item['toNodeId'] !== nodeId,
    ),
  };
}

export type EditResult = { draft: Draft } | { problem: string };

// Why a connection cannot exist, in words that say what to do instead. `except` is the
// connection being moved, which does not block its own port.
function connectionProblem(
  draft: Draft,
  fromNodeId: string,
  fromPort: string,
  toNodeId: string,
  except?: string,
): string | null {
  const document = readDocument(draft);
  const to = document.nodes.find((node) => node.id === toNodeId);
  if (to && !hasInput(to))
    return `${toNodeId} starts a run, so nothing can connect into it. Connect to the node after it.`;
  const taken = document.connections.find(
    (item) => item.fromNodeId === fromNodeId && item.fromPort === fromPort && item.id !== except,
  );
  if (taken)
    return `The ${fromPort} port of ${fromNodeId} already goes to ${taken.toNodeId}. A run follows one path, so remove that connection first.`;
  return null;
}

export function connect(
  draft: Draft,
  fromNodeId: string,
  fromPort: string,
  toNodeId: string,
): EditResult {
  const problem = connectionProblem(draft, fromNodeId, fromPort, toNodeId);
  if (problem) return { problem };
  const used = new Set(connectionsOf(draft).map((item) => String(item['id'])));
  let number = used.size + 1;
  while (used.has(`c${number}`)) number++;
  return {
    draft: {
      ...draft,
      connections: [
        ...connectionsOf(draft),
        { id: `c${number}`, fromNodeId, fromPort, toNodeId, toPort: 'input' },
      ],
    },
  };
}

// Moves a connection to another port or target and keeps its ID.
export function reconnect(
  draft: Draft,
  connectionId: string,
  fromNodeId: string,
  fromPort: string,
  toNodeId: string,
): EditResult {
  const problem = connectionProblem(draft, fromNodeId, fromPort, toNodeId, connectionId);
  if (problem) return { problem };
  return {
    draft: {
      ...draft,
      connections: connectionsOf(draft).map((item) =>
        item['id'] === connectionId ? { ...item, fromNodeId, fromPort, toNodeId } : item,
      ),
    },
  };
}

export function deleteConnection(draft: Draft, connectionId: string): Draft {
  return {
    ...draft,
    connections: connectionsOf(draft).filter((item) => item['id'] !== connectionId),
  };
}

// Sets one config field; `undefined` removes it. Connections from a port that no longer exists
// stay, and a diagnostic points at them, so nothing the author drew disappears silently.
export function setConfig(draft: Draft, nodeId: string, key: string, value: unknown): Draft {
  return {
    ...draft,
    nodes: nodesOf(draft).map((node) => {
      if (node['id'] !== nodeId) return node;
      const config = { ...((node['config'] ?? {}) as Raw) };
      if (value === undefined) delete config[key];
      else config[key] = value;
      return { ...node, config };
    }),
  };
}

export const validNodeId = (id: string) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id);

// Renames a node along with everything that names it.
export function renameNode(draft: Draft, nodeId: string, next: string): EditResult {
  if (!validNodeId(next))
    return { problem: 'Use a letter first, then letters, digits, _ or -, up to 64 characters.' };
  if (next !== nodeId && nodeIds(draft).has(next))
    return { problem: `Another node is already called ${next}.` };
  const rebind = (bindings: unknown) =>
    Object.fromEntries(
      Object.entries((bindings ?? {}) as Raw).map(([name, source]) => [
        name,
        (source as Raw)?.['kind'] === 'node' && (source as Raw)['nodeId'] === nodeId
          ? { ...(source as Raw), nodeId: next }
          : source,
      ]),
    );
  return {
    draft: {
      ...draft,
      nodes: nodesOf(draft).map((node) => ({
        ...node,
        ...(node['id'] === nodeId ? { id: next } : {}),
        ...(node['bindings'] ? { bindings: rebind(node['bindings']) } : {}),
      })),
      connections: connectionsOf(draft).map((item) => ({
        ...item,
        ...(item['fromNodeId'] === nodeId ? { fromNodeId: next } : {}),
        ...(item['toNodeId'] === nodeId ? { toNodeId: next } : {}),
      })),
    },
  };
}

// ---------- History ----------

export interface History {
  past: Draft[];
  present: Draft;
  future: Draft[];
}

const historyLimit = 200;

export const startHistory = (present: Draft): History => ({ past: [], present, future: [] });

export const commit = (history: History, next: Draft): History =>
  next === history.present
    ? history
    : {
        past: [...history.past, history.present].slice(-historyLimit),
        present: next,
        future: [],
      };

export const undo = (history: History): History =>
  history.past.length === 0
    ? history
    : {
        past: history.past.slice(0, -1),
        present: history.past[history.past.length - 1]!,
        future: [history.present, ...history.future],
      };

export const redo = (history: History): History =>
  history.future.length === 0
    ? history
    : {
        past: [...history.past, history.present],
        present: history.future[0]!,
        future: history.future.slice(1),
      };

// ---------- Local edits against server revisions ----------

// A workflow's draft on this computer. `base` is the server revision the edits started from, and
// is never changed by an edit; `theirs` is a newer revision saved elsewhere while edits were open.
export interface LocalDraft {
  revision: number;
  base: Draft;
  history: History;
  theirs: { revision: number; draft: Draft } | null;
}

export const startLocal = (revision: number, draft: Draft): LocalDraft => ({
  revision,
  base: draft,
  history: startHistory(draft),
  theirs: null,
});

export const isDirty = (local: LocalDraft): boolean =>
  local.history.present !== local.base &&
  canonical(local.history.present) !== canonical(local.base);

export const sameDraft = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null)
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Raw)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

// The server's copy arrived. Without local edits it replaces what is shown. Local edits are kept,
// and a newer revision from elsewhere waits as `theirs` for an explicit choice.
export function receive(local: LocalDraft, revision: number, draft: Draft): LocalDraft {
  if (revision < local.revision) return local;
  const dirty = isDirty(local);
  if (revision === local.revision) {
    if (local.base === draft) return local;
    // The same revision as saved here, with the server's defaults filled in.
    return dirty
      ? { ...local, base: draft }
      : { ...local, base: draft, history: { ...local.history, present: draft } };
  }
  if (!dirty) return startLocal(revision, draft);
  return local.theirs?.revision === revision ? local : { ...local, theirs: { revision, draft } };
}

// This computer's save was accepted at `revision`. What was sent is now the base.
export function saved(local: LocalDraft, revision: number, sent: Draft): LocalDraft {
  return { ...local, revision, base: sent, theirs: null };
}

// Conflict choices. Keeping mine aims the next save at their revision, so it replaces theirs only
// because the owner said so; taking theirs discards local edits.
export const keepMine = (local: LocalDraft): LocalDraft =>
  local.theirs
    ? { ...local, revision: local.theirs.revision, base: local.theirs.draft, theirs: null }
    : local;

export const takeTheirs = (local: LocalDraft): LocalDraft =>
  local.theirs ? startLocal(local.theirs.revision, local.theirs.draft) : local;

// ---------- Diagnostics ----------

export interface DraftProblem {
  severity: 'error' | 'warning';
  nodeId: string | null;
  // The config field or port it concerns, when there is one.
  field: string | null;
  message: string;
}

const required: Record<string, { key: string; label: string }[]> = {
  agent: [{ key: 'goal', label: 'a goal' }],
  transform: [{ key: 'data', label: 'data' }],
  condition: [{ key: 'when', label: 'a rule' }],
  switch: [{ key: 'cases', label: 'at least one case' }],
  human_input: [{ key: 'title', label: 'a title' }],
  approval: [{ key: 'title', label: 'a title' }],
};

const blank = (value: unknown) =>
  value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

function templateNames(value: unknown): string[] {
  if (typeof value === 'string')
    return [...value.matchAll(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g)].map((match) => match[1]!);
  if (Array.isArray(value)) return value.flatMap(templateNames);
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 1 && entries[0]![0] === '$binding' && typeof entries[0]![1] === 'string')
      return [entries[0]![1]];
    return entries.flatMap(([, child]) => templateNames(child));
  }
  return [];
}

function nodeProblems(node: DocumentNode, bindings: Raw): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const add = (field: string | null, message: string) =>
    problems.push({ severity: 'error', nodeId: node.id, field, message });
  for (const { key, label } of required[node.type] ?? [])
    if (blank(node.config[key])) add(key, `${node.id} needs ${label}.`);
  if (
    node.type === 'wait' &&
    (node.config['durationMs'] === undefined) === (node.config['until'] === undefined)
  )
    add('durationMs', `${node.id} needs either a duration or a time to wait until.`);
  const templated = ['goal', 'data', 'until', 'title', 'instructions'].map(
    (field) => node.config[field],
  );
  for (const name of new Set(templateNames(templated)))
    if (!(name in bindings)) add(null, `${node.id} uses ${name}, which it does not declare.`);
  return problems;
}

// Quick feedback while editing; the server's validation at publish is what counts. Backward edges
// and convergence are valid, so neither appears here.
export function diagnose(draft: Draft): DraftProblem[] {
  const document = readDocument(draft);
  const problems: DraftProblem[] = [];
  const triggers = document.nodes.filter((node) => node.type === 'manual_trigger');
  if (triggers.length !== 1)
    problems.push({
      severity: 'error',
      nodeId: triggers[1]?.id ?? null,
      field: null,
      message:
        triggers.length === 0
          ? 'A workflow needs a manual trigger to start from.'
          : 'A workflow has exactly one manual trigger for now. Remove the others.',
    });
  const raw = new Map(nodesOf(draft).map((node) => [node['id'], node]));
  for (const node of document.nodes) {
    if (!(node.type in typeLabels))
      problems.push({
        severity: 'error',
        nodeId: node.id,
        field: null,
        message: `This app does not know node type ${node.type}.`,
      });
    const bindings = (raw.get(node.id)?.['bindings'] ?? {}) as Raw;
    problems.push(...nodeProblems(node, bindings));
    for (const [name, source] of Object.entries(bindings)) {
      const target = (source as Raw)?.['nodeId'];
      if (
        (source as Raw)?.['kind'] === 'node' &&
        !document.nodes.some((item) => item.id === target)
      )
        problems.push({
          severity: 'error',
          nodeId: node.id,
          field: null,
          message: `Binding ${name} of ${node.id} reads ${String(target)}, which no longer exists.`,
        });
    }
  }
  const used = new Set<string>();
  for (const connection of document.connections) {
    const from = document.nodes.find((node) => node.id === connection.fromNodeId);
    if (from && !outputPorts(from).includes(connection.fromPort))
      problems.push({
        severity: 'error',
        nodeId: from.id,
        field: connection.fromPort,
        message: `${from.id} no longer has a ${connection.fromPort} port, but a connection still leaves it.`,
      });
    const port = `${connection.fromNodeId}:${connection.fromPort}`;
    if (used.has(port))
      problems.push({
        severity: 'error',
        nodeId: connection.fromNodeId,
        field: connection.fromPort,
        message: `The ${connection.fromPort} port of ${connection.fromNodeId} has more than one connection. A run follows one path.`,
      });
    used.add(port);
  }
  // Reached by following connections from the trigger. Never blocks publishing.
  const reached = new Set<string>(triggers.map((node) => node.id));
  for (let grew = true; grew;) {
    grew = false;
    for (const connection of document.connections)
      if (reached.has(connection.fromNodeId) && !reached.has(connection.toNodeId)) {
        reached.add(connection.toNodeId);
        grew = true;
      }
  }
  if (triggers.length)
    for (const node of document.nodes)
      if (!reached.has(node.id))
        problems.push({
          severity: 'warning',
          nodeId: node.id,
          field: null,
          message: `No path from the trigger reaches ${node.id}.`,
        });
  return problems;
}

// The server's verdict at publish, placed on the nodes its JSON pointers name.
export function serverProblems(
  draft: Draft,
  diagnostics: { field: string; message: string }[],
): DraftProblem[] {
  const nodes = nodesOf(draft);
  const connections = connectionsOf(draft);
  return diagnostics.map(({ field, message }) => {
    const parts = field.split('/');
    const index = Number(parts[2]);
    const nodeId =
      parts[1] === 'nodes'
        ? (nodes[index]?.['id'] as string | undefined)
        : parts[1] === 'connections'
          ? (connections[index]?.['fromNodeId'] as string | undefined)
          : undefined;
    const name = parts[1] === 'nodes' && parts[3] === 'config' ? parts[4] : undefined;
    return {
      severity: 'error',
      nodeId: nodeId ?? null,
      field: name ?? null,
      message: nodeId ? `${nodeId}: ${message}` : message,
    };
  });
}
