import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  validateCommandReceiptResponse,
  validateInteractionList,
  validateProtocolError,
  validateRunResponse,
} from '../src/protocol/index.js';
import { runCli, startChild, temporaryState } from './helpers.js';

// Pairs a device through the CLI and the public pairing route.
async function pairDevice(url: string, state: string, name: string): Promise<string> {
  const issued = await runCli(['device', 'pair', '--state-dir', state]);
  const { phrase } = JSON.parse(issued.output) as { phrase: string };
  const response = await fetch(`${url}/api/v0/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phrase, deviceName: name, commandId: `pair-${name}` }),
  });
  return ((await response.json()) as { token: string }).token;
}

test('a paired device drives runs and answers approvals with its own command receipts', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const repository = join(state.path, 'repo');
  await mkdir(repository);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repository });
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'],
    { cwd: repository },
  );
  const server = await startChild(state.path);
  t.after(() => server.terminate());
  const laptop = await pairDevice(server.url, state.path, 'laptop');
  const desktop = await pairDevice(server.url, state.path, 'desktop');
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const response = await fetch(`${server.url}/api/v0${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };

  // Mutations from a device must carry a command ID.
  const unnamed = await call(laptop, 'POST', '/projects', { path: repository });
  assert.equal(unnamed.status, 422);
  assert.equal(unnamed.body['code'], 'INVALID_REQUEST');
  const project = await call(laptop, 'POST', '/projects', {
    path: repository,
    commandId: 'project-command-1',
  });
  assert.equal(project.status, 201);
  const workflow = await call(laptop, 'POST', '/workflows', {
    projectId: project.body['project'].id,
    name: 'Review',
    draft: {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        { id: 'review', type: 'approval', config: { title: 'Ship it?' } },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'review', toPort: 'input' },
      ],
    },
    commandId: 'workflow-command-1',
  });
  assert.equal(workflow.status, 201);
  const workflowId = workflow.body['workflow'].id as string;
  assert.equal(
    (await call(laptop, 'POST', `/workflows/${workflowId}/publish`, { commandId: 'publish-1' }))
      .status,
    200,
  );
  const started = await call(laptop, 'POST', '/runs', { workflowId, commandId: 'start-run-1' });
  assert.equal(started.status, 201);
  assert(validateRunResponse(started.body));
  const runId = started.body.run.id;

  const pending = await call(desktop, 'GET', '/interactions');
  assert(validateInteractionList(pending.body));
  const [request] = pending.body.interactions;
  assert.equal(request!.runId, runId);

  // A stale revision is refused before anything is recorded.
  const stale = await call(laptop, 'POST', `/interactions/${request!.id}/respond`, {
    revision: 3,
    decision: 'approved',
    commandId: 'respond-stale',
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body['code'], 'REVISION_CONFLICT');

  // The laptop answers, and its response is lost on the way back.
  const answer = { revision: 0, decision: 'approved', commandId: 'respond-1' };
  await call(laptop, 'POST', `/interactions/${request!.id}/respond`, answer);
  const receipt = await call(laptop, 'GET', '/commands/respond-1');
  assert.equal(receipt.status, 200);
  assert(validateCommandReceiptResponse(receipt.body));
  assert.equal(receipt.body.receipt.status, 200);
  const stored = receipt.body.receipt.body as { interaction: { state: string; response: unknown } };
  assert.equal(stored.interaction.state, 'RESPONDED');
  assert.deepEqual((stored.interaction.response as { actor: unknown }).actor, {
    kind: 'device',
    id: (await call(laptop, 'GET', '/devices')).body['currentDeviceId'],
  });
  // Resending the identical command returns the same answer; a different body conflicts.
  const resent = await call(laptop, 'POST', `/interactions/${request!.id}/respond`, answer);
  assert.equal(resent.status, 200);
  assert.deepEqual(resent.body['interaction'], stored.interaction);
  const changed = await call(laptop, 'POST', `/interactions/${request!.id}/respond`, {
    ...answer,
    decision: 'rejected',
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.body['code'], 'COMMAND_CONFLICT');
  // Another device answering is a conflict with the accepted decision.
  const late = await call(desktop, 'POST', `/interactions/${request!.id}/respond`, {
    revision: 1,
    decision: 'rejected',
    commandId: 'respond-2',
  });
  assert.equal(late.status, 409);
  assert.equal(late.body['code'], 'INTERACTION_CONFLICT');

  // Receipts are scoped to their device.
  const foreign = await call(desktop, 'GET', '/commands/respond-1');
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body['code'], 'COMMAND_NOT_FOUND');

  const run = await call(desktop, 'GET', `/runs/${runId}`);
  assert(validateRunResponse(run.body));
  assert.equal(run.body.run.state, 'COMPLETED');
  assert.deepEqual(
    run.body.run.executions.map((execution) => execution.node),
    ['start', 'review'],
  );

  // Without a token nothing is served; administration never is.
  const anonymous = await fetch(`${server.url}/api/v0/runs`);
  assert.equal(anonymous.status, 401);
  assert(validateProtocolError(await anonymous.json()));
  const adminOverTcp = await call(laptop, 'GET', '/admin/runs');
  assert.equal(adminOverTcp.status, 404);
  // Commands from the local CLI keep their own actor.
  const local = await runCli(['run', 'list', '--state-dir', state.path]);
  assert.equal(local.code, 0, local.errors);
  assert.equal((JSON.parse(local.output) as unknown[]).length, 1);
});
