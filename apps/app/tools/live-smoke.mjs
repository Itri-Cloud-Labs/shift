// The packaged desktop app against a real Shift server behind HTTPS, in two launches that share one
// profile (src/main/live-smoke.ts): pair and start a run, quit, then reopen, reconnect with the
// stored device key and find the run finished while the app was closed. The server, its HTTPS proxy
// and, for a persistent device key, a secret service are set up by the caller.
//
//   node tools/live-smoke.mjs --shift PATH --url https://HOST [--ca FILE] [--persistent]
//
// --shift is the server's CLI, run as the service's account; --ca a certificate authority to trust
// for this test only; --persistent expects the device key kept by the OS secret service.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { stageElectron } from './stage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    shift: { type: 'string' },
    url: { type: 'string' },
    ca: { type: 'string' },
    persistent: { type: 'boolean', default: false },
  },
});
if (!values.shift || !values.url) throw new Error('--shift and --url are required.');
if (process.platform !== 'linux') throw new Error('The live smoke runs the Linux package.');

const shift = (...args) => JSON.parse(execFileSync(values.shift, args, { encoding: 'utf8' }));
const work = await mkdtemp(join(tmpdir(), 'shift-live-'));
try {
  // A workflow whose only step waits for a barrier the test releases after the first launch has
  // exited, so the run can only finish while the app is closed.
  const barrier = join(work, 'release-the-run');
  const repository = join(work, 'repo');
  await mkdir(repository);
  const git = (...args) => execFileSync('git', args, { cwd: repository, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init',
  );
  const project = shift('project', 'add', '--path', repository, '--name', 'packaged-smoke');
  const document = join(work, 'workflow.json');
  await writeFile(
    document,
    JSON.stringify({
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        {
          id: 'wait',
          type: 'command',
          config: { mode: 'shell', script: `while [ ! -e '${barrier}' ]; do sleep 0.2; done` },
        },
        { id: 'end', type: 'end' },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'wait', toPort: 'input' },
        { id: 'c2', fromNodeId: 'wait', fromPort: 'success', toNodeId: 'end', toPort: 'input' },
      ],
    }),
  );
  const workflow = shift(
    'workflow',
    'create',
    '--project',
    project.id,
    '--name',
    'packaged-smoke',
    '--file',
    document,
  );
  shift('workflow', 'publish', workflow.id);
  const { phrase } = shift('device', 'pair');

  const state = join(work, 'profile');
  await mkdir(state);
  const launch = async (plan) => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shift-live-run-'));
    try {
      let env = {
        ...process.env,
        SHIFT_SMOKE_STATE: state,
        SHIFT_SMOKE_LIVE: JSON.stringify({
          ...plan,
          url: values.url,
          persistent: values.persistent,
        }),
        ...(values.ca ? { NODE_EXTRA_CA_CERTS: values.ca } : {}),
      };
      delete env.ELECTRON_RUN_AS_NODE;
      // Chromium picks a secret service only in a known desktop session; name it explicitly.
      let args = [
        '--shift-smoke',
        ...(values.persistent ? ['--password-store=gnome-libsecret'] : []),
      ];
      let executable = join(root, 'release/linux-unpacked/shift-desktop');
      ({ executable, args, env } = await stageElectron({
        root,
        temporaryRoot,
        state,
        executable,
        args,
        env,
        packaged: true,
      }));
      const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'inherit'] });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
      const code = await new Promise((resolve) => child.on('close', resolve));
      clearTimeout(timer);
      const line = output.split('\n').find((text) => text.startsWith('SHIFT_LIVE '));
      if (code !== 0 || !line || !output.includes('SHIFT_SMOKE_OK'))
        throw new Error(`The ${plan.phase} launch failed (${code}).`);
      return JSON.parse(line.slice('SHIFT_LIVE '.length));
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  };

  // `launch` returns once the app's process has exited.
  const first = await launch({ phase: 'pair', phrase, workflowId: workflow.id });
  const blocked = shift('run', 'show', first.runId);
  if (blocked.state !== 'RUNNING')
    throw new Error(`With the app closed the run should still wait, but it is ${blocked.state}.`);
  await writeFile(barrier, '');
  const finished = shift('run', 'show', first.runId, '--wait');
  if (finished.state !== 'COMPLETED') throw new Error(`The run ended ${finished.state}.`);
  const second = await launch({ phase: 'resume', runId: first.runId });
  console.log(
    JSON.stringify({
      result: 'pass',
      credentialStorage: first.credentialStorage,
      run: second.runState,
    }),
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
