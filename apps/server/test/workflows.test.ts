import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { Json } from '../src/harness/types.js';
import { CommandReceipts } from '../src/persistence/receipts.js';
import { openStore, type Store } from '../src/persistence/store.js';
import {
  diagnose,
  documentHash,
  normalizeDocument,
  type WorkflowDocument,
} from '../src/workflows/document.js';
import { DefinitionRepository } from '../src/workflows/repository.js';
import { DefinitionService } from '../src/workflows/service.js';
import { FakeClock, temporaryState } from './helpers.js';

const base = (): Record<string, unknown> => ({
  nodes: [
    { id: 'start', type: 'manual_trigger' },
    {
      id: 'shape',
      type: 'transform',
      config: { data: { greeting: { $binding: 'name' } } },
      bindings: { name: { kind: 'trigger', path: ['name'] } },
    },
    { id: 'end', type: 'end' },
  ],
  connections: [
    { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'shape', toPort: 'input' },
    { id: 'c2', fromNodeId: 'shape', fromPort: 'success', toNodeId: 'end', toPort: 'input' },
  ],
});

const problems = (document: unknown) =>
  diagnose(normalizeDocument(document)).map((problem) => problem.message);

function variant(change: (document: Record<string, any>) => void): Record<string, unknown> {
  const document = base() as Record<string, any>;
  change(document);
  return document;
}

test('a minimal document normalizes to the full format and validates', () => {
  const document = normalizeDocument(base()) as WorkflowDocument;
  assert.deepEqual(diagnose(document), []);
  assert.equal(document.formatVersion, 1);
  assert.deepEqual(document.execution.workspace, { kind: 'new' });
  assert.equal(document.nodes[1]!.typeVersion, 1);
  assert.deepEqual(document.nodes[1]!.retry, {
    maxAttempts: 1,
    initialDelayMs: 1000,
    maxDelayMs: 60000,
  });
});

test('validation rejects graphs the executor cannot run', () => {
  const cases: Array<[string, (document: Record<string, any>) => void, RegExp]> = [
    ['unknown type', (d) => (d.nodes[1].type = 'teleport'), /Unknown node type teleport/],
    [
      'unknown version',
      (d) => (d.nodes[1].typeVersion = 9),
      /Unknown node type transform version 9/,
    ],
    ['duplicate node', (d) => (d.nodes[2].id = 'shape'), /Duplicate node id shape/],
    [
      'two edges from one port',
      (d) =>
        d.connections.push({
          id: 'c3',
          fromNodeId: 'shape',
          fromPort: 'success',
          toNodeId: 'start',
          toPort: 'input',
        }),
      /already has an outgoing connection/,
    ],
    [
      'edge into the entry node',
      (d) =>
        d.connections.push({
          id: 'c3',
          fromNodeId: 'shape',
          fromPort: 'error',
          toNodeId: 'start',
          toPort: 'input',
        }),
      /Entry nodes cannot be connection targets/,
    ],
    ['missing port', (d) => (d.connections[1].fromPort = 'maybe'), /has no port maybe/],
    ['dangling target', (d) => (d.connections[1].toNodeId = 'ghost'), /No node ghost/],
    ['no entry node', (d) => d.nodes.splice(0, 1), /exactly one manual_trigger/],
    [
      'undeclared template binding',
      (d) => (d.nodes[1].config.data = { $binding: 'other' }),
      /undeclared binding other/,
    ],
    [
      'reference to a missing node',
      (d) =>
        (d.nodes[1].bindings.name = {
          kind: 'node',
          nodeId: 'ghost',
          execution: 'latest',
          path: [],
        }),
      /No node ghost/,
    ],
    [
      'optional reference without fallback',
      (d) =>
        (d.nodes[1].bindings.name = {
          kind: 'node',
          nodeId: 'start',
          execution: 'latest',
          path: [],
          optional: true,
        }),
      /explicit fallback/,
    ],
    [
      'run variables',
      (d) => (d.nodes[1].bindings.name = { kind: 'variable', key: 'x', path: [] }),
      /Run variables arrive with M04a/,
    ],
    [
      'retry delays out of order',
      (d) => (d.nodes[1].retry = { maxAttempts: 3, initialDelayMs: 5000, maxDelayMs: 1000 }),
      /shorter than the initial delay/,
    ],
    ['overlap policy', (d) => (d.execution = { overlap: 'skip' }), /M12/],
    [
      'wait without a deadline',
      (d) => d.nodes.splice(1, 1, { id: 'pause', type: 'wait', config: {} }),
      /either durationMs or until/,
    ],
    [
      'wait until a local time',
      (d) =>
        d.nodes.splice(1, 1, { id: 'pause', type: 'wait', config: { until: '2026-11-01T09:00' } }),
      /UTC offset/,
    ],
    [
      'wait until an undeclared binding',
      (d) => d.nodes.splice(1, 1, { id: 'pause', type: 'wait', config: { until: '{{when}}' } }),
      /undeclared binding when/,
    ],
    [
      'invalid agent schema',
      (d) =>
        d.nodes.splice(1, 1, {
          id: 'shape',
          type: 'agent',
          config: { goal: 'x', resultSchema: { type: 'nonsense' } },
        }),
      /Not a valid JSON Schema/,
    ],
    [
      'config typo',
      (d) => (d.nodes[2].config = { outcom: 'FAILED' }),
      /must NOT have additional properties/,
    ],
  ];
  for (const [name, change, expected] of cases) {
    const found = problems(variant(change));
    assert.ok(
      found.some((message) => expected.test(message)),
      `${name}: ${JSON.stringify(found)}`,
    );
  }
  assert.match(problems({ ...base(), padding: 'x'.repeat(1024 * 1024) })[0]!, /exceeds 1 MiB/);
});

test('equal documents hash equally regardless of key order', () => {
  const reorder = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reorder)
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, child]) => [key, reorder(child)]),
          )
        : value;
  const document = normalizeDocument(base()) as WorkflowDocument;
  const reordered = reorder(document) as WorkflowDocument;
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(document));
  assert.equal(documentHash(reordered), documentHash(document));
  const changed = variant((d) => (d.nodes[2].config = { outcome: 'FAILED' }));
  assert.notEqual(
    documentHash(normalizeDocument(changed) as WorkflowDocument),
    documentHash(document),
  );
});

async function definitions(): Promise<{
  store: Store;
  repository: DefinitionRepository;
  receipts: CommandReceipts;
  root: string;
  close(): Promise<void>;
}> {
  const state = await temporaryState();
  const store = await openStore({ stateDirectory: state.path, clock: new FakeClock() });
  return {
    store,
    repository: new DefinitionRepository(store.db, new FakeClock()),
    receipts: new CommandReceipts(store.db, new FakeClock()),
    root: state.path,
    async close() {
      store.close();
      await state.remove();
    },
  };
}

test('drafts are compare-and-swap and published versions are immutable', async () => {
  const env = await definitions();
  try {
    const project = env.repository.addProject({
      name: 'p',
      repositoryPath: '/repo',
      baseRef: 'main',
    });
    const draft = normalizeDocument(base()) as Json;
    const workflow = env.repository.createWorkflow({ projectId: project.id, name: 'w', draft }) as {
      id: string;
      draftRevision: number;
    };
    assert.throws(() => env.repository.saveDraft(workflow.id, 5, draft), {
      code: 'REVISION_CONFLICT',
    });
    const saved = env.repository.saveDraft(workflow.id, 0, draft) as { draftRevision: number };
    assert.equal(saved.draftRevision, 1);
    assert.throws(() => env.repository.publish(workflow.id, 0), { code: 'REVISION_CONFLICT' });
    const first = env.repository.publish(workflow.id, 1) as {
      activeVersionId: string;
      versions: unknown[];
    };
    assert.equal(first.versions.length, 1);
    // Publishing an unchanged draft returns the active version instead of numbering a duplicate.
    assert.equal(
      (env.repository.publish(workflow.id) as { versions: unknown[] }).versions.length,
      1,
    );
    const changed = variant((d) => (d.nodes[2].config = { outcome: 'FAILED' }));
    env.repository.saveDraft(workflow.id, 1, normalizeDocument(changed) as Json);
    const second = env.repository.publish(workflow.id) as {
      activeVersionId: string;
      versions: Array<{ number: number }>;
    };
    assert.deepEqual(
      second.versions.map((version) => version.number),
      [1, 2],
    );
    assert.equal(env.repository.version(first.activeVersionId).number, 1, 'v1 is unchanged');
    assert.throws(
      () => env.store.db.prepare("UPDATE workflow_versions SET document_json = '{}'").run(),
      /immutable/,
    );
    assert.throws(() => env.store.db.prepare('DELETE FROM workflow_versions').run(), /immutable/);
  } finally {
    await env.close();
  }
});

test('an invalid draft can be saved but not published', async () => {
  const env = await definitions();
  try {
    const project = env.repository.addProject({
      name: 'p',
      repositoryPath: '/repo',
      baseRef: 'main',
    });
    const workflow = env.repository.createWorkflow({
      projectId: project.id,
      name: 'w',
      draft: normalizeDocument(variant((d) => (d.nodes[1].type = 'teleport'))) as Json,
    }) as { id: string };
    assert.throws(() => env.repository.publish(workflow.id), { code: 'INVALID_WORKFLOW' });
    assert.throws(() => env.repository.activeVersion(workflow.id), {
      code: 'WORKFLOW_UNPUBLISHED',
    });
  } finally {
    await env.close();
  }
});

test('a repeated command returns its stored response and a conflicting one is refused', async () => {
  const env = await definitions();
  try {
    let calls = 0;
    const command = () => ({ status: 201, body: { n: ++calls } });
    const actor = { kind: 'cli' as const, id: 'local' };
    const first = env.receipts.execute(actor, 'command-1', { op: 'x' }, command);
    assert.deepEqual(env.receipts.execute(actor, 'command-1', { op: 'x' }, command), first);
    assert.equal(calls, 1);
    assert.throws(() => env.receipts.execute(actor, 'command-1', { op: 'y' }, command), {
      code: 'COMMAND_CONFLICT',
    });
    // A failed command stores nothing, so the same ID can be retried.
    assert.throws(() =>
      env.receipts.execute(actor, 'command-2', { op: 'x' }, () => {
        env.store.db
          .prepare(
            "INSERT INTO events (type, schema_version, payload_json, created_at) VALUES ('t', 1, '{}', 0)",
          )
          .run();
        throw new Error('failed');
      }),
    );
    assert.equal(
      (
        env.store.db.prepare("SELECT COUNT(*) AS c FROM events WHERE type = 't'").get() as {
          c: number;
        }
      ).c,
      0,
      'the mutation rolled back with the command',
    );
    assert.deepEqual(env.receipts.execute(actor, 'command-2', { op: 'x' }, command), {
      status: 201,
      body: { n: 2 },
    });
  } finally {
    await env.close();
  }
});

test('projects are registered by their canonical repository top level', async () => {
  const env = await definitions();
  try {
    const service = new DefinitionService(env.repository, env.receipts);
    const repo = join(env.root, 'repo');
    await mkdir(join(repo, 'sub'), { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    await symlink(repo, join(env.root, 'alias'));
    await assert.rejects(service.addProject({ path: join(repo, 'sub') }), {
      code: 'NOT_A_REPOSITORY',
    });
    await assert.rejects(service.addProject({ path: env.root }), { code: 'NOT_A_REPOSITORY' });
    await assert.rejects(service.addProject({ path: repo, baseRef: 'nope' }), {
      code: 'INVALID_BASE_REF',
    });
    const added = await service.addProject({
      path: join(env.root, 'alias'),
      commandId: 'add-project-1',
    });
    const project = (added.body as { project: { repositoryPath: string; baseRef: string } })
      .project;
    assert.equal(project.repositoryPath, await realpath(repo));
    assert.equal(project.baseRef, 'main');
    assert.deepEqual(
      await service.addProject({ path: join(env.root, 'alias'), commandId: 'add-project-1' }),
      added,
    );
    await assert.rejects(service.addProject({ path: repo }), { code: 'PROJECT_EXISTS' });
  } finally {
    await env.close();
  }
});
