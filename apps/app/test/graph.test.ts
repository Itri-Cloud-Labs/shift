import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Run } from '../src/protocol/generated/types.js';
import {
  followed,
  layout,
  nodeHeight,
  nodeRuns,
  outputPorts,
  readDocument,
  runReason,
  summary,
} from '../src/client-ui/graph.js';
import { formatRoute, parseRoute } from '../src/client-ui/route.js';

const fixtures = JSON.parse(
  await readFile(
    new URL('../src/protocol/generated/foundation.fixture.json', import.meta.url),
    'utf8',
  ),
) as Record<string, Record<string, unknown>>;
const baseRun = fixtures['runResponse']!['run'] as Run;

const document = {
  nodes: [
    { id: 'start', type: 'manual_trigger', position: { x: 0, y: 0 } },
    { id: 'check', type: 'condition', config: {}, position: { x: 240, y: 0 } },
    {
      id: 'route',
      type: 'switch',
      config: { cases: [{ port: 'small' }, { port: 'large' }] },
      position: { x: 480, y: 0 },
    },
    {
      id: 'review',
      type: 'approval',
      config: { title: 'Ship it?', outcomes: ['yes', 'no'] },
      position: { x: 720, y: 0 },
    },
    { id: 'end', type: 'end', position: { x: 960, y: 0 } },
  ],
  connections: [
    { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'check', toPort: 'input' },
    { id: 'c2', fromNodeId: 'check', fromPort: 'true', toNodeId: 'route', toPort: 'input' },
    { id: 'c3', fromNodeId: 'route', fromPort: 'large', toNodeId: 'review', toPort: 'input' },
    { id: 'c4', fromNodeId: 'review', fromPort: 'yes', toNodeId: 'end', toPort: 'input' },
  ],
};

test('a document is read leniently, since a draft may be invalid', () => {
  const read = readDocument({
    nodes: [
      { id: 'a', type: 'transform' },
      { id: 'a', type: 'agent' },
      { type: 'agent' },
      'nonsense',
      { id: 'b', type: 'end', config: [] },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'a', fromPort: 'success', toNodeId: 'b', toPort: 'input' },
      { id: 'c2', fromNodeId: 'a', fromPort: 'success', toNodeId: 'missing', toPort: 'input' },
      { id: 'c3', fromNodeId: 'a' },
    ],
  });
  assert.deepEqual(
    read.nodes.map((node) => [node.id, node.type]),
    [
      ['a', 'transform'],
      ['b', 'end'],
    ],
  );
  assert.deepEqual(read.nodes[1]!.config, {});
  assert.deepEqual(
    read.connections.map((connection) => connection.id),
    ['c1'],
  );
  assert.deepEqual(readDocument(null), { nodes: [], connections: [] });
});

test('ports follow each node type, including switch cases and approval outcomes', () => {
  const read = readDocument(document);
  const ports = Object.fromEntries(read.nodes.map((node) => [node.id, outputPorts(node)]));
  assert.deepEqual(ports, {
    start: ['success'],
    check: ['true', 'false', 'error'],
    route: ['small', 'large', 'default', 'error'],
    review: ['yes', 'no', 'timeout', 'error'],
    end: [],
  });
  assert.deepEqual(outputPorts({ id: 'a', type: 'approval', config: {} }), [
    'approved',
    'rejected',
    'timeout',
    'error',
  ]);
  // Cards grow with their ports.
  assert(nodeHeight(read.nodes[2]!) > nodeHeight(read.nodes[0]!));
  assert.equal(summary(read.nodes[3]!), 'Ship it?');
  assert.equal(
    summary({ id: 'w', type: 'wait', config: { durationMs: 90 * 60_000 } }),
    'Wait 1 h 30 min',
  );
});

test('the server default row is laid out again; saved positions are kept', () => {
  const read = readDocument(document);
  const laid = layout(read);
  // The default row (x = index × 240, y = 0) would overlap 248-pixel cards.
  const xs = read.nodes.map((node) => laid.get(node.id)!.x);
  for (let index = 1; index < xs.length; index++) assert(xs[index]! - xs[index - 1]! >= 248);
  const placed = readDocument({
    ...document,
    nodes: document.nodes.map((node, index) => ({ ...node, position: { x: index * 400, y: 80 } })),
  });
  assert.deepEqual(layout(placed).get('route'), { x: 800, y: 80 });
  const unplaced = readDocument({
    ...document,
    nodes: document.nodes.map(({ position: _, ...node }) => node),
  });
  assert.equal(layout(unplaced).size, 5);
});

test('a run shows the latest state of each node, its loop passes and the edges it took', () => {
  const execution = (
    sequence: number,
    node: string,
    state: string,
    connectionId: string | null,
  ) => ({
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    node,
    type: 'transform',
    sequence,
    state,
    port: state === 'COMPLETED' ? 'success' : null,
    predecessorId: null,
    connectionId,
    sources: null,
    output: null,
    error: null,
    attempts: [],
  });
  const run = {
    ...baseRun,
    state: 'WAITING',
    executions: [
      execution(3, 'check', 'RUNNING', 'c1'),
      execution(1, 'start', 'COMPLETED', null),
      execution(2, 'check', 'COMPLETED', 'c1'),
    ],
    wait: { kind: 'timer', executionId: execution(3, '', '', null).id, dueAt: 1_000 + 90_000 },
  } as unknown as Run;
  const runs = nodeRuns(run);
  assert.equal(runs.get('start')?.status, 'completed');
  assert.equal(runs.get('check')?.status, 'running');
  assert.deepEqual(
    runs.get('check')?.executions.map((item) => item.sequence),
    [2, 3],
  );
  assert.equal(runs.get('route'), undefined);
  assert.deepEqual([...followed(run)], ['c1']);
  assert.equal(runReason(run, 1_000), 'check continues in 2 min');
  assert.equal(
    runReason({ ...run, state: 'NEEDS_HUMAN', attention: { explanation: 'Limit reached.' } }, 0),
    'Limit reached.',
  );
});

test('routes round-trip and ignore anything that is not an identifier', () => {
  const route = {
    projectId: '00000000-0000-4000-8000-000000000001',
    workflowId: '00000000-0000-4000-8000-000000000002',
    runId: null,
    nodeId: 'review_2',
  };
  assert.deepEqual(parseRoute(formatRoute(route)), route);
  assert.deepEqual(parseRoute('#/p/a%2Fb/w/<script>/n/ok'), {
    projectId: null,
    workflowId: null,
    runId: null,
    nodeId: 'ok',
  });
  assert.deepEqual(parseRoute(''), {
    projectId: null,
    workflowId: null,
    runId: null,
    nodeId: null,
  });
});

test('moving nodes rewrites only their positions on the latest draft', async () => {
  const { withPositions } = await import('../src/client-ui/draft.js');
  const draft = {
    formatVersion: 1,
    nodes: [
      { id: 'a', type: 'transform', config: { data: 1 }, position: { x: 0, y: 0 } },
      { id: 'b', type: 'end', position: { x: 240, y: 0 } },
      'malformed',
    ],
    connections: [{ id: 'c1' }],
    presentation: { note: 'kept' },
  };
  const moved = withPositions(draft, [
    { nodeId: 'b', x: 410.6, y: -79.4 },
    { nodeId: 'gone', x: 1, y: 1 },
  ]);
  assert.deepEqual(moved, {
    ...draft,
    nodes: [draft.nodes[0], { id: 'b', type: 'end', position: { x: 411, y: -79 } }, 'malformed'],
  });
  // The input is not changed.
  assert.deepEqual(draft.nodes[1], { id: 'b', type: 'end', position: { x: 240, y: 0 } });
});
