import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyInvocation, type InvocationEvidence } from '../src/harness/opencode/classify.js';
import { parseEventBlock } from '../src/harness/opencode/client.js';
import { compilePermissions } from '../src/harness/opencode/permissions.js';
import { namespaceEnvironment, namespaceLayout } from '../src/harness/opencode/namespace.js';
import { startResultEndpoint } from '../src/harness/opencode/result-endpoint.js';
import { harnessSessionId, providerMessageId } from '../src/harness/opencode/adapter.js';
import type { ResultSubmission } from '../src/harness/types.js';

const evidence = (overrides: Partial<InvocationEvidence>): InvocationEvidence => ({
  messageFound: true,
  queued: false,
  active: false,
  prompts: [],
  turn: [],
  followedByUserMessage: false,
  ...overrides,
});
const assistant = (overrides: Record<string, unknown> = {}) => ({
  id: 'msg_a',
  type: 'assistant',
  ...overrides,
});

test('classification follows the recorded evidence order', () => {
  const classify = (overrides: Partial<InvocationEvidence>) =>
    classifyInvocation(evidence(overrides)).kind;
  assert.equal(classify({ messageFound: false }), 'not_accepted');
  assert.equal(classify({ messageFound: false, queued: true }), 'queued');
  // A pending harness prompt keeps the session active; it must still be reported as a prompt.
  assert.equal(
    classify({ active: true, prompts: [{ kind: 'permission', id: 'per_1' }] }),
    'awaiting_harness_prompt',
  );
  assert.equal(classify({ active: true }), 'running');
  assert.equal(
    classify({ turn: [assistant(), { id: 'i', type: 'idle', outcome: 'succeeded' }] }),
    'ended',
  );
  assert.equal(
    classify({ turn: [assistant(), { id: 'i', type: 'idle', outcome: 'interrupted' }] }),
    'interrupted',
  );
  assert.equal(classify({ turn: [] }), 'interrupted', 'no assistant step means no tool effects');
  assert.equal(
    classify({ turn: [assistant({ finish: 'error', error: { type: 'aborted' } })] }),
    'interrupted',
    'a dismissed question aborts the step without an idle record',
  );
});

test('crash evidence is unknown, including after OpenCode relabels the stale tool', () => {
  const crashed = assistant({
    content: [{ type: 'tool', state: { status: 'running' } }],
  });
  assert.equal(classifyInvocation(evidence({ turn: [crashed] })).kind, 'unknown');
  const relabelled = assistant({
    finish: 'error',
    error: { type: 'aborted' },
    content: [{ type: 'tool', state: { status: 'error' } }],
  });
  assert.equal(
    classifyInvocation(evidence({ turn: [relabelled], followedByUserMessage: true })).kind,
    'unknown',
  );
  // A later active turn belongs to another invocation, not to this one.
  assert.equal(
    classifyInvocation(evidence({ active: true, turn: [crashed], followedByUserMessage: true }))
      .kind,
    'unknown',
  );
});

test('ended observations list only assistant messages of the turn', () => {
  const observation = classifyInvocation(
    evidence({
      turn: [
        assistant({ id: 'msg_1' }),
        assistant({ id: 'msg_2' }),
        { id: 'msg_3', type: 'idle', outcome: 'failed' },
      ],
    }),
  );
  assert.deepEqual(observation, {
    kind: 'ended',
    outcome: 'failed',
    messageIds: ['msg_1', 'msg_2'],
  });
});

test('unattended permissions turn every ask into deny and keep agent ordering', () => {
  const defaults = [
    { action: '*', resource: '*', effect: 'allow' as const },
    { action: 'read', resource: '*.env.*', effect: 'ask' as const },
    { action: 'read', resource: '*.env.example', effect: 'allow' as const },
    { action: 'question', resource: '*', effect: 'allow' as const },
  ];
  const rules = compilePermissions(defaults, { mode: 'workspace_write' }, '/art');
  assert.ok(rules.every((rule) => rule.effect !== 'ask'));
  assert.deepEqual(
    rules.slice(0, 4).map((rule) => rule.effect),
    ['allow', 'deny', 'allow', 'allow'],
  );
  assert.deepEqual(rules.at(-2), { action: 'question', resource: '*', effect: 'deny' });
  assert.deepEqual(rules.at(-1), { action: 'edit', resource: '/art/*', effect: 'allow' });
});

test('read-only permissions deny edit and shell, then allow only the artifact directory', () => {
  const rules = compilePermissions([], { mode: 'read_only' }, '/art');
  assert.deepEqual(rules, [
    { action: 'question', resource: '*', effect: 'deny' },
    { action: 'edit', resource: '*', effect: 'deny' },
    { action: 'shell', resource: '*', effect: 'deny' },
    { action: 'edit', resource: '/art/*', effect: 'allow' },
  ]);
  assert.equal(compilePermissions([], { mode: 'read_only' }).length, 3);
});

test('the namespace environment contains only private paths and PATH', () => {
  const layout = namespaceLayout('/state');
  const env = namespaceEnvironment(layout, {
    PATH: '/bin',
    HOME: '/root',
    OPENAI_API_KEY: 'secret',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus',
  });
  assert.deepEqual(Object.keys(env).sort(), [
    'HOME',
    'LANG',
    'PATH',
    'TMPDIR',
    'XDG_CACHE_HOME',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_STATE_HOME',
  ]);
  assert.equal(env['HOME'], '/state/harness/opencode/home');
  assert.ok(Object.values(env).every((value) => !value.includes('secret')));
});

test('harness identifiers derive deterministically from Shift identifiers', () => {
  const id = '0b1c2d3e-4f50-4a61-8b72-9c83d94ea5f6';
  assert.equal(harnessSessionId(id), 'ses_0b1c2d3e4f504a618b729c83d94ea5f6');
  assert.equal(providerMessageId(id), 'msg_0b1c2d3e4f504a618b729c83d94ea5f6');
});

test('the result endpoint requires its token and forwards well-formed submissions', async () => {
  const received: ResultSubmission[] = [];
  const endpoint = await startResultEndpoint(async (submission) => {
    received.push(submission);
    return received.length === 1 ? { accepted: false, reason: 'try again' } : { accepted: true };
  });
  const post = (body: unknown, authorization?: string) =>
    fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    });
  const call = {
    sessionID: 'ses_1',
    messageID: 'msg_1',
    callID: 'toolu_1',
    input: { status: 'completed' },
  };
  try {
    assert.equal((await post(call)).status, 401);
    assert.equal((await post(call, 'Bearer wrong')).status, 401);
    const bearer = `Bearer ${endpoint.token}`;
    assert.equal((await post({ sessionID: 'ses_1' }, bearer)).status, 400);
    assert.deepEqual(await (await post(call, bearer)).json(), {
      accepted: false,
      reason: 'try again',
    });
    assert.deepEqual(await (await post(call, bearer)).json(), { accepted: true });
    assert.deepEqual(received[0], {
      harnessSessionId: 'ses_1',
      assistantMessageId: 'msg_1',
      toolCallId: 'toolu_1',
      input: { status: 'completed' },
    });
  } finally {
    await endpoint.close();
  }
});

test('a failing result handler is reported as not recorded', async () => {
  const endpoint = await startResultEndpoint(async () => {
    throw new Error('database unavailable');
  });
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${endpoint.token}` },
      body: JSON.stringify({ sessionID: 's', messageID: 'm', callID: 'c', input: {} }),
    });
    assert.equal(response.status, 500);
    assert.equal(((await response.json()) as { accepted: boolean }).accepted, false);
  } finally {
    await endpoint.close();
  }
});

test('SSE blocks parse to typed events and ignore heartbeats and malformed data', () => {
  assert.deepEqual(parseEventBlock('data: {"type":"session.created","data":{"sessionID":"s"}}'), {
    type: 'session.created',
    data: { sessionID: 's' },
  });
  assert.equal(parseEventBlock(': heartbeat'), null);
  assert.equal(parseEventBlock('data: not json'), null);
  assert.equal(parseEventBlock('data: {"no":"type"}'), null);
});
