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

  // Added through the app in step j01.
  const secondRepository = join(temporaryRoot, 'second-repo');
  await mkdir(secondRepository);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: secondRepository });
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'],
    { cwd: secondRepository },
  );

  const base = `#/p/${project.id}/w/${workflow.id}`;
  // Page helpers for the journey: set a field as typing would, and click by text.
  const JOURNEY_HELPERS = `window.J = {
        set(selector, value) {
          const element = document.querySelector(selector);
          if (!element) throw new Error('No ' + selector);
          const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
          element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
          element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        },
        click(selector, text) {
          const element = [...document.querySelectorAll(selector)].find((item) => text === undefined || item.textContent.trim().startsWith(text));
          if (!element) throw new Error('No ' + selector + ' ' + text);
          element.click();
        },
      };`;
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
    // The location menus with a real mouse, with the node list open beneath them.
    {
      name: 'm0-list-open',
      hash: base,
      wait: 800,
      expect: 'document.querySelector(\'[aria-label="Close list"]\')',
    },
    {
      name: 'm1-runs-menu',
      click: '[data-crumb=run]',
      wait: 400,
      expect: "document.querySelector('.runs-menu')",
    },
    {
      name: 'm2-open-version',
      click: '.runs-menu .option:nth-of-type(2)',
      wait: 800,
      expect: "location.hash.includes('/v/') && !document.querySelector('.runs-menu')",
    },
    {
      name: 'm3-runs-menu',
      click: '[data-crumb=run]',
      wait: 400,
      expect: "document.querySelector('.runs-menu')",
    },
    {
      name: 'm4-back-to-draft',
      click: '.runs-menu .option',
      wait: 800,
      expect: "!location.hash.includes('/v/') && !document.querySelector('.runs-menu')",
    },
    {
      name: 'm5-switcher',
      click: '.location .crumb',
      wait: 400,
      expect: "document.querySelector('.switcher')",
    },
    {
      name: 'm6-switch-workflow',
      click: '.switcher-column[aria-label=Workflows] .option:not(.active)',
      wait: 800,
      expect: "!document.querySelector('.switcher') && !location.hash.includes('${workflow.id}')",
    },
    // The whole journey through the UI, with no JSON: add a project and a workflow, build a branch,
    // connect it by mouse and by keyboard, publish, run, browse versions. `J` is defined in j00.
    {
      name: 'j00-add-project-refused',
      script: `${JOURNEY_HELPERS}
      J.click('.location .crumb');
      setTimeout(() => J.click('.switcher-create', 'Add a project'), 200);
      setTimeout(() => { J.set('#create-value', '/does/not/exist'); J.click('.create-dialog button[type=submit]'); }, 500);`,
      wait: 1500,
      expect:
        "document.querySelector('.create-dialog .field-error')?.textContent.includes('does not exist')",
    },
    {
      name: 'j01-add-project',
      script: `J.set('#create-value', ${JSON.stringify(secondRepository)}); J.click('.create-dialog button[type=submit]');`,
      wait: 1500,
      expect:
        "!document.querySelector('.create-dialog') && document.querySelector('.location').textContent.includes('second-repo') && document.querySelector('.hint').textContent.includes('no workflows')",
    },
    {
      name: 'j02-new-workflow',
      script: `J.click('.hint button', 'New workflow'); setTimeout(() => { J.set('#create-value', 'Branch by size'); J.click('.create-dialog button[type=submit]'); }, 200);`,
      wait: 1500,
      expect:
        "document.querySelector('.location').textContent.includes('Branch by size') && document.querySelector('.react-flow__node[data-id=start]')",
      report: 'location.hash',
    },
    {
      name: 'j03-trigger-input',
      script: `location.hash += '/n/start'; setTimeout(() => J.click('.node-editor button', 'Add a field'), 300);
        setTimeout(() => { J.set('#start-input-0-name', 'files'); }, 600);
        setTimeout(() => { J.set('#start-input-0-type', 'integer'); }, 800);
        setTimeout(() => J.click('.node-editor .field-check input'), 1000);`,
      wait: 1500,
      expect:
        "document.querySelector('#start-input-0-type').value === 'integer' && document.querySelector('.node-editor .field-check input').checked",
    },
    {
      name: 'j04-condition',
      script: `J.click('[aria-label="Add a node"]'); setTimeout(() => J.click('.node-picker button', 'Condition'), 200);
        setTimeout(() => J.click('.node-editor button', 'Add a value'), 600);
        setTimeout(() => J.set('#condition-binding-0-name', 'files'), 900);
        setTimeout(() => J.set('#condition-binding-0-kind', 'trigger'), 1100);
        setTimeout(() => J.set('#condition-binding-0-path', 'files'), 1300);
        setTimeout(() => J.click('.builder-rule button, .node-editor button', 'Add a test'), 1500);
        setTimeout(() => J.set('#condition-when-op', 'gt'), 1700);
        setTimeout(() => J.set('#condition-when-right-value-kind', 'number'), 1900);
        setTimeout(() => J.set('#condition-when-right-value', '20'), 2100);`,
      wait: 2600,
      expect:
        "document.querySelector('#condition-when-left-source').value === '=files' && document.querySelector('#condition-when-right-value').value === '20'",
    },
    {
      name: 'j05-two-ends',
      script: `J.click('[aria-label="Add a node"]'); setTimeout(() => J.click('.node-picker button', 'End'), 200);
        setTimeout(() => J.click('[aria-label="Add a node"]'), 500); setTimeout(() => J.click('.node-picker button', 'End'), 700);
        setTimeout(() => J.click('[aria-label="Close"], .inspector [aria-label^="Close"]'), 1000);
        setTimeout(() => J.click('[aria-label="Fit the graph"], [aria-label="Fit"]'), 1200);`,
      wait: 1800,
      expect: "document.querySelectorAll('.react-flow__node').length === 4",
    },
    {
      name: 'j06-connect-by-mouse',
      pull: {
        from: '.react-flow__node[data-id="start"] .react-flow__handle.source',
        to: '.react-flow__node[data-id="condition"] .react-flow__handle.target',
      },
      wait: 500,
      expect: "document.querySelectorAll('.react-flow__edge').length === 1",
    },
    {
      name: 'j07-connect-true-by-mouse',
      pull: {
        from: '.react-flow__node[data-id="condition"] .react-flow__handle[data-handleid="true"]',
        to: '.react-flow__node[data-id="end"] .react-flow__handle.target',
      },
      wait: 500,
      expect: "document.querySelectorAll('.react-flow__edge').length === 2",
    },
    {
      name: 'j08-connect-false-by-keyboard',
      script: `location.hash += '/n/condition'; new Promise((done) => setTimeout(done, 500)).then(() => document.querySelector('#condition-port-false').focus())`,
      keys: ['Down', 'Down', 'Down'],
      wait: 700,
      expect:
        "document.activeElement.id === 'condition-port-false' && document.querySelector('#condition-port-false').value !== ''",
      report: "document.querySelector('#condition-port-false').value",
    },
    {
      name: 'j08b-add-by-keyboard',
      script: `document.querySelector('[aria-label="Add a node"]').focus();`,
      keys: ['Return', 'Return'],
      wait: 800,
      expect:
        "document.querySelector('.react-flow__node[data-id=agent]') && document.activeElement.id === 'agent-id'",
    },
    {
      name: 'j08c-delete-by-keyboard',
      script: `[...document.querySelectorAll('.node-editor .button.danger')][0].focus();`,
      keys: ['Return'],
      wait: 500,
      expect: "!document.querySelector('.react-flow__node[data-id=agent]')",
    },
    {
      name: 'j08d-reconnect-by-mouse',
      pull: {
        from: '.react-flow__edge[data-id="c2"] .react-flow__edgeupdater-target',
        to: '.react-flow__node[data-id="end_2"] .react-flow__handle.target',
      },
      wait: 500,
      expect:
        "document.querySelector('.react-flow__edge[data-id=\"c2\"]').getAttribute('aria-label')?.includes('end_2')",
      report: `[...document.querySelectorAll('.react-flow__edge')].map((edge) => edge.dataset.id + ':' + (edge.getAttribute('aria-label') ?? ''))`,
    },
    {
      name: 'j08e-undo-reconnect',
      script: `document.querySelector('[aria-label=Undo]').click();`,
      wait: 400,
    },
    {
      name: 'j08f-drop-on-canvas',
      pull: {
        from: '.react-flow__node[data-id="condition"] .react-flow__handle[data-handleid="error"]',
        to: [960, 780],
      },
      wait: 500,
      expect: "document.querySelector('.node-picker')",
    },
    {
      name: 'j08g-joined-to-port',
      script: `J.click('.node-picker button', 'End');`,
      wait: 700,
      expect:
        "document.querySelector('.react-flow__node[data-id=end_3]') && document.querySelectorAll('.react-flow__edge').length === 4",
    },
    {
      name: 'j08h-undo-drop',
      script: `document.querySelector('[aria-label=Undo]').click();`,
      wait: 400,
      expect:
        "!document.querySelector('.react-flow__node[data-id=end_3]') && document.querySelectorAll('.react-flow__edge').length === 3",
    },
    {
      name: 'j09-saved-published',
      script: `setTimeout(() => J.click('.toolbar button', 'Save'), 300);
        setTimeout(() => J.click('.toolbar button', 'Publish'), 1500);`,
      wait: 3000,
      expect:
        "document.querySelector('.toolbar').textContent.includes('v1 published') && document.querySelectorAll('.react-flow__edge').length === 3",
    },
    {
      name: 'j10-run-form',
      script: `J.click('.toolbar button', 'Run');`,
      wait: 500,
      expect: "document.querySelector('.run-input input') && !document.querySelector('#run-input')",
    },
    {
      name: 'j11-run-finished',
      script: `J.set('.run-input input', '42'); J.click('.run-input button[type=submit]');`,
      wait: 3000,
      expect:
        "location.hash.includes('/r/') && document.querySelector('.react-flow__node[data-id=end] .node-state') && !document.querySelector('.react-flow__node[data-id=end_2] .node-state[data-status=completed]')",
    },
    {
      name: 'j12-version-read-only',
      script: `J.click('[data-crumb=run]'); setTimeout(() => J.click('.runs-menu button', 'Version 1'), 200);`,
      wait: 1200,
      expect:
        "document.querySelector('.location').textContent.includes('Version 1') && document.querySelector('.location').textContent.includes('Read only') && !location.hash.includes('/r/') && !document.querySelector('.toolbar [aria-label=\"Add a node\"]') && document.querySelectorAll('.react-flow__edge').length === 3",
    },
    {
      name: 'j13-unsaved-holds-close',
      script: `J.click('[data-crumb=run]'); setTimeout(() => J.click('.runs-menu button', 'Draft'), 200);
        setTimeout(() => J.click('[aria-label="Add a node"]'), 800); setTimeout(() => J.click('.node-picker button', 'Wait'), 1000);`,
      wait: 1500,
    },
    {
      name: 'j14-still-open',
      close: true,
      wait: 800,
      expect: "document.querySelector('.location').textContent.includes('unsaved')",
    },
    // tools/capture.mjs saves this draft from the CLI once j14 is captured.
    { name: 'j15-conflict', wait: 3000, expect: "document.querySelector('.conflict')" },
    {
      name: 'j16-kept-mine',
      script: `J.click('.conflict button', 'Keep mine');`,
      wait: 500,
      expect:
        "!document.querySelector('.conflict') && document.querySelector('.react-flow__node[data-id=wait]')",
    },
    {
      name: 'j17-saved-over-theirs',
      script: `J.click('.toolbar button', 'Save');`,
      wait: 1500,
      expect:
        "!document.querySelector('.conflict') && !document.querySelector('.location').textContent.includes('unsaved')",
      report: 'location.hash',
    },
    // Prompt 14: a nested human form built without JSON, a crash with unsaved edits and a save
    // from elsewhere, then the run answered through the request form.
    {
      name: 'r1-nested-form',
      script: `J.click('[aria-label="Add a node"]'); setTimeout(() => J.click('.node-picker button', 'Human input'), 200);
        setTimeout(() => J.set('#human_input-title', 'Release notes'), 600);
        setTimeout(() => J.click('.node-editor button', 'Add a field'), 800);
        setTimeout(() => J.set('#human_input-form-0-name', 'release'), 1000);
        setTimeout(() => J.set('#human_input-form-0-type', 'object'), 1200);
        setTimeout(() => J.click('.node-editor button', 'Add a field'), 1400);
        setTimeout(() => J.set('#human_input-form-0-fields-0-name', 'summary'), 1600);
        setTimeout(() => J.click('.node-editor button', 'Add a field'), 1800);
        setTimeout(() => J.set('#human_input-form-0-fields-1-name', 'risky'), 2000);
        setTimeout(() => J.set('#human_input-form-0-fields-1-type', 'array'), 2200);
        setTimeout(() => J.set('#human_input-port-success', 'end'), 2400);`,
      wait: 2900,
      expect:
        "document.querySelector('#human_input-form-0-fields-1-items-type')?.value === 'text' && document.querySelector('#human_input-port-success').value === 'end'",
    },
    {
      name: 'r2-routed',
      script: `location.hash = location.hash.split('/n/')[0] + '/n/condition'; setTimeout(() => J.set('#condition-port-true', 'human_input'), 500);`,
      wait: 900,
      expect: "document.querySelector('#condition-port-true').value === 'human_input'",
    },
    {
      name: 'r2b-nested-builder',
      script: `location.hash = location.hash.split('/n/')[0] + '/n/human_input'; setTimeout(() => document.querySelector('#human_input-form-0-fields-1-name')?.scrollIntoView(), 400);`,
      wait: 800,
    },
    // tools/capture.mjs saves this workflow from the CLI once r2 is captured.
    { name: 'r3-saved-elsewhere', wait: 3500, expect: "document.querySelector('.conflict')" },
    {
      name: 'r4-crashed-and-back',
      crash: true,
      wait: 4000,
      report:
        "[!!document.querySelector('.conflict'), !!document.querySelector('.react-flow__node[data-id=human_input]'), document.querySelector('.notice')?.textContent ?? null, location.hash, document.querySelector('.location')?.textContent]",
      expect:
        "document.querySelector('.conflict') && document.querySelector('.react-flow__node[data-id=human_input]') && document.querySelector('.notice')?.textContent.includes('earlier session')",
    },
    {
      name: 'r5-kept-and-published',
      script: `${JOURNEY_HELPERS}
        J.click('.conflict button', 'Keep mine');
        setTimeout(() => J.click('.toolbar button', 'Save'), 400);
        setTimeout(() => J.click('.toolbar button', 'Publish'), 1800);`,
      wait: 3200,
      expect:
        "!document.querySelector('.conflict') && document.querySelector('.toolbar').textContent.includes('v2 published')",
    },
    {
      name: 'r6-run-waits',
      script: `J.click('.toolbar button', 'Run'); setTimeout(() => { J.set('.run-input input', '42'); J.click('.run-input button[type=submit]'); }, 500);`,
      wait: 3000,
      expect:
        "location.hash.includes('/r/') && /Wait|Need/.test(document.querySelector('.run-status')?.textContent ?? '')",
    },
    {
      name: 'r7-request-form',
      script: `location.hash = location.hash.split('/n/')[0] + '/n/human_input';`,
      wait: 1200,
      expect:
        "document.querySelector('.request form') && document.querySelector('.request').textContent.includes('Release')",
    },
    {
      name: 'r8-answered',
      script: `const inputs = () => [...document.querySelectorAll('.request form input, .request form textarea')];
        J.set('.request form textarea', 'Billing refactor');
        J.click('.request form button', 'Add');
        setTimeout(() => { const last = inputs().at(-1); last.id = 'risky-0'; J.set('#risky-0', 'billing/ledger.ts'); }, 300);
        setTimeout(() => J.click('.request-actions button'), 600);`,
      wait: 3000,
      expect: "document.querySelector('.run-status')?.textContent.includes('Completed')",
    },
    // Prompt 14b: a loop that counts to three, authored through the forms and run.
    {
      name: 'v1-new-workflow',
      script: `J.click('.location .crumb'); setTimeout(() => J.click('.switcher-create', 'New workflow'), 300);
        setTimeout(() => { J.set('#create-value', 'Count to three'); J.click('.create-dialog button[type=submit]'); }, 700);`,
      wait: 2000,
      expect:
        "document.querySelector('.location').textContent.includes('Count to three') && document.querySelector('.react-flow__node[data-id=start]')",
    },
    {
      name: 'v2-set-variable',
      script: `J.click('[aria-label="Add a node"]'); setTimeout(() => J.click('.node-picker button', 'Set variable'), 200);
        setTimeout(() => J.set('#set_variable-key', 'count'), 700);`,
      wait: 1100,
      expect:
        "document.querySelector('#set_variable-key').value === 'count' && document.querySelector('#set_variable-value-value-value').value === '0'",
    },
    {
      name: 'v3-condition-reads-variable',
      script: `J.click('[aria-label="Add a node"]'); setTimeout(() => J.click('.node-picker button', 'Condition'), 200);
        setTimeout(() => J.click('.node-editor button', 'Add a value'), 600);
        setTimeout(() => J.set('#condition-binding-0-name', 'count'), 900);
        setTimeout(() => J.set('#condition-binding-0-kind', 'variable'), 1100);
        setTimeout(() => J.click('.node-editor button', 'Add a test'), 1300);
        setTimeout(() => J.set('#condition-when-op', 'lt'), 1500);
        setTimeout(() => J.set('#condition-when-right-value-kind', 'number'), 1700);
        setTimeout(() => J.set('#condition-when-right-value', '3'), 1900);`,
      wait: 2400,
      expect:
        "document.querySelector('#condition-binding-0-variable').value === 'count' && document.querySelector('#condition-when-left-source').value === '=count' && document.querySelector('#condition-when-right-value').value === '3'",
    },
    {
      name: 'v4-calculated-write',
      script: `J.click('[aria-label="Add a node"]'); setTimeout(() => J.click('.node-picker button', 'Set variable'), 200);
        setTimeout(() => J.set('#set_variable_2-key', 'count'), 600);
        setTimeout(() => J.click('.node-editor button', 'Add a value'), 800);
        setTimeout(() => J.set('#set_variable_2-binding-0-name', 'count'), 1000);
        setTimeout(() => J.set('#set_variable_2-binding-0-kind', 'variable'), 1200);
        setTimeout(() => J.click('.node-editor button', 'Calculate it'), 1400);`,
      wait: 1900,
      expect:
        "document.querySelector('#set_variable_2-value-operation').value === '$add' && document.querySelector('#set_variable_2-value-0-value-source').value === '=count' && document.querySelector('#set_variable_2-value-1-value-value').value === '1'",
    },
    {
      name: 'v4b-calculation',
      script: `document.querySelector('#set_variable_2-value-operation').scrollIntoView({ block: 'center' });`,
      wait: 500,
    },
    {
      name: 'v5-connected',
      script: `const at = (node) => { location.hash = location.hash.split('/n/')[0] + '/n/' + node; };
        J.click('[aria-label="Add a node"]'); setTimeout(() => J.click('.node-picker button', 'End'), 200);
        setTimeout(() => at('start'), 500); setTimeout(() => J.set('#start-port-success', 'set_variable'), 800);
        setTimeout(() => at('set_variable'), 1000); setTimeout(() => J.set('#set_variable-port-success', 'condition'), 1300);
        setTimeout(() => at('condition'), 1500); setTimeout(() => { J.set('#condition-port-true', 'set_variable_2'); J.set('#condition-port-false', 'end'); }, 1800);
        setTimeout(() => at('set_variable_2'), 2000); setTimeout(() => J.set('#set_variable_2-port-success', 'condition'), 2300);
        setTimeout(() => J.click('[aria-label="Fit the graph"], [aria-label="Fit"]'), 2500);`,
      wait: 3000,
      expect: "document.querySelectorAll('.react-flow__edge').length === 5",
    },
    {
      name: 'v6-published',
      script: `J.click('.toolbar button', 'Save'); setTimeout(() => J.click('.toolbar button', 'Publish'), 1300);`,
      wait: 2800,
      expect: "document.querySelector('.toolbar').textContent.includes('v1 published')",
    },
    {
      name: 'v7-loop-ran',
      script: `J.click('.toolbar button', 'Run');`,
      wait: 4000,
      expect:
        "document.querySelector('.run-status')?.textContent.includes('Completed') && document.querySelector('.react-flow__node[data-id=condition] .node-loop')?.textContent === '×4' && document.querySelector('.react-flow__node[data-id=set_variable_2] .node-loop')?.textContent === '×3'",
      report: 'location.hash',
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
  const saveElsewhere = async (id = workflow.id) => {
    const current = await cli(['workflow', 'show', id, ...admin]);
    const file = join(temporaryRoot, 'elsewhere.json');
    current.draft.nodes[0].position.y += 40;
    await writeFile(file, JSON.stringify(current.draft));
    await cli([
      'workflow',
      'save',
      id,
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
  let held = false;
  let journeyWorkflow;
  let loopVariables;
  app.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    const text = String(chunk);
    if (text.includes('SHIFT_CAPTURE unload-held')) held = true;
    const reported = /SHIFT_REPORT j02-new-workflow "[^"]*\/w\/([0-9a-f-]{36})/.exec(text);
    if (reported) journeyWorkflow = reported[1];
    if (text.includes('SHIFT_CAPTURE r2-routed')) void saveElsewhere(journeyWorkflow);
    const looped = /SHIFT_REPORT v7-loop-ran "[^"]*\/r\/([0-9a-f-]{36})/.exec(text);
    if (looped) loopVariables = cli(['run', 'variables', looped[1], ...admin]);
    if (text.includes('SHIFT_CAPTURE j14-still-open')) {
      if (!held) throw new Error('Closing with unsaved edits was not held');
      void saveElsewhere(journeyWorkflow);
    }
    if (!saved && String(chunk).includes('SHIFT_CAPTURE 15h-edited-here')) {
      saved = true;
      void saveElsewhere();
    }
    if (!started && String(chunk).includes('SHIFT_CAPTURE 17-inbox')) {
      started = true;
      void cli(['run', 'start', '--workflow', workflow.id, ...admin]);
    }
  });
  const timer = setTimeout(() => app.kill('SIGKILL'), 300_000);
  const code = await new Promise((done) => app.on('close', done));
  clearTimeout(timer);
  if (code !== 0) throw new Error(`Capture failed: ${code}`);
  // The loop's variable, as the server kept it: three writes after the first.
  const { variables, revisions } = await loopVariables;
  if (variables[0]?.key !== 'count' || variables[0].value !== 3 || revisions.length !== 4)
    throw new Error(`The authored loop left ${JSON.stringify(variables)}`);
  console.log(`Screenshots in ${output}`);
} finally {
  server?.kill('SIGTERM');
  await delay(300);
  await rm(temporaryRoot, { recursive: true, force: true });
}
