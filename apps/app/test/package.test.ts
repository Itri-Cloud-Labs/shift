import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packageProblems, readArchive } from '../tools/package-checks.mjs';

type Files = Map<string, Buffer | null>;
const check = packageProblems as (files: Files) => string[];

// The asar layout: a size prefix, a JSON index with offsets into the data that follows.
function archive(entries: Record<string, string>): Buffer {
  const files: Record<string, unknown> = {};
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(entries)) {
    const bytes = Buffer.from(text);
    let node = files;
    const parts = path.split('/');
    for (const part of parts.slice(0, -1))
      node = ((node[part] as { files: Record<string, unknown> } | undefined) ??= {
        files: {},
      }).files;
    node[parts.at(-1)!] = { size: bytes.length, offset: String(offset) };
    chunks.push(bytes);
    offset += bytes.length;
  }
  const json = Buffer.from(JSON.stringify({ files }));
  const padded = Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(16 + padded);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(8 + padded, 4);
  header.writeUInt32LE(4 + padded, 8);
  header.writeUInt32LE(json.length, 12);
  json.copy(header, 16);
  return Buffer.concat([header, ...chunks]);
}

const main = "contextIsolation: true, sandbox: true; setWindowOpenHandler; on('will-navigate')";
const clean = {
  'package.json': '{"name":"@shift/app","version":"0.0.0"}',
  'dist/main/index.js': main,
  'dist/renderer/index.html': '<!doctype html>',
  'dist/renderer/assets/index.js': 'placeholder: "-----BEGIN RSA PRIVATE KEY-----"',
};

test('a clean packaged app passes, and its files read back from the archive', () => {
  const files = readArchive(archive(clean)) as Files;
  assert.equal(files.get('dist/main/index.js')?.toString(), main);
  assert.deepEqual(check(files), []);
});

test('server code, native modules, secrets and dev servers in the package are refused', () => {
  const key = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}`;
  const problems = check(
    readArchive(
      archive({
        ...clean,
        'dist/main/index.js': `${main}; require("better-sqlite3")`,
        'dist/renderer/assets/key.js': key,
        'dist/renderer/assets/dev.js': 'http://localhost:5173/',
        'dist/renderer/assets/token.js': `ghp_${'x'.repeat(36)}`,
        'node_modules/x/binding.node': 'x',
        'dist/main/index.js.map': '{}',
        'src/main/index.ts': '',
      }),
    ) as Files,
  );
  for (const expected of [
    /index\.js contains a server storage module/,
    /key\.js contains a private key/,
    /dev\.js contains a development server address/,
    /token\.js contains a GitHub token/,
    /forbidden file node_modules\/x\/binding\.node/,
    /forbidden file dist\/main\/index\.js\.map/,
    /unexpected file src\/main\/index\.ts/,
  ])
    assert.ok(
      problems.some((problem) => expected.test(problem)),
      `${expected} in ${problems.join('; ')}`,
    );
});

test('a main process without its navigation lock is refused', () => {
  const problems = check(readArchive(archive({ ...clean, 'dist/main/index.js': 'app' })) as Files);
  assert.ok(problems.includes('the main process lacks will-navigate'));
  assert.ok(problems.includes('the main process lacks setWindowOpenHandler'));
});
