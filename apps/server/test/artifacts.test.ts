import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { BlobStore } from '../src/artifacts/store.js';
import { temporaryState } from './helpers.js';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

async function blobsIn(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const prefix of await readdir(join(root, 'sha256')).catch(() => []))
    for (const name of await readdir(join(root, 'sha256', prefix))) found.push(name);
  return found;
}

test('a report is stored by its hash, once per content, and read back as written', async () => {
  const state = await temporaryState();
  try {
    const container = join(state.path, 'artifacts');
    const directory = join(container, 'run', 'invocation');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'toahumanreader.md'), '# Done\n');
    const store = new BlobStore(join(state.path, 'blobs'));
    const stored = await store.ingest(container, directory, 'toahumanreader.md', 1024);
    assert.deepEqual(stored, {
      kind: 'stored',
      sha256: sha('# Done\n'),
      sizeBytes: 7,
      storageKey: `sha256/${sha('# Done\n').slice(0, 2)}/${sha('# Done\n')}`,
    });
    // The same bytes again share the blob; the source can change afterwards without effect.
    assert.deepEqual(await store.ingest(container, directory, 'toahumanreader.md', 1024), stored);
    await writeFile(join(directory, 'toahumanreader.md'), 'changed');
    if (stored.kind !== 'stored') throw new Error('not stored');
    const chunks: Buffer[] = [];
    for await (const chunk of (await store.read(stored.storageKey))!) chunks.push(chunk as Buffer);
    assert.equal(Buffer.concat(chunks).toString(), '# Done\n');
    assert.equal(await store.present(stored.storageKey, 7), true);
    assert.equal(await store.present(stored.storageKey, 8), false);
    assert.deepEqual(await blobsIn(join(state.path, 'blobs')), [sha('# Done\n')]);
    assert.deepEqual(await readdir(join(state.path, 'blobs', 'tmp')), []);
    await assert.rejects(store.read('sha256/../../etc/passwd'), /Invalid storage key/);
  } finally {
    await state.remove();
  }
});

test('missing, oversized, linked and escaped reports are not stored', async () => {
  const state = await temporaryState();
  try {
    const container = join(state.path, 'artifacts');
    const directory = join(container, 'run', 'invocation');
    await mkdir(directory, { recursive: true });
    const store = new BlobStore(join(state.path, 'blobs'));
    assert.deepEqual(await store.ingest(container, directory, 'tothenextagent.md', 10), {
      kind: 'missing',
    });
    await writeFile(join(directory, 'big.md'), 'x'.repeat(11));
    assert.equal((await store.ingest(container, directory, 'big.md', 10)).kind, 'refused');
    await writeFile(join(state.path, 'secret'), 'private');
    await symlink(join(state.path, 'secret'), join(directory, 'link.md'));
    assert.deepEqual(await store.ingest(container, directory, 'link.md', 100), {
      kind: 'refused',
      reason: 'link.md is a symbolic link.',
    });
    await mkdir(join(directory, 'folder.md'));
    assert.equal((await store.ingest(container, directory, 'folder.md', 100)).kind, 'refused');
    assert.equal((await store.ingest(container, directory, '../secret', 100)).kind, 'refused');
    // A directory swapped for a link to somewhere else.
    await symlink(state.path, join(container, 'run', 'swapped'));
    assert.equal(
      (await store.ingest(container, join(container, 'run', 'swapped'), 'secret', 100)).kind,
      'refused',
    );
    assert.equal((await store.ingest(container, state.path, 'secret', 100)).kind, 'refused');
    assert.deepEqual(await blobsIn(join(state.path, 'blobs')), []);
  } finally {
    await state.remove();
  }
});

test('killing an import at any moment leaves whole blobs named by their hash, or none', async () => {
  const state = await temporaryState();
  try {
    const container = join(state.path, 'artifacts');
    const directory = join(container, 'run', 'invocation');
    await mkdir(directory, { recursive: true });
    const bytes = randomBytes(4 * 1024 * 1024);
    await writeFile(join(directory, 'toahumanreader.md'), bytes);
    const root = join(state.path, 'blobs');
    for (let round = 0; round < 12; round++) {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          join('test', 'fixtures', 'ingest-forever.ts'),
          root,
          container,
          directory,
          'toahumanreader.md',
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      await new Promise<void>((ready) => child.stdout.once('data', () => ready()));
      await delay(Math.floor(Math.random() * 60));
      child.kill('SIGKILL');
      await new Promise((done) => child.once('exit', done));
      for (const name of await blobsIn(root)) {
        const content = await readFile(join(root, 'sha256', name.slice(0, 2), name));
        assert.equal(sha(content), name, `round ${round}`);
      }
    }
    // Interrupted temporaries are only ever partial copies, never published names.
    const leftovers = await readdir(join(root, 'tmp')).catch(() => []);
    assert.ok(leftovers.every((name) => /^[0-9a-f-]{36}$/.test(name)));
  } finally {
    await state.remove();
  }
});

test('a named pipe in place of a report is refused without waiting for a writer', async () => {
  const state = await temporaryState();
  try {
    const container = join(state.path, 'artifacts');
    const directory = join(container, 'run', 'invocation');
    await mkdir(directory, { recursive: true });
    execFileSync('mkfifo', [join(directory, 'toahumanreader.md')]);
    const store = new BlobStore(join(state.path, 'blobs'));
    const result = await Promise.race([
      store.ingest(container, directory, 'toahumanreader.md', 1024),
      delay(2_000).then(() => 'blocked' as const),
    ]);
    assert.deepEqual(result, {
      kind: 'refused',
      reason: 'toahumanreader.md is not a regular file.',
    });
  } finally {
    await state.remove();
  }
});

test('a short write is finished before the blob is named by its hash', async () => {
  const state = await temporaryState();
  try {
    const container = join(state.path, 'artifacts');
    const directory = join(container, 'run', 'invocation');
    await mkdir(directory, { recursive: true });
    const bytes = randomBytes(200 * 1024);
    await writeFile(join(directory, 'toahumanreader.md'), bytes);
    let calls = 0;
    // Takes at most 1000 bytes per call, as a short write would.
    const store = new BlobStore(join(state.path, 'blobs'), {
      write: async (handle, chunk) => {
        calls++;
        return (await handle.write(chunk.subarray(0, 1000))).bytesWritten;
      },
    });
    const stored = await store.ingest(container, directory, 'toahumanreader.md', bytes.length);
    if (stored.kind !== 'stored') throw new Error(stored.kind);
    assert.ok(calls > 200);
    assert.equal(stored.sha256, sha(bytes));
    const blob = await readFile(join(state.path, 'blobs', stored.storageKey));
    assert.ok(blob.equals(bytes));
  } finally {
    await state.remove();
  }
});

test('swapping the report directory for a link while importing never imports the target', async () => {
  const state = await temporaryState();
  try {
    const container = join(state.path, 'artifacts');
    const directory = join(container, 'run', 'invocation');
    const outside = join(state.path, 'outside');
    await mkdir(directory, { recursive: true });
    await mkdir(outside);
    await writeFile(join(directory, 'toahumanreader.md'), 'inside');
    await writeFile(join(outside, 'toahumanreader.md'), 'outside');
    const store = new BlobStore(join(state.path, 'blobs'));
    const aside = join(container, 'run', 'aside');
    let swapping = true;
    // Moves the real directory away and puts a link to `outside` in its place, back and forth.
    const swapper = (async () => {
      while (swapping) {
        await rename(directory, aside);
        await symlink(outside, directory);
        await delay(0);
        await rm(directory);
        await rename(aside, directory);
        await delay(0);
      }
    })();
    const results = [];
    for (let round = 0; round < 300; round++)
      results.push(await store.ingest(container, directory, 'toahumanreader.md', 100));
    swapping = false;
    await swapper;
    assert.ok(results.some((result) => result.kind === 'stored'));
    for (const result of results)
      if (result.kind === 'stored') assert.equal(result.sha256, sha('inside'));
    assert.deepEqual(await blobsIn(join(state.path, 'blobs')), [sha('inside')]);
  } finally {
    await state.remove();
  }
});
