import dagre from '@dagrejs/dagre';
import type { Execution, Run } from '../protocol/generated/types.js';

// The workflow graph as the canvas shows it: nodes with their named ports, connections between
// ports, and, for a run, what happened at each node. Pure functions, so they are tested without
// a renderer.

export interface DocumentNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface DocumentConnection {
  id: string;
  fromNodeId: string;
  fromPort: string;
  toNodeId: string;
  toPort: string;
}

export interface GraphDocument {
  nodes: DocumentNode[];
  connections: DocumentConnection[];
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Reads the nodes and connections of a workflow document, skipping malformed entries rather
// than failing the whole view: a draft may be invalid.
export function readDocument(value: unknown): GraphDocument {
  const document = record(value);
  const nodes: DocumentNode[] = [];
  const ids = new Set<string>();
  for (const item of Array.isArray(document['nodes']) ? document['nodes'] : []) {
    const node = record(item);
    if (typeof node['id'] !== 'string' || typeof node['type'] !== 'string') continue;
    if (ids.has(node['id'])) continue;
    ids.add(node['id']);
    const position = record(node['position']);
    nodes.push({
      id: node['id'],
      type: node['type'],
      config: record(node['config']),
      ...(typeof position['x'] === 'number' && typeof position['y'] === 'number'
        ? { position: { x: position['x'], y: position['y'] } }
        : {}),
    });
  }
  const connections: DocumentConnection[] = [];
  for (const item of Array.isArray(document['connections']) ? document['connections'] : []) {
    const connection = record(item);
    const fields = ['id', 'fromNodeId', 'fromPort', 'toNodeId', 'toPort'] as const;
    if (!fields.every((field) => typeof connection[field] === 'string')) continue;
    if (!ids.has(connection['fromNodeId'] as string) || !ids.has(connection['toNodeId'] as string))
      continue;
    connections.push(connection as unknown as DocumentConnection);
  }
  return { nodes, connections };
}

// Output ports by node type (workflow documentation, "Node types").
export function outputPorts(node: DocumentNode): string[] {
  switch (node.type) {
    case 'manual_trigger':
      return ['success'];
    case 'condition':
      return ['true', 'false', 'error'];
    case 'switch': {
      const cases = Array.isArray(node.config['cases']) ? node.config['cases'] : [];
      const ports = cases
        .map((item) => record(item)['port'])
        .filter((port): port is string => typeof port === 'string');
      return [...new Set([...ports, 'default', 'error'])];
    }
    case 'human_input':
      return ['success', 'timeout', 'error'];
    case 'approval': {
      const outcomes = Array.isArray(node.config['outcomes'])
        ? node.config['outcomes'].filter((item): item is string => typeof item === 'string')
        : ['approved', 'rejected'];
      return [...new Set([...outcomes, 'timeout', 'error'])];
    }
    case 'end':
      return [];
    default:
      return ['success', 'error'];
  }
}

export function hasInput(node: DocumentNode): boolean {
  return node.type !== 'manual_trigger';
}

export const typeLabels: Record<string, string> = {
  manual_trigger: 'Manual trigger',
  transform: 'Transform',
  agent: 'Agent',
  condition: 'Condition',
  switch: 'Switch',
  wait: 'Wait',
  human_input: 'Human input',
  approval: 'Approval',
  end: 'End',
};

// One line of the node's most telling configuration.
export function summary(node: DocumentNode): string {
  const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ') : '');
  switch (node.type) {
    case 'agent':
      return text(node.config['goal']);
    case 'human_input':
    case 'approval':
      return text(node.config['title']);
    case 'wait': {
      const ms = node.config['durationMs'];
      if (typeof ms === 'number') return `Wait ${duration(ms)}`;
      return text(node.config['until']) ? `Until ${text(node.config['until'])}` : '';
    }
    case 'switch': {
      const cases = Array.isArray(node.config['cases']) ? node.config['cases'].length : 0;
      return `${cases} ${cases === 1 ? 'case' : 'cases'}`;
    }
    case 'end':
      return node.config['outcome'] === 'FAILED' ? 'Ends as failed' : 'Ends as completed';
    case 'manual_trigger':
      return node.config['inputSchema'] ? 'Takes input' : 'Started by hand';
    default:
      return '';
  }
}

export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

export const nodeWidth = 248;
const portRow = 22;

// A card grows with its output ports, which sit in a column at its right edge.
export function nodeHeight(node: DocumentNode): number {
  return Math.max(84, 46 + outputPorts(node).length * portRow);
}

// The vertical offset of an output port's handle from the top of its card.
export function portOffset(index: number): number {
  return 46 + index * portRow + portRow / 2 - 4;
}

// The server fills missing positions with a plain row (x = index × 240, y = 0). That row is
// treated as no layout at all.
function serverRow(document: GraphDocument): boolean {
  return document.nodes.every(
    (node, index) => node.position?.x === index * 240 && node.position.y === 0,
  );
}

// Positions saved by the editor, or a left-to-right layout when there are none.
export function layout(document: GraphDocument): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const placed = !serverRow(document);
  if (placed && document.nodes.every((node) => node.position)) {
    for (const node of document.nodes) positions.set(node.id, node.position!);
    return positions;
  }
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of document.nodes)
    graph.setNode(node.id, { width: nodeWidth, height: nodeHeight(node) });
  for (const connection of document.connections)
    graph.setEdge(connection.fromNodeId, connection.toNodeId);
  dagre.layout(graph);
  for (const node of document.nodes) {
    const laid = graph.node(node.id);
    positions.set(
      node.id,
      (placed && node.position) || {
        x: laid.x - nodeWidth / 2,
        y: laid.y - nodeHeight(node) / 2,
      },
    );
  }
  return positions;
}

// What a node shows in a run.
export type NodeStatus =
  'not_reached' | 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export interface NodeRun {
  status: NodeStatus;
  // Every execution of the node, oldest first. More than one means a loop.
  executions: Execution[];
}

const executionStatus: Record<Execution['state'], NodeStatus> = {
  PENDING: 'pending',
  RUNNING: 'running',
  WAITING: 'waiting',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

export function nodeRuns(run: Run): Map<string, NodeRun> {
  const result = new Map<string, NodeRun>();
  const ordered = [...run.executions].sort((a, b) => a.sequence - b.sequence);
  for (const execution of ordered) {
    const entry = result.get(execution.node) ?? { status: 'not_reached', executions: [] };
    entry.executions.push(execution);
    entry.status = executionStatus[execution.state];
    result.set(execution.node, entry);
  }
  return result;
}

// Connections a run followed.
export function followed(run: Run): Set<string> {
  return new Set(
    run.executions
      .map((execution) => execution.connectionId)
      .filter((id): id is string => typeof id === 'string'),
  );
}

export const statusLabels: Record<NodeStatus, string> = {
  not_reached: 'Not reached',
  pending: 'Queued',
  running: 'Running',
  waiting: 'Waiting',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export type RunState = Run['state'];

export const runStateLabels: Record<RunState, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  WAITING: 'Waiting',
  HELD: 'Held',
  NEEDS_HUMAN: 'Needs you',
  FAILED: 'Failed',
  CANCEL_REQUESTED: 'Cancelling',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

// Why a run is waiting or stuck, in one sentence.
export function runReason(run: Run, now: number): string | null {
  const wait = run.wait;
  if (run.state === 'WAITING' && wait) {
    const node = run.executions.find((item) => item.id === wait['executionId'])?.node;
    const at = typeof wait['dueAt'] === 'number' ? wait['dueAt'] : null;
    const until = at === null ? '' : at <= now ? ' now' : ` in ${duration(at - now)}`;
    if (wait['kind'] === 'human') return `Waiting for your answer at ${node ?? 'a request'}`;
    if (wait['kind'] === 'timer') return `${node ?? 'A wait'} continues${until}`;
    if (wait['kind'] === 'retry')
      return `${node ?? 'A step'} retries${until} (attempt ${String(wait['attempt'] ?? '')})`;
  }
  if (run.state === 'NEEDS_HUMAN' && run.attention) {
    const explanation = run.attention['explanation'];
    return typeof explanation === 'string' ? explanation : 'This run needs you.';
  }
  if (run.state === 'FAILED') {
    const outcome = record(run.outcome);
    const message = typeof outcome['message'] === 'string' ? outcome['message'] : null;
    return message ?? (typeof outcome['reason'] === 'string' ? outcome['reason'] : null);
  }
  return null;
}

export function finished(state: RunState): boolean {
  return state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED';
}
