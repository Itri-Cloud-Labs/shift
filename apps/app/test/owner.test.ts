import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Interaction, Run } from '../src/protocol/generated/types.js';
import type { Overview, Preferences } from '../src/shared/contracts.js';
import { announcements, announcer } from '../src/client-core/announcements.js';
import { MemoryPreferenceStore, PreferenceRuntime } from '../src/client-core/preferences.js';
import { readDocument } from '../src/client-ui/graph.js';
import { paletteEntries, paletteView } from '../src/client-ui/commands.js';
import {
  actorLabel,
  attentionItems,
  outcomeLabel,
  runControls,
  type AttentionItem,
} from '../src/client-ui/owner.js';
import { fieldLabel, initialDraft, setAt, toResponse } from '../src/client-ui/forms.js';

const fixtures = JSON.parse(
  await readFile(
    new URL('../src/protocol/generated/foundation.fixture.json', import.meta.url),
    'utf8',
  ),
) as Record<string, Record<string, unknown>>;
const baseRun = fixtures['runResponse']!['run'] as Run;
const ids = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const form = {
  type: 'object',
  required: ['branch', 'count'],
  properties: {
    branch: { type: 'string', maxLength: 80 },
    count: { type: 'integer', default: 2 },
    ratio: { type: 'number' },
    notes: { type: 'string' },
    urgent: { type: 'boolean' },
    due: { type: 'string', format: 'date-time' },
    reviewer: {
      type: 'object',
      properties: { name: { type: 'string' }, team: { type: 'string', enum: ['a', 'b'] } },
    },
    files: { type: 'array', items: { type: 'string' }, minItems: 1 },
  },
};

test('a form draft becomes a typed response, and what is missing is reported by path', () => {
  const draft = initialDraft(form);
  assert.deepEqual(draft, {
    branch: '',
    count: '2',
    ratio: '',
    notes: '',
    urgent: false,
    due: '',
    reviewer: { name: '', team: '' },
    files: [''],
  });
  const empty = toResponse(form, draft);
  assert.deepEqual(
    [...empty.problems],
    [
      ['/branch', 'Fill in this field.'],
      ['/files/0', 'Fill in this field.'],
    ],
  );
  let filled = setAt(draft, ['branch'], 'main');
  filled = setAt(filled, ['count'], '2.5');
  filled = setAt(filled, ['files', 0], 'a.ts');
  filled = setAt(filled, ['files', 1], 'b.ts');
  filled = setAt(filled, ['reviewer', 'team'], 'b');
  filled = setAt(filled, ['due'], '2026-10-29T14:30');
  assert.deepEqual([...toResponse(form, filled).problems], [['/count', 'Enter a whole number.']]);
  filled = setAt(filled, ['count'], ' 3 ');
  const { value, problems } = toResponse(form, filled);
  assert.equal(problems.size, 0);
  assert.deepEqual(value, {
    branch: 'main',
    count: 3,
    urgent: false,
    due: new Date('2026-10-29T14:30').toISOString(),
    reviewer: { team: 'b' },
    files: ['a.ts', 'b.ts'],
  });
  // Optional fields left empty are left out, so their constraints do not apply.
  assert.equal('notes' in value, false);
  assert.equal(fieldLabel('release_notes', {}), 'Release notes');
  assert.equal(fieldLabel('x', { title: 'Comment' }), 'Comment');
});

test('an optional group left untouched is left out, with its required fields', () => {
  const schema = {
    type: 'object',
    properties: {
      address: {
        type: 'object',
        required: ['street'],
        properties: { street: { type: 'string' } },
      },
    },
  };
  const draft = initialDraft(schema);
  assert.deepEqual(toResponse(schema, draft), { value: {}, problems: new Map() });
  assert.deepEqual(toResponse(schema, setAt(draft, ['address', 'street'], 'Main')).value, {
    address: { street: 'Main' },
  });
});

test('defaults fill the draft, including nested objects and arrays', () => {
  const schema = {
    type: 'object',
    properties: {
      group: {
        type: 'object',
        default: { flag: true },
        properties: { flag: { type: 'boolean' } },
      },
      list: { type: 'array', items: { type: 'number' }, default: [1, 2] },
    },
  };
  const draft = initialDraft(schema);
  assert.deepEqual(draft, { group: { flag: true }, list: ['1', '2'] });
  // A group showing defaults is sent, not taken for an untouched one.
  assert.deepEqual(toResponse(schema, draft).value, {
    group: { flag: true },
    list: [1, 2],
  });
  // Even a default that matches a blank field, such as false.
  const unchecked = {
    type: 'object',
    properties: {
      group: { type: 'object', properties: { flag: { type: 'boolean', default: false } } },
    },
  };
  assert.deepEqual(toResponse(unchecked, initialDraft(unchecked)).value, {
    group: { flag: false },
  });
  // And a default given by an enclosing group.
  const inherited = {
    type: 'object',
    properties: {
      group: {
        type: 'object',
        default: { nested: { flag: false } },
        properties: {
          nested: { type: 'object', properties: { flag: { type: 'boolean' } } },
        },
      },
    },
  };
  assert.deepEqual(toResponse(inherited, initialDraft(inherited)).value, {
    group: { nested: { flag: false } },
  });
  // And one given by a list to its items.
  const listed = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        default: [{ nested: { flag: false } }],
        items: {
          type: 'object',
          properties: {
            nested: { type: 'object', properties: { flag: { type: 'boolean' } } },
          },
        },
      },
    },
  };
  assert.deepEqual(toResponse(listed, initialDraft(listed)).value, {
    items: [{ nested: { flag: false } }],
  });
});

const execution = (sequence: number, node: string, type: string, state: string) => ({
  id: ids(100 + sequence),
  node,
  type,
  sequence,
  state,
  port: null,
  predecessorId: null,
  connectionId: null,
  sources: null,
  output: null,
  error: null,
  attempts: [],
});

test('a stuck run offers only the decisions the server accepts', () => {
  const stuck = (attention: Record<string, unknown>, executions: unknown[], extra = {}) =>
    runControls({
      ...baseRun,
      state: 'NEEDS_HUMAN',
      attention,
      executions,
      cancelRequested: false,
      ...extra,
    } as unknown as Run);
  const agent = [
    execution(1, 'start', 'manual_trigger', 'COMPLETED'),
    execution(2, 'build', 'agent', 'WAITING'),
  ];
  assert.deepEqual(stuck({ code: 'HARNESS_OUTCOME_UNKNOWN' }, agent), {
    retry: true,
    fail: true,
    complete: true,
    extend: null,
    executionId: ids(102),
    nodeId: 'build',
  });
  const transform = [execution(3, 'shape', 'transform', 'WAITING')];
  assert.equal(stuck({ code: 'AGENT_INTERRUPTED' }, transform).complete, false);
  assert.deepEqual(stuck({ code: 'EXECUTION_LIMIT', executionId: ids(101), limit: {} }, agent), {
    retry: false,
    fail: true,
    complete: false,
    extend: 'executions',
    executionId: ids(101),
    nodeId: 'start',
  });
  assert.equal(
    stuck(
      { code: 'EXECUTION_LIMIT', executionId: ids(101), limit: { scope: 'node', nodeId: 'build' } },
      agent,
    ).nodeId,
    'build',
  );
  assert.equal(
    stuck({ code: 'ACTIVE_TIME_LIMIT', executionId: ids(102) }, agent).extend,
    'activeMs',
  );
  // A run being cancelled can only be cancelled again.
  for (const controls of [
    stuck({ code: 'CANCEL_UNCONFIRMED' }, agent, { cancelRequested: true }),
    stuck({ code: 'HARNESS_UNAVAILABLE' }, agent, { cancelRequested: true }),
    runControls({ ...baseRun, state: 'RUNNING' } as Run),
  ])
    assert.deepEqual(
      [controls.retry, controls.fail, controls.complete, controls.extend],
      [false, false, false, null],
    );
});

test('the inbox lists pending requests and stuck runs from the projection, oldest first', () => {
  const projectId = ids(1);
  const workflowId = ids(2);
  const interaction = (n: number, state: Interaction['state'], createdAt: number) =>
    ({
      id: ids(10 + n),
      runId: ids(20 + n),
      executionId: ids(30 + n),
      node: 'review',
      kind: 'approval',
      state,
      revision: 1,
      title: `Ship ${n}?`,
      instructions: null,
      form: { type: 'object' },
      outcomes: ['approved', 'rejected'],
      expiresAt: null,
      createdAt,
      settledAt: null,
      runState: 'WAITING',
      response: null,
    }) as Interaction;
  const run = (n: number, state: Run['state'], createdAt: number) => ({
    id: ids(20 + n),
    state,
    workflowId,
    createdAt,
    finishedAt: null,
  });
  const items = attentionItems(
    {
      projects: [{ id: projectId, name: 'payments' }],
      workflows: [{ id: workflowId, projectId, name: 'Release review', activeVersionId: null }],
      runs: [run(1, 'WAITING', 5), run(2, 'NEEDS_HUMAN', 3), run(3, 'COMPLETED', 1)],
      attention: 2,
    },
    [interaction(1, 'PENDING', 6), interaction(3, 'RESPONDED', 2)],
  );
  assert.deepEqual(
    items.map((item) => [item.kind, item.runId, item.nodeId, item.workflowName, item.projectId]),
    [
      ['stuck', ids(22), null, 'Release review', projectId],
      ['request', ids(21), 'review', 'Release review', projectId],
    ],
  );
});

test('decisions and who made them read plainly', () => {
  assert.deepEqual(['approved', 'rejected', 'needs_changes'].map(outcomeLabel), [
    'Approve',
    'Reject',
    'Needs changes',
  ]);
  assert.equal(actorLabel({ kind: 'device', id: 'me' }, 'me'), 'this device');
  assert.equal(actorLabel({ kind: 'device', id: 'other' }, 'me'), 'another device');
  assert.equal(actorLabel({ kind: 'cli', id: 'local' }, 'me'), 'the server CLI');
});

const emptyOverview: Overview = { projects: [], workflows: [], runs: [], attention: 0 };
const paletteOverview: Overview = {
  projects: [{ id: ids(1), name: 'Billing' }],
  workflows: [
    { id: ids(2), projectId: ids(1), name: 'Deploy', activeVersionId: null },
    { id: ids(3), projectId: ids(1), name: 'Nightly report', activeVersionId: null },
  ],
  runs: [
    { id: ids(4), state: 'FAILED', workflowId: ids(3), createdAt: 100, finishedAt: 110 },
    { id: ids(5), state: 'RUNNING', workflowId: ids(2), createdAt: 200, finishedAt: null },
  ],
  attention: 0,
};
const noop = () => undefined;
const stuckItem: AttentionItem = {
  id: ids(9),
  kind: 'stuck',
  runId: ids(9),
  projectId: null,
  workflowId: null,
  workflowName: 'Deploy',
  nodeId: null,
  title: 'A run needs your decision',
  createdAt: 1,
  interaction: null,
};
const paletteDocument = readDocument({
  nodes: [{ id: 'review', type: 'approval', config: { title: 'Ship it?' } }],
  connections: [],
});

test('the empty palette lists attention, then actions, then recent workflows and runs', () => {
  const entries = paletteEntries(
    paletteOverview,
    [stuckItem],
    [{ id: 'settings', label: 'Open settings', run: noop }],
    paletteDocument,
    1000,
  );
  const view = paletteView(entries, '  ');
  assert.deepEqual(
    view.map((entry) => entry.group),
    ['Needs you', 'Actions', 'Workflows', 'Workflows', 'Runs', 'Runs'],
  );
  // The workflow that ran last comes first, and so does its run.
  assert.equal(view[2]!.label, 'Deploy');
  assert.equal(view[4]!.label, 'Deploy · Running');
  // Nodes and projects wait for a query.
  assert.ok(!view.some((entry) => entry.group === 'Nodes' || entry.group === 'Projects'));
  assert.deepEqual(paletteView(paletteEntries(emptyOverview, [], [], null, 0), ''), []);
});

test('a palette query searches everything and ranks label matches first', () => {
  const entries = paletteEntries(
    paletteOverview,
    [],
    [
      { id: 'report', label: 'Open the report', run: noop },
      { id: 'settings', label: 'Open settings', run: noop },
    ],
    paletteDocument,
    1000,
  );
  const labels = (query: string) => paletteView(entries, query).map((entry) => entry.label);
  assert.deepEqual(labels('report')[0], 'Open the report');
  assert.deepEqual(labels('nightly rep'), ['Nightly report', 'Nightly report · Failed']);
  // A prefix of the label beats a word inside it, whatever the group.
  assert.equal(labels('re')[0], 'review');
  // Words match across the label, the detail and hidden keywords.
  assert.deepEqual(labels('deploy billing'), ['Deploy']);
  assert.deepEqual(labels('ship it'), ['review']);
  assert.deepEqual(labels(ids(4)), ['Nightly report · Failed']);
  assert.equal(labels('billing')[0], 'Billing');
  assert.deepEqual(labels('no such thing'), []);
  const many = Array.from({ length: 200 }, (_, index) => ({
    id: String(index),
    label: `Open ${index}`,
    run: noop,
  }));
  assert.equal(paletteView(paletteEntries(emptyOverview, [], many, null, 0), 'open').length, 50);
});

test('only attention items that appear after the first look are announced', () => {
  const request = { id: ids(1), state: 'PENDING', title: 'Ship it?' } as Interaction;
  const first = announcements(null, [request], []);
  assert.deepEqual(first.fresh, []);
  const stuck = { id: ids(2), state: 'NEEDS_HUMAN' };
  const second = announcements(first.known, [request], [stuck, { id: ids(3), state: 'RUNNING' }]);
  assert.deepEqual(second.fresh, [{ id: ids(2), body: 'A run needs your decision' }]);
  assert.deepEqual(announcements(second.known, [], [stuck]).fresh, []);
  // A run that resumes and stops again is announced again.
  const resumed = announcements(second.known, [request], [{ ...stuck, state: 'RUNNING' }]);
  assert.deepEqual(resumed.fresh, []);
  assert.deepEqual(announcements(resumed.known, [request], [stuck]).fresh, [
    { id: ids(2), body: 'A run needs your decision' },
  ]);
  const settled = { id: ids(4), state: 'RESPONDED', title: 'Done' } as unknown as Interaction;
  assert.deepEqual(announcements(second.known, [settled], []).fresh, []);
});

test('preferences fall back to the defaults, and a bad file never applies', async () => {
  const store = new MemoryPreferenceStore();
  const runtime = new PreferenceRuntime(store);
  const applied: string[] = [];
  runtime.subscribe((value) => applied.push(value.theme));
  await store.save({ theme: 'neon', notifications: 'yes' } as unknown as Preferences);
  await runtime.load();
  assert.deepEqual(runtime.value, { theme: 'system', notifications: false });
  await runtime.set({ theme: 'dark', notifications: true });
  const again = new PreferenceRuntime(store);
  await again.load();
  assert.deepEqual(again.value, { theme: 'dark', notifications: true });
  assert.deepEqual(applied, ['system', 'dark']);
});

test('preference saves run one at a time, and the last choice is what stays', async () => {
  let saving = 0;
  let overlapped = false;
  let saved: Preferences | undefined;
  const runtime = new PreferenceRuntime({
    load: async () => undefined,
    save: async (preferences) => {
      overlapped ||= saving > 0;
      saving++;
      await new Promise((resolve) => setTimeout(resolve, preferences.theme === 'dark' ? 20 : 1));
      saved = preferences;
      saving--;
    },
  });
  await Promise.all([
    runtime.set({ theme: 'dark', notifications: false }),
    runtime.set({ theme: 'light', notifications: false }),
    runtime.set({ theme: 'system', notifications: true }),
  ]);
  assert.equal(overlapped, false);
  assert.deepEqual(saved, { theme: 'system', notifications: true });
});

test('switching servers starts a new first look, whatever order the projection changes in', () => {
  const request = (n: number) =>
    ({ id: ids(n), state: 'PENDING', title: `Request ${n}` }) as Interaction;
  const announce = announcer();
  const at = (...interactions: Interaction[]) => ({ interactions, runs: [] });
  assert.deepEqual(announce('a', at(request(1))), []);
  assert.deepEqual(announce('a', at(request(1), request(2))), [{ id: ids(2), body: 'Request 2' }]);
  // The new profile's cache arrives with what was already open there.
  assert.deepEqual(announce('b', at(request(3))), []);
  assert.deepEqual(announce('b', at(request(3), request(4))), [{ id: ids(4), body: 'Request 4' }]);
  // Forgotten and paired again.
  assert.deepEqual(announce(null, null), []);
  assert.deepEqual(announce('b', at(request(3))), []);
});
