import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Interaction, Run } from '../src/protocol/generated/types.js';
import { actorLabel, attentionItems, outcomeLabel, runControls } from '../src/client-ui/owner.js';
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
