import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { stageElectron } from './stage.mjs';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const packaged = process.argv.includes('--packaged');
let executable = packaged ? '' : require('electron');
let args = [root, '--shift-smoke'];
if (packaged) {
  if (process.platform === 'linux') executable = join(root, 'release/linux-unpacked/shift');
  else if (process.platform === 'win32') executable = join(root, 'release/win-unpacked/Shift.exe');
  else {
    const directory = (await readdir(join(root, 'release'))).find(
      (name) => name === (process.arch === 'arm64' ? 'mac-arm64' : 'mac'),
    );
    if (!directory) throw new Error('Matching macOS package missing');
    executable = join(root, 'release', directory, 'Shift.app/Contents/MacOS/Shift');
  }
  args = ['--shift-smoke'];
}
const temporaryRoot = await mkdtemp(join(tmpdir(), 'shift-app-smoke-'));
let timeout;
try {
  const state = join(temporaryRoot, 'state');
  await mkdir(state);
  let env = { ...process.env, SHIFT_SMOKE_STATE: state };
  delete env.ELECTRON_RUN_AS_NODE;
  ({ executable, args, env } = await stageElectron({
    root,
    temporaryRoot,
    state,
    executable,
    args,
    env,
    packaged,
  }));
  const child = spawn(executable, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  const terminate = () => {
    if (typeof child.pid !== 'number') return;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    }
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  };
  timeout = setTimeout(terminate, 45_000);
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (code !== 0 || !output.includes('SHIFT_SMOKE_OK'))
    throw new Error(`Electron smoke failed: ${code}`);
  console.log(
    `Verified ${packaged ? 'packaged' : 'built'} Electron on ${process.platform}/${process.arch}.`,
  );
} finally {
  clearTimeout(timeout);
  await rm(temporaryRoot, { recursive: true, force: true });
}
