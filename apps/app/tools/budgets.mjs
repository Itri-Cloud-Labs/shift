// Measures the editor on graphs of 50, 200 and 500 nodes against a real local server. Usage:
// pnpm --filter @shift/app build && xvfb-run -a node tools/budgets.mjs [output-dir]
// Prints one line per size: time to open, frames while dragging, and time for an edit to show.
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { stageElectron } from './stage.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const serverDirectory = fileURLToPath(new URL('../../server/', import.meta.url));
const output = resolve(process.argv[2] ?? 'budgets');
const sizes = [50, 200, 500];

const shift = (args) =>
  spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: serverDirectory,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
async function cli(args) {
  const child = shift(args);
  let text = '';
  child.stdout.on('data', (chunk) => (text += chunk));
  const code = await new Promise((done) => child.on('close', done));
  if (code !== 0) throw new Error(`shift ${args.join(' ')} failed`);
  return JSON.parse(text.trim().split('\n').at(-1));
}
async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

// A trigger, then a chain laid out in rows, as a large hand-built workflow would be.
function graph(size) {
  const nodes = [{ id: 'start', type: 'manual_trigger', position: { x: 0, y: 0 } }];
  for (let index = 1; index < size; index++)
    nodes.push({
      id: `n${index}`,
      type: index % 2 ? 'wait' : 'transform',
      config: index % 2 ? { durationMs: 1000 } : { data: { index } },
      position: { x: (index % 25) * 300, y: Math.floor(index / 25) * 160 + 40 },
    });
  const connections = nodes.slice(1).map((node, index) => ({
    id: `c${index + 1}`,
    fromNodeId: nodes[index].id,
    fromPort: 'success',
    toNodeId: node.id,
    toPort: 'input',
  }));
  return { nodes, connections };
}

// Runs in the page. The drag itself is real mouse input, sent between these two.
const startFrames = `window.__frames = { last: performance.now(), gaps: [], hidden: 0, on: true };
  (function tick(now) {
    const f = window.__frames;
    if (!f.on) return;
    f.gaps.push(now - f.last);
    f.last = now;
    if (document.querySelector('.react-flow__node[style*="visibility: hidden"]')) f.hidden++;
    requestAnimationFrame(tick);
  })(performance.now());`;
const readFrames = `(() => {
  const f = window.__frames;
  f.on = false;
  const gaps = f.gaps.slice(1).sort((a, b) => a - b);
  return { frames: gaps.length, p95: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0), max: Math.round(gaps.at(-1) ?? 0), hiddenFrames: f.hidden };
})()`;
const timed = (act, done) => `new Promise((resolve) => {
  const started = performance.now();
  ${act};
  (function check() {
    if (${done}) requestAnimationFrame(() => resolve(Math.round(performance.now() - started)));
    else setTimeout(check, 4);
  })();
})`;

const temporaryRoot = await mkdtemp(join(tmpdir(), 'shift-budgets-'));
const stateDir = join(temporaryRoot, 'server');
const repository = join(temporaryRoot, 'repo');
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
  const admin = ['--state-dir', stateDir];
  const project = await cli(['project', 'add', '--path', repository, '--name', 'repo', ...admin]);
  const { phrase } = await cli(['device', 'pair', ...admin]);
  const steps = [
    {
      name: 'pair',
      theme: 'dark',
      size: [1440, 900],
      pair: { url: `http://127.0.0.1:${port}`, phrase },
      wait: 800,
    },
  ];
  for (const size of sizes) {
    const file = join(temporaryRoot, `graph-${size}.json`);
    await writeFile(file, JSON.stringify(graph(size)));
    const workflow = await cli([
      'workflow',
      'create',
      '--project',
      project.id,
      '--name',
      `Graph ${size}`,
      '--file',
      file,
      ...admin,
    ]);
    const nodes = `document.querySelectorAll('.react-flow__node').length`;
    steps.push(
      {
        name: `${size}-open`,
        wait: 1500,
        report: `window.__open`,
        script: `window.__open = null; ${timed(
          `location.hash = '#/p/${project.id}/w/${workflow.id}'`,
          `${nodes} === ${size} && !document.querySelector('.react-flow__node[style*="visibility: hidden"]')`,
        )}.then((ms) => (window.__open = ms))`,
      },
      {
        name: `${size}-drag`,
        script: startFrames,
        drag: { node: 'start', by: [150, 120] },
        wait: 600,
        report: readFrames,
      },
      {
        name: `${size}-edit`,
        wait: 1000,
        script: `document.querySelector('[aria-label="Add a node"]').click(); window.__edit = null; setTimeout(() => { ${timed(
          `[...document.querySelectorAll('.node-picker button')].find((b) => b.textContent.startsWith('End')).click()`,
          `${nodes} === ${size + 1}`,
        )}.then((ms) => (window.__edit = ms)); }, 150);`,
        report: `window.__edit`,
      },
    );
  }
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
  app.stdout.on('data', (chunk) => {
    for (const line of String(chunk).split('\n'))
      if (line.startsWith('SHIFT_REPORT')) console.log(line.slice('SHIFT_REPORT '.length));
  });
  const timer = setTimeout(() => app.kill('SIGKILL'), 180_000);
  const code = await new Promise((done) => app.on('close', done));
  clearTimeout(timer);
  if (code !== 0) throw new Error(`Measuring failed: ${code}`);
} finally {
  server?.kill('SIGTERM');
  await delay(300);
  await rm(temporaryRoot, { recursive: true, force: true });
}
