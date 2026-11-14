import { createHmac } from 'node:crypto';
import { GitHubWebhooks } from '../src/github/webhooks.js';
import type { Json } from '../src/harness/types.js';
import { createLogger } from '../src/logging.js';
import { Scheduler } from '../src/triggers/scheduler.js';
import { TriggerService } from '../src/triggers/service.js';
import { normalizeDocument } from '../src/workflows/document.js';
import { Workspaces } from '../src/workspaces/workspaces.js';
import { local, type Env } from './action-helpers.js';
import { webhookSecret } from './github-helpers.js';

// Trigger admission over an action test environment. The trigger service is created before any
// workflow is published, as the server does, so publications materialize subscriptions.
export function withTriggers(
  env: Env,
  options: { gate?: () => Promise<void> } = {},
): { triggers: TriggerService; webhooks: GitHubWebhooks } {
  const workspaces = new Workspaces(env.store.db, env.clock, `${env.state}/workspaces`);
  const triggers = new TriggerService({
    db: env.store.db,
    clock: env.clock,
    definitions: env.definitions,
    logger: createLogger('silent'),
    resolveBase: async (projectId) => {
      await options.gate?.();
      const project = env.definitions.project(projectId);
      return workspaces.resolveBase(project.repositoryPath, project.baseRef);
    },
  });
  triggers.attach(env.engine);
  new Scheduler({ db: env.store.db, clock: env.clock, triggers });
  const webhooks = new GitHubWebhooks({
    db: env.store.db,
    clock: env.clock,
    github: env.github,
    triggers,
    wake: () => env.engine.wake(),
  });
  return { triggers, webhooks };
}

// Publishes a workflow and returns its ID and active version.
export function publish(env: Env, document: Json, projectId = env.projectId) {
  const workflow = env.definitions.createWorkflow({
    projectId,
    name: `w-${Math.random().toString(36).slice(2)}`,
    draft: normalizeDocument(document) as Json,
  }) as { id: string };
  return republish(env, workflow.id, document);
}

export function republish(env: Env, workflowId: string, document: Json) {
  const current = env.definitions.workflow(workflowId) as { draftRevision: number };
  env.store.db
    .transaction(() => {
      env.definitions.saveDraft(
        workflowId,
        current.draftRevision,
        normalizeDocument(document) as Json,
      );
      env.definitions.publish(workflowId);
    })
    .immediate();
  const published = env.definitions.workflow(workflowId) as { activeVersionId: string };
  return { workflowId, versionId: published.activeVersionId };
}

// trigger -> an approval that keeps the run waiting -> end.
export function heldFlow(trigger: Record<string, Json>, overlap = 'skip', title = 'Hold'): Json {
  return {
    execution: { overlap },
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      { id: 'gh', ...trigger },
      { id: 'hold', type: 'approval', config: { title } },
      { id: 'end', type: 'end' },
    ],
    connections: [
      { id: 'c0', fromNodeId: 'start', fromPort: 'success', toNodeId: 'hold', toPort: 'input' },
      { id: 'c1', fromNodeId: 'gh', fromPort: 'success', toNodeId: 'hold', toPort: 'input' },
      { id: 'c2', fromNodeId: 'hold', fromPort: 'approved', toNodeId: 'end', toPort: 'input' },
    ],
  } as Json;
}

export const sign = (body: string, secret = webhookSecret) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

let deliveries = 0;

// A pull request event for repository 9001 through installation 501, signed like GitHub signs it.
export function delivery(
  options: {
    id?: string;
    event?: string;
    action?: string;
    repository?: number;
    installation?: number;
    base?: string;
    extra?: Record<string, Json>;
    secret?: string;
  } = {},
): { headers: Record<string, string>; body: Buffer; id: string } {
  const id = options.id ?? `d-${++deliveries}-${Math.random().toString(36).slice(2)}`;
  const payload = {
    action: options.action ?? 'opened',
    installation: { id: options.installation ?? 501 },
    repository: { id: options.repository ?? 9001, name: 'widgets', owner: { login: 'acme' } },
    sender: { login: 'octocat' },
    pull_request: { number: 7, base: { ref: options.base ?? 'main' }, head: { ref: 'work' } },
    ...options.extra,
  };
  const body = JSON.stringify(payload);
  return {
    id,
    body: Buffer.from(body),
    headers: {
      'x-github-delivery': id,
      'x-github-event': options.event ?? 'pull_request',
      'x-hub-signature-256': sign(body, options.secret),
      'content-type': 'application/json',
    },
  };
}

export const runsOf = (env: Env, workflowId: string) =>
  env.store.db
    .prepare(
      'SELECT id, state, workflow_version_id, occurrence_id FROM runs WHERE workflow_id = ? ORDER BY created_at, rowid',
    )
    .all(workflowId) as Array<{
    id: string;
    state: string;
    workflow_version_id: string;
    occurrence_id: string | null;
  }>;

export const occurrencesOf = (env: Env, workflowId: string) =>
  env.store.db
    .prepare(
      'SELECT id, state, reason, run_id, workflow_version_id, dedup_key FROM trigger_occurrences WHERE workflow_id = ? ORDER BY ordinal',
    )
    .all(workflowId) as Array<{
    id: string;
    state: string;
    reason: string | null;
    run_id: string | null;
    workflow_version_id: string;
    dedup_key: string;
  }>;

export const cancel = (env: Env, runId: string) =>
  env.engine.controlRun(runId, 'cancel', { reason: 'test' }, local);
