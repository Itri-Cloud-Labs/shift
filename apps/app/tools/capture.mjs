// Development screenshots of the built app against a real local server, for design review.
// Usage: pnpm --filter @shift/app build && xvfb-run -a node tools/capture.mjs <output-dir>
// Starts `shift serve` from source on a free loopback port with throwaway state, creates a demo
// project, workflow and waiting run with the CLI, then drives the app through its main views.
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { stageElectron } from './stage.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const serverDirectory = fileURLToPath(new URL('../../server/', import.meta.url));
const output = resolve(process.argv[2] ?? 'capture');

function shift(args) {
  return spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: serverDirectory,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
async function cli(args) {
  const child = shift(args);
  let text = '';
  let errors = '';
  child.stdout.on('data', (chunk) => (text += chunk));
  child.stderr.on('data', (chunk) => (errors += chunk));
  const code = await new Promise((done) => child.on('close', done));
  if (code !== 0) throw new Error(`shift ${args.join(' ')}: ${errors}`);
  return JSON.parse(text.trim().split('\n').at(-1));
}
async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'shift-capture-'));
const stateDir = join(temporaryRoot, 'server');
const repository = join(temporaryRoot, 'payments-service');
let server;
try {
  await mkdir(repository);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repository });
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'],
    { cwd: repository },
  );
  const port = await freePort();
  server = shift(['serve', '--state-dir', stateDir, '--port', String(port)]);
  let log = '';
  server.stdout.on('data', (chunk) => (log += chunk));
  for (let index = 0; index < 200 && !log.includes('"server.ready"'); index++) await delay(50);
  if (!log.includes('"server.ready"')) throw new Error('Server did not start');
  const url = `http://127.0.0.1:${port}`;
  const admin = ['--state-dir', stateDir];

  const project = await cli([
    'project',
    'add',
    '--path',
    repository,
    '--name',
    'payments-service',
    ...admin,
  ]);
  const draft = {
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      {
        id: 'prepare',
        type: 'transform',
        config: { data: { files: 42, area: 'billing' } },
      },
      {
        id: 'is_large',
        type: 'condition',
        config: { when: { op: 'gt', left: { binding: 'files' }, right: { value: 20 } } },
        bindings: { files: { kind: 'input', path: ['data', 'files'] } },
      },
      {
        id: 'review',
        type: 'approval',
        config: {
          title: 'Ship the billing refactor?',
          instructions: 'Large change: 42 files under billing/.',
        },
      },
      {
        id: 'summarize',
        type: 'agent',
        config: { goal: 'Summarize the change for the release notes and list risky files.' },
      },
      { id: 'cool_down', type: 'wait', config: { durationMs: 3_600_000 } },
      { id: 'done', type: 'end' },
      { id: 'stopped', type: 'end', config: { outcome: 'FAILED', reason: 'Rejected in review' } },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'prepare', toPort: 'input' },
      {
        id: 'c2',
        fromNodeId: 'prepare',
        fromPort: 'success',
        toNodeId: 'is_large',
        toPort: 'input',
      },
      { id: 'c3', fromNodeId: 'is_large', fromPort: 'true', toNodeId: 'review', toPort: 'input' },
      {
        id: 'c4',
        fromNodeId: 'is_large',
        fromPort: 'false',
        toNodeId: 'summarize',
        toPort: 'input',
      },
      {
        id: 'c5',
        fromNodeId: 'review',
        fromPort: 'approved',
        toNodeId: 'cool_down',
        toPort: 'input',
      },
      {
        id: 'c6',
        fromNodeId: 'review',
        fromPort: 'rejected',
        toNodeId: 'stopped',
        toPort: 'input',
      },
      { id: 'c7', fromNodeId: 'summarize', fromPort: 'success', toNodeId: 'done', toPort: 'input' },
      { id: 'c8', fromNodeId: 'cool_down', fromPort: 'success', toNodeId: 'done', toPort: 'input' },
    ],
  };
  const { writeFile } = await import('node:fs/promises');
  const draftFile = join(temporaryRoot, 'draft.json');
  await writeFile(draftFile, JSON.stringify(draft));
  const workflow = await cli([
    'workflow',
    'create',
    '--project',
    project.id,
    '--name',
    'Release review',
    '--file',
    draftFile,
    ...admin,
  ]);
  await cli(['workflow', 'publish', workflow.id, ...admin]);
  await cli([
    'workflow',
    'create',
    '--project',
    project.id,
    '--name',
    'Nightly dependency bump',
    '--file',
    draftFile,
    ...admin,
  ]);
  const run = await cli(['run', 'start', '--workflow', workflow.id, ...admin]);
  // A loop that reaches its node's execution limit, so the run stops for the owner's decision.
  const loopFile = join(temporaryRoot, 'loop.json');
  await writeFile(
    loopFile,
    JSON.stringify({
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        {
          id: 'poll_status',
          type: 'transform',
          config: { data: { checked: true } },
          limits: { maxExecutionsPerRun: 3 },
        },
        {
          id: 'still_pending',
          type: 'condition',
          config: { when: { op: 'eq', left: { value: 1 }, right: { value: 1 } } },
        },
        { id: 'done', type: 'end' },
      ],
      connections: [
        {
          id: 'l1',
          fromNodeId: 'start',
          fromPort: 'success',
          toNodeId: 'poll_status',
          toPort: 'input',
        },
        {
          id: 'l2',
          fromNodeId: 'poll_status',
          fromPort: 'success',
          toNodeId: 'still_pending',
          toPort: 'input',
        },
        {
          id: 'l3',
          fromNodeId: 'still_pending',
          fromPort: 'true',
          toNodeId: 'poll_status',
          toPort: 'input',
        },
        {
          id: 'l4',
          fromNodeId: 'still_pending',
          fromPort: 'false',
          toNodeId: 'done',
          toPort: 'input',
        },
      ],
    }),
  );
  const loop = await cli([
    'workflow',
    'create',
    '--project',
    project.id,
    '--name',
    'Wait for deploy',
    '--file',
    loopFile,
    ...admin,
  ]);
  await cli(['workflow', 'publish', loop.id, ...admin]);
  const stuck = await cli(['run', 'start', '--workflow', loop.id, ...admin]);
  const { phrase } = await cli(['device', 'pair', ...admin]);

  const base = `#/p/${project.id}/w/${workflow.id}`;
  const steps = [
    { name: '01-pairing-dark', theme: 'dark', size: [1440, 900] },
    { name: '02-pairing-light', theme: 'light' },
    { name: '03-draft-dark', theme: 'dark', pair: { url, phrase }, hash: base, wait: 2000 },
    { name: '04-draft-inspector', hash: `${base}/n/review` },
    { name: '05-run-dark', hash: `${base}/r/${run.id}`, wait: 2000 },
    { name: '06-run-inspector', hash: `${base}/r/${run.id}/n/prepare` },
    { name: '07-run-light', theme: 'light' },
    {
      name: '08-switcher',
      theme: 'dark',
      hash: `${base}/r/${run.id}`,
      script: "document.querySelector('.location .crumb').click()",
      wait: 800,
    },
    {
      name: '09-runs-menu',
      script:
        "document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})); window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})); setTimeout(() => document.querySelector('[data-crumb=run]').click(), 100)",
      wait: 800,
    },
    {
      name: '10-list-view',
      script:
        "window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})); setTimeout(() => document.querySelector('[aria-label=\"Nodes and connections as a list\"]').click(), 100)",
      wait: 800,
    },
    { name: '11-narrow', size: [900, 640], hash: `${base}/r/${run.id}/n/review`, wait: 1500 },
    // Editing: drag a node, save, and see it again after leaving; then add, connect and publish.
    { name: '12-draft-before-move', size: [1440, 900], hash: base, wait: 1500 },
    { name: '13-draft-moved', drag: { node: 'summarize', by: [0, -160] }, wait: 1000 },
    {
      name: '14-draft-saved',
      script:
        "[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'Save').click()",
      wait: 1500,
    },
    { name: '15-draft-after-reload', hash: `${base}/r/${run.id}`, wait: 800 },
    { name: '15b-draft-back', hash: base, wait: 1500 },
    {
      name: '15c-node-picker',
      script: 'document.querySelector(\'[aria-label="Add a node"]\').click()',
      wait: 500,
    },
    {
      name: '15d-added-agent',
      script:
        "[...document.querySelectorAll('.node-picker button')].find((b) => b.textContent.startsWith('Agent')).click()",
      wait: 1000,
    },
    {
      name: '15e-problems',
      script:
        "[...document.querySelectorAll('.toolbar button')].find((b) => /problem/.test(b.textContent)).click()",
      wait: 500,
    },
    {
      name: '15f-undone',
      script: "document.querySelector('[aria-label=Undo]').click()",
      wait: 800,
    },
    {
      name: '15g-published',
      script:
        "document.querySelector('[aria-label=\"Close problems\"]').click(); setTimeout(() => [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'Save').click(), 200); setTimeout(() => [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'Publish').click(), 1200)",
      wait: 2500,
    },
    // Another device saves while edits are open: nothing is overwritten until a choice is made.
    {
      name: '15h-edited-here',
      script:
        "document.querySelector('[aria-label=\"Add a node\"]').click(); setTimeout(() => [...document.querySelectorAll('.node-picker button')].find((b) => b.textContent.startsWith('End')).click(), 200)",
      wait: 800,
    },
    // tools/capture.mjs saves the draft from the CLI once 15h is captured.
    { name: '15i-conflict', wait: 3000 },
    {
      name: '15j-kept-theirs',
      script:
        "[...document.querySelectorAll('.conflict button')].find((b) => b.textContent.startsWith('Discard')).click()",
      wait: 800,
    },
    // What needs the owner: a request in the inspector, the inbox, a toast and a stuck run.
    { name: '16-request-form', hash: `${base}/r/${run.id}/n/review`, wait: 1500 },
    { name: '17-inbox', script: "document.querySelector('.attention-count').click()", wait: 800 },
    // tools/capture.mjs starts another run once 17 is captured; its request arrives as a toast.
    {
      name: '18-toast',
      script: "window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))",
      hash: base,
      wait: 7000,
    },
    {
      name: '19-decide',
      hash: `#/p/${project.id}/w/${loop.id}/r/${stuck.id}`,
      script:
        "setTimeout(() => [...document.querySelectorAll('.run-status button')].find((b) => b.textContent.includes('Decide')).click(), 1200)",
      wait: 2200,
    },
    { name: '20-decide-light', theme: 'light', wait: 800 },
    {
      name: '21-approved',
      theme: 'dark',
      hash: `${base}/r/${run.id}/n/review`,
      script:
        "setTimeout(() => [...document.querySelectorAll('.request-actions button')].find((b) => b.textContent === 'Approve').click(), 1200)",
      wait: 3500,
    },
    // ⌘K and Settings. The last step revokes this device through the app.
    {
      name: '22-palette',
      hash: base,
      script: "window.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', ctrlKey: true}))",
      wait: 1500,
    },
    {
      name: '23-palette-search',
      script:
        "(() => { const input = document.querySelector('.palette input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'review'); input.dispatchEvent(new Event('input', {bubbles: true})); })()",
      wait: 500,
    },
    {
      name: '24-settings-connection',
      script:
        "window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})); document.querySelector('.scrim')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true})); setTimeout(() => document.querySelector('[aria-label=Settings]').click(), 200)",
      wait: 1500,
    },
    {
      name: '25-settings-devices',
      script: "document.querySelector('#settings-tab-devices').click()",
      wait: 1200,
    },
    {
      name: '26-revoke-confirm',
      script:
        "[...document.querySelectorAll('.settings-device button')].find((b) => b.textContent.includes('Revoke')).click()",
      wait: 500,
    },
    {
      name: '27-appearance-light',
      script:
        "document.querySelector('#settings-tab-appearance').click(); setTimeout(() => [...document.querySelectorAll('[role=radio]')].find((b) => b.textContent === 'Light').click(), 200)",
      wait: 1200,
    },
    {
      name: '28-revoked-returns-to-pairing',
      script:
        "document.querySelector('#settings-tab-devices').click(); setTimeout(() => [...document.querySelectorAll('.settings-device button')].find((b) => b.textContent.includes('Revoke')).click(), 900); setTimeout(() => [...document.querySelectorAll('.settings-confirm button')].find((b) => b.textContent === 'Revoke device').click(), 1300)",
      wait: 4000,
    },
  ];

  // Stands in for another device. The node's move is theirs; the added node stays local.
  let saved = false;
  const saveElsewhere = async () => {
    const current = await cli(['workflow', 'show', workflow.id, ...admin]);
    const file = join(temporaryRoot, 'elsewhere.json');
    current.draft.nodes[0].position.y += 40;
    await writeFile(file, JSON.stringify(current.draft));
    await cli([
      'workflow',
      'save',
      workflow.id,
      '--revision',
      String(current.draftRevision),
      '--file',
      file,
      ...admin,
    ]);
  };

  // Launch the built app in capture mode, staged like the smoke test.
  const state = join(temporaryRoot, 'state');
  await mkdir(state);
  await mkdir(output, { recursive: true });
  await chmod(output, 0o777);
  let executable = require('electron');
  let args = [root, '--shift-capture'];
  let env = {
    ...process.env,
    SHIFT_SMOKE_STATE: state,
    SHIFT_CAPTURE_DIR: output,
    SHIFT_CAPTURE_STEPS: JSON.stringify(steps),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  ({ executable, args, env } = await stageElectron({
    root,
    temporaryRoot,
    state,
    executable,
    args,
    env,
    packaged: false,
  }));
  const app = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'inherit'] });
  let started = false;
  app.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    if (!saved && String(chunk).includes('SHIFT_CAPTURE 15h-edited-here')) {
      saved = true;
      void saveElsewhere();
    }
    if (!started && String(chunk).includes('SHIFT_CAPTURE 17-inbox')) {
      started = true;
      void cli(['run', 'start', '--workflow', workflow.id, ...admin]);
    }
  });
  const timer = setTimeout(() => app.kill('SIGKILL'), 120_000);
  const code = await new Promise((done) => app.on('close', done));
  clearTimeout(timer);
  if (code !== 0) throw new Error(`Capture failed: ${code}`);
  console.log(`Screenshots in ${output}`);
} finally {
  server?.kill('SIGTERM');
  await delay(300);
  await rm(temporaryRoot, { recursive: true, force: true });
}
