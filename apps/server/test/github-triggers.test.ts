import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { createHttpServer } from '../src/http.js';
import { createLogger } from '../src/logging.js';
import { ReadinessState } from '../src/lifecycle/readiness.js';
import { ShiftError } from '../src/domain/errors.js';
import type { Json } from '../src/harness/types.js';
import { setup, local, type Env } from './action-helpers.js';
import { FakeGitHub } from './github-fake.js';
import { connected } from './github-helpers.js';
import { eventually } from './helpers.js';
import {
  cancel,
  delivery,
  heldFlow,
  occurrencesOf,
  publish,
  republish,
  runsOf,
  sign,
  withTriggers,
} from './trigger-helpers.js';

const minute = 60_000;
const prOpened = { type: 'github_trigger', config: { event: 'pull_request', actions: ['opened'] } };

const rejects = async (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error) => error instanceof ShiftError && error.code === code);

test('invalid signatures, identities and oversized payloads start nothing; a receipt survives restart', async () => {
  const { env, appRowId, fake } = await connected();
  let current: Env = env;
  try {
    const { webhooks } = withTriggers(env);
    const { workflowId } = publish(env, heldFlow(prOpened));
    const forged = delivery({ secret: 'whsec-someone-else-000' });
    await rejects(
      webhooks.receive(appRowId, forged.headers, forged.body),
      'GITHUB_SIGNATURE_INVALID',
    );
    const tampered = delivery();
    await rejects(
      webhooks.receive(appRowId, tampered.headers, Buffer.from(`${tampered.body} `)),
      'GITHUB_SIGNATURE_INVALID',
    );
    const stranger = delivery({ installation: 999 });
    await rejects(
      webhooks.receive(appRowId, stranger.headers, stranger.body),
      'GITHUB_UNKNOWN_INSTALLATION',
    );
    // Identities that are missing or malformed are refused, not recorded.
    for (const extra of [
      { installation: undefined },
      { installation: { id: '501' } },
      { installation: { id: -1 } },
      { repository: { name: 'widgets' } },
      { repository: { id: 9001.5 } },
    ] as Array<Record<string, Json>>) {
      const odd = delivery({ extra });
      await rejects(webhooks.receive(appRowId, odd.headers, odd.body), 'GITHUB_INVALID_IDENTITY');
    }
    // Over the 1 MiB trigger input limit but under the 2 MiB body limit.
    const large = delivery({ extra: { filler: 'x'.repeat(1_200_000) } });
    await rejects(webhooks.receive(appRowId, large.headers, large.body), 'REQUEST_TOO_LARGE');
    assert.equal(runsOf(env, workflowId).length, 0);
    assert.equal(
      (env.store.db.prepare('SELECT COUNT(*) AS n FROM github_deliveries').get() as { n: number })
        .n,
      0,
    );
    // A repository the installation reaches but no project binds is recorded and matches nothing.
    const unbound = delivery({ repository: 9002 });
    const quiet = await webhooks.receive(appRowId, unbound.headers, unbound.body);
    assert.equal(quiet.status, 202);
    assert.deepEqual(quiet.delivery.occurrences, []);
    // Even unmatched, the delivery is kept as GitHub sent it.
    const kept = env.store.db
      .prepare('SELECT payload_json FROM github_deliveries WHERE delivery_id = ?')
      .get(unbound.id) as { payload_json: string };
    assert.equal(kept.payload_json, unbound.body.toString());

    const valid = delivery();
    const first = await webhooks.receive(appRowId, valid.headers, valid.body);
    assert.equal(first.status, 202);
    assert.equal(first.duplicate, false);
    assert.equal(first.delivery.occurrences.length, 1);
    const admitted = first.delivery.occurrences[0]!;
    assert.equal(admitted.state, 'ADMITTED');
    const run = env.engine.repository.run(admitted.runId!) as {
      entryNodeId: string;
      occurrenceId: string;
    };
    assert.equal(run.entryNodeId, 'gh');
    assert.equal(run.occurrenceId, admitted.id);
    const trigger = (
      env.engine.repository.run(admitted.runId!) as {
        executions: Array<{ node: string; output: { data: Record<string, Json> } }>;
      }
    ).executions.find((entry) => entry.node === 'gh')!;
    assert.equal(trigger.output.data['event'], 'pull_request');
    assert.equal(trigger.output.data['deliveryId'], valid.id);
    assert.deepEqual(trigger.output.data['repository'], {
      id: 9001,
      owner: 'acme',
      name: 'widgets',
    });

    // After a restart the delivery is still known: GitHub's redelivery gets the original answer.
    await env.close();
    current = await setup(env.state);
    const restarted = withTriggers(current);
    const again = await restarted.webhooks.receive(appRowId, valid.headers, valid.body);
    assert.equal(again.status, 200);
    assert.equal(again.duplicate, true);
    assert.deepEqual(again.delivery, first.delivery);
    assert.equal(runsOf(current, workflowId).length, 1);
  } finally {
    await current.close().catch(() => {});
    await fake.stop();
  }
});

test('the webhook route verifies the raw body, limits its size and acknowledges after commit', async () => {
  const { env, appRowId, close } = await connected();
  const { triggers, webhooks } = withTriggers(env);
  const server = createHttpServer({
    store: env.store,
    clock: env.clock,
    readiness: new ReadinessState(),
    logger: createLogger('silent'),
    administrative: false,
    stop: () => {},
    devices: {} as never,
    triggers,
    webhooks,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v0/github/apps/${appRowId}/webhook`;
  try {
    const { workflowId } = publish(env, heldFlow(prOpened));
    // Re-serializing the JSON would change the bytes; the signature covers them exactly as sent.
    const spaced =
      '{ "action": "opened", "installation": {"id": 501}, "repository": {"id": 9001}, "pull_request": {"base": {"ref": "main"}} }';
    const post = (body: string, headers: Record<string, string>) =>
      fetch(url, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', ...headers },
      });
    const accepted = await post(spaced, {
      'x-github-delivery': 'raw-1',
      'x-github-event': 'pull_request',
      'x-hub-signature-256': sign(spaced),
    });
    assert.equal(accepted.status, 202);
    const body = (await accepted.json()) as { delivery: { occurrences: Array<{ state: string }> } };
    assert.equal(body.delivery.occurrences[0]!.state, 'ADMITTED');
    // The receipt was committed before the acknowledgement.
    assert.equal(runsOf(env, workflowId).length, 1);
    const huge = 'x'.repeat(2 * 1024 * 1024 + 10);
    const tooLarge = await post(huge, {
      'x-github-delivery': 'raw-2',
      'x-github-event': 'pull_request',
      'x-hub-signature-256': sign(huge),
    });
    assert.equal(tooLarge.status, 413);
    const unsigned = await post(spaced, {
      'x-github-delivery': 'raw-3',
      'x-github-event': 'pull_request',
    });
    assert.equal(unsigned.status, 401);
    assert.equal(runsOf(env, workflowId).length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await close();
  }
});

test('redeliveries and publication races keep exactly the occurrences first captured', async () => {
  const { env, appRowId, close } = await connected();
  try {
    const { webhooks } = withTriggers(env);
    const { workflowId, versionId: v1 } = publish(env, heldFlow(prOpened, 'allow'));
    const event = delivery();
    // The same delivery arriving twice at once is matched once.
    const [a, b] = await Promise.all([
      webhooks.receive(appRowId, event.headers, event.body),
      webhooks.receive(appRowId, event.headers, event.body),
    ]);
    assert.deepEqual([a.duplicate, b.duplicate].sort(), [false, true]);
    // Both name the same occurrences; the duplicate may answer before the run exists.
    assert.equal(a.delivery.id, b.delivery.id);
    assert.deepEqual(
      a.delivery.occurrences.map((o) => o.id),
      b.delivery.occurrences.map((o) => o.id),
    );
    // A later publication adds a second matching trigger; a redelivery still matches nothing new.
    const document = heldFlow(prOpened, 'allow') as { nodes: Json[]; connections: Json[] };
    const v2 = republish(env, workflowId, {
      ...document,
      nodes: [...document.nodes, { id: 'gh2', ...prOpened }],
      connections: [
        ...document.connections,
        { id: 'c3', fromNodeId: 'gh2', fromPort: 'success', toNodeId: 'hold', toPort: 'input' },
      ],
    }).versionId;
    assert.notEqual(v2, v1);
    const redelivered = await webhooks.receive(appRowId, event.headers, event.body);
    assert.equal(redelivered.duplicate, true);
    assert.equal(redelivered.delivery.occurrences.length, 1);
    const occurrences = occurrencesOf(env, workflowId);
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0]!.workflow_version_id, v1);
    assert.equal(runsOf(env, workflowId).length, 1);
    assert.equal(runsOf(env, workflowId)[0]!.workflow_version_id, v1);
    // A new delivery now matches both triggers, each its own occurrence of the new version.
    const fresh = delivery();
    const both = await webhooks.receive(appRowId, fresh.headers, fresh.body);
    assert.equal(both.delivery.occurrences.length, 2);
    assert.deepEqual(
      occurrencesOf(env, workflowId)
        .filter((row) => row.dedup_key === fresh.id)
        .map((row) => row.workflow_version_id),
      [v2, v2],
    );
    // Event, action and branch filters.
    const { workflowId: filtered } = publish(
      env,
      heldFlow({
        type: 'github_trigger',
        config: { event: 'pull_request', actions: ['opened'], branches: ['release/*'] },
      }),
    );
    for (const [options, matches] of [
      [{ base: 'main' }, false],
      [{ base: 'release/1.2' }, true],
      [{ base: 'release/1.3', action: 'closed' }, false],
      [{ base: 'release/1.4', event: 'issues' }, false],
    ] as const) {
      const sent = delivery(options);
      await webhooks.receive(appRowId, sent.headers, sent.body);
      assert.equal(
        occurrencesOf(env, filtered).some((row) => row.dedup_key === sent.id),
        matches,
        JSON.stringify(options),
      );
    }
  } finally {
    await close();
  }
});

test('what a delivery matched, the version it runs and its admission are fixed on arrival', async () => {
  const { env, appRowId, close } = await connected();
  try {
    let release!: () => void;
    let held = new Promise<void>((resolve) => (release = resolve));
    const { webhooks } = withTriggers(env, { gate: () => held });
    const { workflowId, versionId: v1 } = publish(env, heldFlow(prOpened, 'skip'));
    const sent = delivery();
    const receiving = webhooks.receive(appRowId, sent.headers, sent.body);
    // The occurrence is captured and accepted before the base commit is resolved.
    const accepted = await eventually(() =>
      occurrencesOf(env, workflowId).find((row) => row.state === 'ACCEPTED'),
    );
    assert.equal(accepted.workflow_version_id, v1);
    // A publication that drops the trigger, and a Pause, while the run is being created.
    republish(env, workflowId, {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        { id: 'end', type: 'end' },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'end', toPort: 'input' },
      ],
    });
    env.definitions.setEnabled(workflowId, false);
    // A restarted admitter finds the accepted occurrence and creates its run; the first one,
    // released afterwards, finds it admitted and creates nothing.
    const other = withTriggers(env);
    await other.triggers.drain();
    release();
    const result = await receiving;
    assert.equal(result.delivery.occurrences.length, 1);
    assert.equal(result.delivery.occurrences[0]!.state, 'ADMITTED');
    const runs = runsOf(env, workflowId);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.workflow_version_id, v1);
    // An accepted occurrence counts against overlap while its run is being created.
    env.definitions.setEnabled(workflowId, true);
    held = new Promise<void>((resolve) => (release = resolve));
    const { workflowId: busy } = publish(env, heldFlow(prOpened, 'skip'));
    cancel(env, runs[0]!.id);
    const first = delivery();
    const pending = webhooks.receive(appRowId, first.headers, first.body);
    await eventually(() => occurrencesOf(env, busy).find((row) => row.state === 'ACCEPTED'));
    const second = delivery();
    const skipped = await other.webhooks.receive(appRowId, second.headers, second.body);
    assert.equal(skipped.delivery.occurrences.find((o) => o.workflowId === busy)!.state, 'SKIPPED');
    await assert.rejects(env.engine.startRun({ workflowId: busy }), /unfinished/);
    release();
    await pending;
    assert.equal(runsOf(env, busy).length, 1);
  } finally {
    await close();
  }
});

test('one App serves several projects through one endpoint, each through its own binding', async () => {
  const env = await setup();
  const clocked = new FakeGitHub(env.clock);
  clocked.installations[0]!.repositoryIds = [9001, 9002];
  await clocked.start();
  const { appRowId, close } = await connected({ env, fake: clocked });
  try {
    const second = join(env.state, 'second');
    await mkdir(second, { recursive: true });
    await writeFile(join(second, 'a.txt'), 'a\n');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: second, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
    const other = env.definitions.addProject({
      name: 'second',
      repositoryPath: second,
      baseRef: 'main',
    }).id;
    const app = env.github.apps()[0]!;
    await env.github.connect(
      other,
      { installationId: app.installations[0]!.id, repositoryId: 9002 },
      local,
    );
    const { webhooks } = withTriggers(env);
    const widgets = publish(env, heldFlow(prOpened)).workflowId;
    const secret = publish(env, heldFlow(prOpened), other).workflowId;
    assert.equal(app.webhookPath, `/api/v0/github/apps/${appRowId}/webhook`);
    const toSecret = delivery({ repository: 9002 });
    const result = await webhooks.receive(appRowId, toSecret.headers, toSecret.body);
    assert.deepEqual(
      result.delivery.occurrences.map((occurrence) => occurrence.workflowId),
      [secret],
    );
    assert.equal(runsOf(env, widgets).length, 0);
    assert.equal(runsOf(env, secret).length, 1);
    const toWidgets = delivery({ repository: 9001 });
    const widgetsResult = await webhooks.receive(appRowId, toWidgets.headers, toWidgets.body);
    assert.deepEqual(
      widgetsResult.delivery.occurrences.map((occurrence) => occurrence.workflowId),
      [widgets],
    );
    // Unbinding a project stops its deliveries; the other keeps working.
    env.github.disconnect(other, {}, local);
    const late = delivery({ repository: 9002 });
    assert.deepEqual(
      (await webhooks.receive(appRowId, late.headers, late.body)).delivery.occurrences,
      [],
    );
  } finally {
    await close();
  }
});

test('skip, queue and allow decide per workflow; Pause and publication keep captured versions', async () => {
  const { env, appRowId, close } = await connected();
  try {
    const { triggers, webhooks } = withTriggers(env);
    const send = async () => {
      const sent = delivery();
      return (await webhooks.receive(appRowId, sent.headers, sent.body)).delivery.occurrences;
    };
    // skip: a second event while the first run waits is recorded as skipped.
    const skip = publish(env, heldFlow(prOpened, 'skip')).workflowId;
    // allow: both run.
    const allow = publish(env, heldFlow(prOpened, 'allow')).workflowId;
    // queue: the second waits for the first, with the version it captured.
    const queue = publish(env, heldFlow(prOpened, 'queue', 'First'));
    const first = await send();
    const byWorkflow = (list: typeof first, id: string) => list.find((o) => o.workflowId === id)!;
    assert.equal(byWorkflow(first, skip).state, 'ADMITTED');
    const second = await send();
    assert.equal(byWorkflow(second, skip).state, 'SKIPPED');
    assert.equal(byWorkflow(second, skip).reason, 'OVERLAP');
    assert.equal(byWorkflow(second, allow).state, 'ADMITTED');
    assert.equal(byWorkflow(second, queue.workflowId).state, 'QUEUED');
    assert.equal(runsOf(env, allow).length, 2);
    assert.equal(runsOf(env, skip).length, 1);

    // A new version and a Pause while the occurrence waits.
    const v2 = republish(env, queue.workflowId, heldFlow(prOpened, 'queue', 'Second')).versionId;
    env.definitions.setEnabled(queue.workflowId, false);
    const paused = await send();
    assert.equal(byWorkflow(paused, queue.workflowId).state, 'SKIPPED');
    assert.equal(byWorkflow(paused, queue.workflowId).reason, 'WORKFLOW_PAUSED');
    // The admitted run continues through Pause; finishing it frees the workflow, but a paused
    // workflow admits nothing from its queue.
    const [running] = runsOf(env, queue.workflowId);
    cancel(env, running!.id);
    await eventually(() =>
      runsOf(env, queue.workflowId)[0]!.state === 'CANCELLED' ? true : undefined,
    );
    await triggers.drain();
    assert.equal(runsOf(env, queue.workflowId).length, 1);
    // A manual start of a paused workflow is refused too.
    await rejects(env.engine.startRun({ workflowId: queue.workflowId }), 'WORKFLOW_DISABLED');
    env.definitions.setEnabled(queue.workflowId, true);
    await triggers.drain();
    await triggers.drain();
    const runs = runsOf(env, queue.workflowId);
    assert.equal(runs.length, 2);
    // The queued occurrence runs the version it captured, not the one published since.
    assert.equal(runs[1]!.workflow_version_id, queue.versionId);
    assert.notEqual(runs[1]!.workflow_version_id, v2);
    const queued = occurrencesOf(env, queue.workflowId).find((row) => row.run_id === runs[1]!.id)!;
    assert.equal(queued.state, 'ADMITTED');
    assert.equal(runs[1]!.occurrence_id, queued.id);
    // Draining again admits nothing twice.
    await triggers.drain();
    assert.equal(runsOf(env, queue.workflowId).length, 2);
    // Manual starts honour the policy unless the owner overrides it for that start.
    await rejects(env.engine.startRun({ workflowId: skip }), 'WORKFLOW_BUSY');
    const forced = await env.engine.startRun({ workflowId: skip, allowOverlap: true });
    assert.equal(forced.status, 201);
    // A workflow with only a GitHub trigger cannot be started by hand.
    const automatic = publish(env, {
      nodes: [
        { id: 'gh', ...prOpened },
        { id: 'end', type: 'end' },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'gh', fromPort: 'success', toNodeId: 'end', toPort: 'input' },
      ],
    }).workflowId;
    await rejects(env.engine.startRun({ workflowId: automatic }), 'NO_MANUAL_TRIGGER');
    // Occurrence history, newest first.
    const page = triggers.occurrences({ workflowId: queue.workflowId, limit: 2 });
    assert.equal(page.occurrences.length, 2);
    assert.ok(page.nextBefore !== null);
    assert.equal(
      triggers.occurrences({ workflowId: queue.workflowId, before: page.nextBefore! }).occurrences
        .length,
      1,
    );
  } finally {
    await close();
  }
});

test('a rotated webhook secret verifies deliveries only inside the window the owner chose', async () => {
  const { env, appRowId, close } = await connected();
  try {
    const { webhooks } = withTriggers(env);
    publish(env, heldFlow(prOpened, 'allow'));
    await env.github.rotate(
      appRowId,
      { webhookSecret: 'whsec-next-0123456789', previousSecretMinutes: 10 },
      local,
    );
    const old = delivery();
    assert.equal((await webhooks.receive(appRowId, old.headers, old.body)).status, 202);
    const fresh = delivery({ secret: 'whsec-next-0123456789' });
    assert.equal((await webhooks.receive(appRowId, fresh.headers, fresh.body)).status, 202);
    assert.ok(env.github.apps()[0]!.previousWebhookSecretUntil);
    env.clock.advance(11 * minute);
    const late = delivery();
    await rejects(webhooks.receive(appRowId, late.headers, late.body), 'GITHUB_SIGNATURE_INVALID');
    assert.equal(env.github.apps()[0]!.previousWebhookSecretUntil, null);
    // Without a window the old secret stops at once.
    await env.github.rotate(appRowId, { webhookSecret: 'whsec-third-0123456789' }, local);
    const replaced = delivery({ secret: 'whsec-next-0123456789' });
    await rejects(
      webhooks.receive(appRowId, replaced.headers, replaced.body),
      'GITHUB_SIGNATURE_INVALID',
    );
  } finally {
    await close();
  }
});

test('a checks event brings forward the next read of a wait on its commit in that repository', async () => {
  const { env, appRowId, fake, close } = await connected();
  try {
    const { webhooks } = withTriggers(env);
    const sha = 'b'.repeat(40);
    fake.checkRuns.push({
      id: 1,
      name: 'build',
      head_sha: sha,
      status: 'in_progress',
      conclusion: null,
    });
    const { workflowId } = publish(env, {
      execution: { overlap: 'allow' },
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        {
          id: 'act',
          type: 'github_wait_checks',
          config: { commit: sha, intervalMs: 10 * minute, timeoutMs: 60 * minute },
        },
        { id: 'end', type: 'end' },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'act', toPort: 'input' },
        { id: 'c2', fromNodeId: 'act', fromPort: 'success', toNodeId: 'end', toPort: 'input' },
      ],
    });
    const started = await env.engine.startRun({ workflowId });
    const runId = (started.body as { run: { id: string } }).run.id;
    const due = () =>
      (
        env.store.db
          .prepare("SELECT due_at FROM wakeups WHERE run_id = ? AND state = 'PENDING'")
          .get(runId) as { due_at: number } | undefined
      )?.due_at;
    const firstDue = await eventually(due, 20_000);
    assert.ok(firstDue > env.clock.now() + 5 * minute);
    // Another repository's event for the same commit changes nothing.
    const elsewhere = delivery({
      event: 'check_run',
      action: 'completed',
      repository: 9002,
      extra: { check_run: { head_sha: sha, check_suite: { head_branch: 'work' } } },
    });
    await webhooks.receive(appRowId, elsewhere.headers, elsewhere.body);
    assert.equal(due(), firstDue);
    fake.checkRuns[0]!.status = 'completed';
    fake.checkRuns[0]!.conclusion = 'success';
    const done = delivery({
      event: 'check_run',
      action: 'completed',
      extra: { check_run: { head_sha: sha, check_suite: { head_branch: 'work' } } },
    });
    await webhooks.receive(appRowId, done.headers, done.body);
    const finished = await eventually(() => {
      const run = env.engine.repository.run(runId) as { state: string };
      return run.state === 'COMPLETED' ? run : undefined;
    }, 20_000);
    assert.equal(finished.state, 'COMPLETED');
  } finally {
    await close();
  }
});
