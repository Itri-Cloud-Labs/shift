import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Credentials } from '../src/actions/credentials.js';
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
  const credentials = new Credentials(store.db, clock, await SecretBox.open(state), receipts);
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
