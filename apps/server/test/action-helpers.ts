import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Credentials } from '../src/actions/credentials.js';
import { GitHubApi } from '../src/github/api.js';
import { GitHubIntegration } from '../src/github/integration.js';
import { ProcessRunner } from '../src/actions/process.js';
import { SystemdScopes } from '../src/harness/containment.js';
import type { HarnessAdapter, Json } from '../src/harness/types.js';
import { createLogger } from '../src/logging.js';
import { CommandReceipts } from '../src/persistence/receipts.js';
import { openStore, type Store } from '../src/persistence/store.js';
import { RunEngine } from '../src/runs/engine.js';
import { SecretBox } from '../src/secrets/secret-box.js';
import { normalizeDocument } from '../src/workflows/document.js';
import { DefinitionRepository } from '../src/workflows/repository.js';
import { Workspaces } from '../src/workspaces/workspaces.js';
import { openStore as reopenStore } from '../src/persistence/store.js';
import { FakeClock, eventually, temporaryState } from './helpers.js';

// Shared by the action and Git action tests: a run engine over a real repository, systemd scopes
// and credentials, without a harness.

export const scopes = new SystemdScopes('user');
const containment = await scopes.available();
// CI enables a user manager and sets this, so the tests fail there instead of skipping.
const required = process.env['SHIFT_TEST_REQUIRE_SYSTEMD'] === '1';
export const skip =
  !containment && !required && 'needs a systemd user manager (systemd-run --user)';
export const local = { kind: 'cli' as const, id: 'local' };

export interface Env {
  store: Store;
  engine: RunEngine;
  definitions: DefinitionRepository;
  credentials: Credentials;
  github: GitHubIntegration;
  clock: FakeClock;
  runner: ProcessRunner;
  repository: string;
  state: string;
  projectId: string;
  close(): Promise<void>;
}

// Actions need no harness; an agent node would fail loudly.
const noHarness = new Proxy(
  { id: 'none', storageNamespace: '/none' },
  {
    get: (target, key) =>
      key in target
        ? target[key as keyof typeof target]
        : () => {
            throw new Error('No harness in action tests.');
          },
  },
) as unknown as HarnessAdapter;

// A new state directory with a one-commit repository, or `reopen` an existing one as a restarted
// server would.
export async function setup(reopen?: string): Promise<Env> {
  const state = reopen ?? (await temporaryState()).path;
  const repository = join(state, 'repo');
  if (!reopen) {
    await mkdir(repository, { recursive: true });
    await writeFile(join(repository, 'notes.txt'), 'alpha beta\n');
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repository, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  }
  const clock = new FakeClock();
  const store = await openStore({ stateDirectory: state, clock });
  const receipts = new CommandReceipts(store.db, clock);
  const secrets = await SecretBox.open(state);
  const credentials = new Credentials(store.db, clock, secrets, receipts);
  const github = new GitHubIntegration(
    store.db,
    clock,
    secrets,
    receipts,
    new GitHubApi({ clock, timeoutMs: 5_000 }),
  );
  const runner = new ProcessRunner(scopes, `shift-action-test-${process.pid}-`);
  const definitions = new DefinitionRepository(store.db, clock);
  const engine = new RunEngine({
    store,
    definitions,
    receipts,
    workspaces: new Workspaces(store.db, clock, join(state, 'workspaces')),
    clock,
    logger: createLogger('silent'),
    adapter: noHarness,
    artifactRoot: join(state, 'artifacts'),
    credentials,
    github,
    runner,
  });
  engine.start();
  const projectId =
    definitions.projects()[0]?.id ??
    definitions.addProject({ name: 'repo', repositoryPath: repository, baseRef: 'main' }).id;
  return {
    store,
    engine,
    definitions,
    credentials,
    github,
    clock,
    runner,
    repository,
    state,
    projectId,
    async close() {
      await engine.stop(5_000);
      store.close();
    },
  };
}

// start -> action -> end, with the action's error port routed to a failing end when `routed`.
export function actionWorkflow(type: string, config: Json, node: Record<string, Json> = {}): Json {
  return {
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      { ...node, id: 'act', type, config },
      { id: 'end', type: 'end' },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'act', toPort: 'input' },
      { id: 'c2', fromNodeId: 'act', fromPort: 'success', toNodeId: 'end', toPort: 'input' },
    ],
  } as Json;
}

export async function run(env: Env, document: Json, input: Json = {}): Promise<string> {
  const workflow = env.definitions.createWorkflow({
    projectId: env.projectId,
    name: `w-${Math.random().toString(36).slice(2)}`,
    draft: normalizeDocument(document) as Json,
  }) as { id: string };
  env.definitions.publish(workflow.id);
  const response = await env.engine.startRun({ workflowId: workflow.id, input });
  return (response.body as { run: { id: string } }).run.id;
}

export type RunView = {
  id: string;
  state: string;
  outcome: { data?: Record<string, Json>; code?: string; details?: Record<string, Json> } | null;
  attention: { code: string; explanation: string } | null;
  executions: Array<{
    node: string;
    state: string;
    output: { data: Record<string, Json> } | null;
    error: { code: string; message: string; details?: Record<string, Json> } | null;
    attempts: Array<{ state: string }>;
    operations: Array<{
      key: string;
      state: string;
      evidence: Record<string, Json>;
      resolution: Json;
    }>;
  }>;
};

export const view = (env: Env, id: string) => env.engine.repository.run(id) as unknown as RunView;

export async function settled(env: Env, id: string, timeoutMs = 20_000): Promise<RunView> {
  return eventually(() => {
    const current = view(env, id);
    return ['RUNNING', 'WAITING', 'CANCEL_REQUESTED'].includes(current.state) ? undefined : current;
  }, timeoutMs);
}

export const action = (current: RunView) =>
  current.executions.find((entry) => entry.node === 'act')!;

type Step = {
  node: string;
  state: string;
  output: { data: Record<string, Json> } | null;
  error: { code: string; message: string; details?: Record<string, Json> } | null;
  operations: Array<{ state: string; evidence: Record<string, Json>; resolution: Json }>;
};
export const step = (env: Env, id: string, node: string) =>
  (view(env, id).executions as unknown as Step[]).filter((entry) => entry.node === node).at(-1)!;

// start -> each step in order -> end. Steps are [id, type, config, bindings?].
export function chain(steps: Array<[string, string, Json, Record<string, Json>?]>): Json {
  const ids = ['start', ...steps.map(([id]) => id), 'end'];
  return {
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      ...steps.map(([id, type, config, bindings]) => ({
        id,
        type,
        config,
        ...(bindings ? { bindings } : {}),
      })),
      { id: 'end', type: 'end' },
    ],
    connections: ids.slice(1).map((to, index) => ({
      id: `c${index}`,
      fromNodeId: ids[index]!,
      fromPort: 'success',
      toNodeId: to,
      toPort: 'input',
    })),
  } as Json;
}

// Rewinds a finished run to the moment `node`'s operation had been submitted and the server
// died, then lets `change` alter the world the way the crash left it, and restarts.
export async function interrupt(
  env: Env,
  id: string,
  node: string,
  change: (workspace: string, evidence: Record<string, Json>, operationId: string) => void,
): Promise<Env> {
  const evidence = step(env, id, node).operations[0]!.evidence;
  const workspace = (view(env, id) as unknown as { workspace: { path: string } | null }).workspace
    ?.path;
  await env.close();
  const store = await reopenStore({ stateDirectory: env.state, clock: new FakeClock() });
  const db = store.db;
  db.pragma('foreign_keys = OFF');
  const execution = db
    .prepare('SELECT id, sequence FROM node_executions WHERE run_id = ? AND node_id = ?')
    .get(id, node) as { id: string; sequence: number };
  db.prepare('DELETE FROM node_executions WHERE run_id = ? AND sequence > ?').run(
    id,
    execution.sequence,
  );
  db.prepare(
    "UPDATE node_executions SET state = 'RUNNING', output_json = NULL, error_json = NULL, selected_port = NULL, finished_at = NULL WHERE id = ?",
  ).run(execution.id);
  db.prepare(
    "UPDATE node_attempts SET state = 'RUNNING', finished_at = NULL, worker_generation = 'dead' WHERE execution_id = ?",
  ).run(execution.id);
  const operation = db
    .prepare('SELECT id FROM effect_operations WHERE execution_id = ? ORDER BY created_at LIMIT 1')
    .get(execution.id) as { id: string };
  db.prepare(
    "UPDATE effect_operations SET state = 'SUBMITTED', result_json = NULL, error_json = NULL WHERE execution_id = ?",
  ).run(execution.id);
  db.prepare(
    "UPDATE runs SET state = 'RUNNING', outcome_json = NULL, finished_at = NULL WHERE id = ?",
  ).run(id);
  store.close();
  change(workspace ?? '', evidence, operation.id);
  return setup(env.state);
}
