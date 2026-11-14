import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ShiftError } from '../src/domain/errors.js';
import { WorkspaceInspector, maxInline } from '../src/workspaces/inspect.js';
import { Workspaces } from '../src/workspaces/workspaces.js';
import { chain, run, settled, setup, view } from './action-helpers.js';

const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error) => error instanceof ShiftError && error.code === code);

test('inspection reads a run workspace and never leaves it', async () => {
  const env = await setup();
  try {
    const runId = await run(env, chain([['look', 'git_status', {}]]));
    await settled(env, runId);
    const workspace = (view(env, runId) as unknown as { workspace: { id: string; path: string } })
      .workspace;
    const root = workspace.path;
    await writeFile(join(root, 'notes.txt'), 'alpha beta gamma\n');
    await mkdir(join(root, 'src/deep'), { recursive: true });
    await writeFile(join(root, 'src/deep/main.ts'), 'export const answer = 42;\n');
    await writeFile(join(root, 'image.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    await writeFile(join(root, 'large.txt'), `${'é'.repeat(maxInline)}\n`);
    await symlink('/etc/passwd', join(root, 'escape'));
    await symlink('/etc', join(root, 'etc'));
    await symlink('src/deep/main.ts', join(root, 'inside'));
    execFileSync('mkfifo', [join(root, 'pipe')]);
    const inspector = new WorkspaceInspector(
      new Workspaces(env.store.db, env.clock, join(env.state, 'workspaces')),
    );

    const listing = await inspector.list(workspace.id);
    const names = listing.entries.map((entry) => `${entry.name}:${entry.kind}`);
    assert.ok(!names.some((name) => name.startsWith('.git:')), 'Git metadata is not listed');
    assert.ok(names.includes('src:directory'));
    assert.ok(names.includes('escape:symlink'));
    assert.ok(names.includes('notes.txt:file'));
    assert.deepEqual(
      (await inspector.list(workspace.id, 'src/deep')).entries.map((entry) => entry.name),
      ['main.ts'],
    );

    assert.equal((await inspector.file(workspace.id, 'notes.txt')).text, 'alpha beta gamma\n');
    assert.equal(
      (await inspector.file(workspace.id, 'inside')).text,
      'export const answer = 42;\n',
      'a link inside the workspace is followed',
    );
    const binary = await inspector.file(workspace.id, 'image.bin');
    assert.deepEqual([binary.binary, binary.text], [true, null]);
    const large = await inspector.file(workspace.id, 'large.txt');
    assert.equal(large.truncated, true);
    assert.equal(large.binary, false, 'a character cut by the limit is not binary');
    assert.ok(large.text!.length <= maxInline);

    // Ways out are refused, and nothing outside is read.
    await rejects(inspector.file(workspace.id, 'escape'), 'PATH_OUTSIDE_WORKSPACE');
    await rejects(inspector.list(workspace.id, 'etc'), 'PATH_OUTSIDE_WORKSPACE');
    await rejects(inspector.file(workspace.id, 'etc/passwd'), 'PATH_OUTSIDE_WORKSPACE');
    await rejects(inspector.file(workspace.id, '../../etc/passwd'), 'INVALID_PATH');
    await rejects(inspector.file(workspace.id, '/etc/passwd'), 'INVALID_PATH');
    await rejects(inspector.file(workspace.id, '.git/config'), 'INVALID_PATH');
    await rejects(inspector.file(workspace.id, 'src'), 'NOT_A_FILE');
    await rejects(inspector.file(workspace.id, 'pipe'), 'NOT_A_FILE');
    await rejects(inspector.file(workspace.id, 'nothing.txt'), 'NOT_FOUND');

    const download = await inspector.download(workspace.id, 'image.bin');
    const chunks: Buffer[] = [];
    for await (const chunk of download.stream) chunks.push(chunk as Buffer);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    await rejects(inspector.download(workspace.id, 'escape'), 'PATH_OUTSIDE_WORKSPACE');
    // An empty file downloads as nothing, and no download, read or abandoned, keeps its file open.
    await writeFile(join(root, 'empty.txt'), '');
    const empty = await inspector.download(workspace.id, 'empty.txt');
    const parts: Buffer[] = [];
    for await (const chunk of empty.stream) parts.push(chunk as Buffer);
    assert.equal(Buffer.concat(parts).length, 0);
    const openFiles = async () => (await readdir('/proc/self/fd')).length;
    const before = await openFiles();
    for (let index = 0; index < 20; index++) {
      const read = await inspector.download(workspace.id, 'notes.txt');
      for await (const chunk of read.stream) void chunk;
      const abandoned = await inspector.download(workspace.id, 'large.txt');
      abandoned.stream.destroy();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok((await openFiles()) <= before + 1, 'downloads keep no file open');

    // Git sees the live workspace.
    const status = (await inspector.status(workspace.id)) as {
      clean: boolean;
      entries: Array<{ path: string }>;
    };
    assert.equal(status.clean, false);
    assert.ok(status.entries.some((entry) => entry.path === 'notes.txt'));
    const diff = (await inspector.diff(workspace.id, 'base', 'notes.txt')) as { diff: string };
    assert.match(diff.diff, /\+alpha beta gamma/);

    // A removed workspace is not inspected.
    await new Workspaces(env.store.db, env.clock, join(env.state, 'workspaces')).remove(
      workspace.id,
      { force: true },
    );
    await rejects(inspector.list(workspace.id), 'WORKSPACE_UNAVAILABLE');
  } finally {
    await env.close();
  }
});
