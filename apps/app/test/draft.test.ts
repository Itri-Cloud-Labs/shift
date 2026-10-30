import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode,
  commit,
  connect,
  deleteNode,
  diagnose,
  duplicateNode,
  isDirty,
  keepMine,
  receive,
  reconnect,
  redo,
  renameNode,
  saved,
  serverProblems,
  setConfig,
  startHistory,
  startLocal,
  takeTheirs,
  undo,
  withLayout,
  type Draft,
} from '../src/client-ui/draft.js';
import { readDocument } from '../src/client-ui/graph.js';

const base: Draft = {
  formatVersion: 1,
  execution: { limits: { maxExecutions: 7 } },
  futureField: { keep: true },
  nodes: [
    { id: 'start', type: 'manual_trigger', config: {}, position: { x: 0, y: 0 } },
    {
      id: 'work',
      type: 'agent',
      config: { goal: 'Do it', later: 'unknown to this form' },
      bindings: { a: { kind: 'node', nodeId: 'start', execution: 'latest', path: [] } },
      retry: { maxAttempts: 3 },
      position: { x: 300, y: 0 },
    },
    { id: 'done', type: 'end', config: {}, position: { x: 600, y: 0 } },
  ],
  connections: [
    { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'work', toPort: 'input' },
  ],
};
const mustDraft = (result: { draft: Draft } | { problem: string }): Draft => {
  assert.ok('draft' in result, 'problem' in result ? result.problem : '');
  return result.draft;
};
const errors = (draft: Draft) => diagnose(draft).filter((item) => item.severity === 'error');

test('edits leave fields this editor does not know untouched', () => {
  const edited = setConfig(
    mustDraft(connect(base, 'work', 'success', 'done')),
    'work',
    'goal',
    'New',
  );
  assert.deepEqual(edited['futureField'], { keep: true });
  assert.deepEqual(edited['execution'], base['execution']);
  const work = (edited['nodes'] as Record<string, unknown>[])[1]!;
  assert.deepEqual(work['config'], { goal: 'New', later: 'unknown to this form' });
  assert.deepEqual(work['retry'], { maxAttempts: 3 });
  // The input was not changed in place.
  assert.equal((base['connections'] as unknown[]).length, 1);
});

test('a second edge from a port is refused, in words that say what to do', () => {
  const result = connect(base, 'start', 'success', 'done');
  assert.ok('problem' in result);
  assert.match(result.problem, /already goes to work/);
  assert.match(result.problem, /remove that connection/);
  const intoTrigger = connect(base, 'work', 'success', 'start');
  assert.ok('problem' in intoTrigger);
  assert.match(intoTrigger.problem, /starts a run/);
  // Moving a connection does not collide with itself, and keeps its ID.
  const moved = mustDraft(reconnect(base, 'c1', 'start', 'success', 'done'));
  assert.deepEqual((moved['connections'] as unknown[])[0], {
    id: 'c1',
    fromNodeId: 'start',
    fromPort: 'success',
    toNodeId: 'done',
    toPort: 'input',
  });
});

test('loops and convergence are valid', () => {
  let draft = mustDraft(connect(base, 'work', 'success', 'done'));
  // Backward to itself and to an earlier node, and two ports into one node.
  draft = mustDraft(connect(draft, 'work', 'error', 'work'));
  assert.deepEqual(errors(draft), []);
  const { draft: branched, nodeId } = addNode(draft, 'approval', { x: 0, y: 200 });
  draft = setConfig(branched, nodeId, 'title', 'Ship?');
  draft = mustDraft(connect(draft, nodeId, 'approved', 'done'));
  draft = mustDraft(connect(draft, nodeId, 'rejected', 'work'));
  assert.deepEqual(errors(draft), []);
});

test('undo and redo bring back the same IDs and edges', () => {
  const added = addNode(base, 'agent', { x: 1, y: 2 });
  assert.equal(added.nodeId, 'agent');
  let history = commit(startHistory(base), added.draft);
  const linked = mustDraft(connect(added.draft, 'work', 'success', added.nodeId));
  history = commit(history, linked);
  history = commit(history, deleteNode(linked, added.nodeId));
  assert.equal(readDocument(history.present).connections.length, 1);
  history = undo(history);
  assert.deepEqual(history.present, linked);
  history = undo(undo(history));
  assert.deepEqual(history.present, base);
  assert.equal(undo(history), history);
  history = redo(redo(history));
  assert.deepEqual(history.present, linked);
  // A new edit drops what could have been redone.
  assert.deepEqual(commit(undo(history), base).future, []);
});

test('copies and renames keep the graph consistent', () => {
  const copy = duplicateNode(base, 'work');
  assert.equal(copy.nodeId, 'work_2');
  assert.equal(readDocument(copy.draft).connections.length, 1);
  assert.equal(duplicateNode(copy.draft, 'work_2').nodeId, 'work_3');
  const renamed = mustDraft(renameNode(base, 'start', 'begin'));
  const nodes = renamed['nodes'] as Record<string, Record<string, Record<string, unknown>>>[];
  assert.equal(readDocument(renamed).connections[0]!.fromNodeId, 'begin');
  assert.equal(nodes[1]!['bindings']!['a']!['nodeId'], 'begin');
  assert.ok('problem' in renameNode(base, 'start', 'work'));
  assert.ok('problem' in renameNode(base, 'start', '1bad'));
});

test('diagnostics name the node and field, and warn about unreachable nodes', () => {
  const { draft, nodeId } = addNode(base, 'agent', { x: 0, y: 0 });
  const problems = diagnose(draft);
  assert.ok(problems.some((item) => item.nodeId === nodeId && item.field === 'goal'));
  const unreachable = problems.find((item) => item.nodeId === 'done');
  assert.equal(unreachable?.severity, 'warning');
  assert.match(errors({ nodes: [], connections: [] })[0]!.message, /manual trigger/);
  // Fewer outcomes leave a connection on a port that no longer exists: shown, not dropped.
  let approval = addNode(base, 'approval', { x: 0, y: 0 });
  let edited = setConfig(approval.draft, approval.nodeId, 'title', 'Ship?');
  edited = mustDraft(connect(edited, approval.nodeId, 'rejected', 'done'));
  edited = setConfig(edited, approval.nodeId, 'outcomes', ['approved']);
  assert.equal(readDocument(edited).connections.length, 2);
  assert.ok(errors(edited).some((item) => item.field === 'rejected'));
  const placeholder = setConfig(base, 'work', 'goal', 'Read {{missing}} and {{a}}');
  assert.deepEqual(
    errors(placeholder).map((item) => item.nodeId),
    ['work'],
  );
  const server = serverProblems(base, [
    { field: '/nodes/1/config/goal', message: 'must be longer' },
    { field: '/connections/0', message: 'taken' },
    { field: '/', message: 'too large' },
  ]);
  assert.deepEqual(
    server.map((item) => [item.nodeId, item.field]),
    [
      ['work', 'goal'],
      ['start', null],
      [null, null],
    ],
  );
});

test('a save elsewhere never overwrites local edits', () => {
  const edit = (local: ReturnType<typeof startLocal>, draft: Draft) => ({
    ...local,
    history: commit(local.history, draft),
  });
  const mine = setConfig(base, 'work', 'goal', 'Mine');
  const theirs = setConfig(base, 'work', 'goal', 'Theirs');
  // No edits: the newer revision is simply shown.
  const clean = receive(startLocal(1, base), 2, theirs);
  assert.equal(clean.history.present, theirs);
  assert.equal(clean.revision, 2);
  // Edits: both versions are kept and neither is applied.
  const open = receive(edit(startLocal(1, base), mine), 2, theirs);
  assert.equal(open.history.present, mine);
  assert.equal(open.revision, 1);
  assert.deepEqual(open.theirs, { revision: 2, draft: theirs });
  // Keeping mine aims the next save at their revision and keeps the edits and their undo.
  const kept = keepMine(open);
  assert.equal(kept.revision, 2);
  assert.equal(kept.history.present, mine);
  assert.equal(kept.history.past.length, 1);
  assert.equal(kept.theirs, null);
  assert.ok(isDirty(kept));
  // Taking theirs discards the edits.
  const taken = takeTheirs(open);
  assert.equal(taken.history.present, theirs);
  assert.equal(isDirty(taken), false);
  // An older answer arriving late changes nothing.
  assert.equal(receive(open, 0, theirs), open);
});

test('saving makes what was sent the base, and edits made since stay', () => {
  const first = setConfig(base, 'work', 'goal', 'First');
  const local = { ...startLocal(1, base), history: commit(startHistory(base), first) };
  const after = saved(local, 2, first);
  assert.equal(isDirty(after), false);
  // The server's copy of the same revision adds its defaults and is not a conflict.
  const normalized = { ...first, presentation: {} };
  const back = receive(after, 2, normalized);
  assert.equal(back.theirs, null);
  assert.equal(back.history.present, normalized);
  assert.equal(isDirty(back), false);
  assert.equal(back.history.past.length, 1);
  // Typing continued during the save: the new text stays, against the new base.
  const more = setConfig(first, 'work', 'goal', 'Second');
  const typing = saved({ ...local, history: commit(local.history, more) }, 2, first);
  assert.ok(isDirty(typing));
  const merged = receive(typing, 2, normalized);
  assert.equal(merged.history.present, more);
  assert.equal(merged.theirs, null);
});

test('the first edit keeps the computed layout instead of the server row', () => {
  const row: Draft = {
    nodes: [
      { id: 'a', type: 'manual_trigger', config: {}, position: { x: 0, y: 0 } },
      { id: 'b', type: 'end', config: {}, position: { x: 240, y: 0 } },
    ],
    connections: [
      { id: 'c', fromNodeId: 'a', fromPort: 'success', toNodeId: 'b', toPort: 'input' },
    ],
  };
  const laid = readDocument(withLayout(row)).nodes;
  assert.notDeepEqual(laid[1]!.position, { x: 240, y: 0 });
  const { draft } = addNode(withLayout(row), 'agent', { x: 5, y: 5 });
  assert.deepEqual(readDocument(draft).nodes[1]!.position, laid[1]!.position);
});
