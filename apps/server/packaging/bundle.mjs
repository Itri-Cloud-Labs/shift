// Builds the self-contained Linux server bundle for one architecture: the compiled server with its
// production dependencies, the pinned Node runtime it was tested with, a wrapper and the installer.
// Usage: node packaging/bundle.mjs [--arch x64|arm64] [--version VERSION] [--out DIR]
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = fileURLToPath(new URL('.', import.meta.url));
const server = join(here, '..');
const repository = join(server, '..', '..');
const { values } = parseArgs({
  options: {
    arch: { type: 'string', default: process.arch },
    version: { type: 'string' },
    out: { type: 'string', default: join(server, 'build', 'packages') },
  },
});
const arch = values.arch;
if (!['x64', 'arm64'].includes(arch)) throw new Error('--arch must be x64 or arm64.');
const runtime = JSON.parse(await readFile(join(here, 'node-runtime.json'), 'utf8'));
const { serverVersion } = await import(join(server, 'dist', 'protocol', 'index.js'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

const commit = run('git', ['rev-parse', 'HEAD'], { cwd: repository });
const epoch = Number(run('git', ['log', '-1', '--format=%ct'], { cwd: repository }));
// A build that is not an explicit release says which commit it came from.
const version = values.version ?? `${serverVersion}-dev.${commit.slice(0, 7)}`;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error('--version must look like 1.2.3 or 1.2.3-alpha.1.');
const name = `shift-${version}-linux-${arch}`;
const out = values.out;
const stage = join(out, name);
await mkdir(out, { recursive: true });
await rm(stage, { recursive: true, force: true });

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

// Production dependencies only, then everything the server never loads at runtime: sources,
// tests, the SQLite amalgamation and native builds for other platforms.
run('pnpm', ['--filter', '@shift/server', 'deploy', '--prod', join(stage, 'app')], {
  cwd: repository,
});
const app = join(stage, 'app');
for (const entry of await readdir(app))
  if (!['dist', 'node_modules', 'package.json'].includes(entry))
    await rm(join(app, entry), { recursive: true, force: true });
async function prune(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    if (entry.name === 'prebuilds') {
      for (const build of await readdir(path))
        if (!build.startsWith(`linux-${arch}`))
          await rm(join(path, build), { recursive: true, force: true });
      continue;
    }
    await prune(path);
  }
}
await prune(join(app, 'node_modules'));
const sqlite = join(app, 'node_modules', '.pnpm');
for (const entry of await readdir(sqlite))
  if (entry.startsWith('better-sqlite3@'))
    for (const unused of ['deps', 'src'])
      await rm(join(sqlite, entry, 'node_modules', 'better-sqlite3', unused), {
        recursive: true,
        force: true,
      });

// The pinned Node runtime, checked against the hash recorded in this repository.
const nodeName = `node-v${runtime.version}-linux-${arch}`;
const cache = join(out, '.cache');
await mkdir(cache, { recursive: true });
const nodeArchive = join(cache, `${nodeName}.tar.gz`);
if (!(await stat(nodeArchive).catch(() => null))) {
  const response = await fetch(`${runtime.baseUrl}/v${runtime.version}/${nodeName}.tar.gz`);
  if (!response.ok || !response.body) throw new Error(`Cannot download ${nodeName}.`);
  await pipeline(response.body, createWriteStream(`${nodeArchive}.part`));
  await rename(`${nodeArchive}.part`, nodeArchive);
}
if ((await sha256(nodeArchive)) !== runtime.sha256[arch]) {
  await rm(nodeArchive);
  throw new Error(`${nodeName}.tar.gz does not match its recorded SHA-256.`);
}
await mkdir(join(stage, 'node'), { recursive: true });
run('tar', [
  '-xzf',
  nodeArchive,
  '-C',
  join(stage, 'node'),
  '--strip-components=1',
  `${nodeName}/bin/node`,
  `${nodeName}/LICENSE`,
]);

await mkdir(join(stage, 'bin'));
await copyFile(join(here, 'shift'), join(stage, 'bin', 'shift'));
await chmod(join(stage, 'bin', 'shift'), 0o755);
await copyFile(join(here, 'install.sh'), join(stage, 'install.sh'));
await chmod(join(stage, 'install.sh'), 0o755);
await copyFile(join(repository, 'LICENSE'), join(stage, 'LICENSE'));
const manifest = {
  name: 'shift-server',
  version,
  commit,
  platform: 'linux',
  arch,
  libc: 'glibc',
  // Ubuntu 22.04's glibc, which CI builds and tests on.
  minimumGlibc: '2.35',
  node: runtime.version,
};
await writeFile(join(stage, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// The bundle must run on its own runtime and native bindings before it is archived.
if (arch === process.arch) {
  const report = JSON.parse(
    run(join(stage, 'bin', 'shift'), ['version', '--json'], {
      env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '/' },
    }),
  );
  if (report.node !== `v${runtime.version}` || report.version !== version || !report.sqlite)
    throw new Error(`The bundle reported an unexpected runtime: ${JSON.stringify(report)}`);
}

const archive = join(out, `${name}.tar.gz`);
const tar = spawnSync(
  'sh',
  [
    '-c',
    'tar --sort=name --mtime="@$1" --owner=0 --group=0 --numeric-owner -cf - -C "$2" "$3" | gzip -n -9 > "$4"',
    'bundle',
    String(epoch),
    out,
    name,
    archive,
  ],
  { stdio: 'inherit' },
);
if (tar.status !== 0) throw new Error('Cannot create the archive.');
await rm(stage, { recursive: true, force: true });
await copyFile(join(here, 'install.sh'), join(out, 'install.sh'));
await chmod(join(out, 'install.sh'), 0o755);
const sums = [];
for (const entry of (await readdir(out)).sort())
  if (/^shift-.*\.tar\.gz$/.test(entry) || entry === 'install.sh')
    sums.push(`${await sha256(join(out, entry))}  ${entry}`);
await writeFile(join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(JSON.stringify({ archive, version, arch, commit }));
