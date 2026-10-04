import { spawn } from 'node:child_process';
import {
  mkdtemp,
  readdir,
  rm,
  cp,
  chmod,
  chown,
  mkdir,
  writeFile,
  readFile,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
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
  const env = { ...process.env, SHIFT_SMOKE_STATE: state };
  delete env.ELECTRON_RUN_AS_NODE;
  // CI/desktop users run directly. This development container runs as root, so
  // stage only the app in an owned temporary directory and launch as nobody.
  // Never compensate for root by disabling Chromium's sandbox.
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    await chmod(temporaryRoot, 0o755);
    await chown(state, 65534, 65534);
    await chmod(state, 0o700);
    await cp(dirname(executable), join(temporaryRoot, 'runtime'), { recursive: true });
    await chmod(join(temporaryRoot, 'runtime/chrome-sandbox'), 0o4755);
    executable = join(temporaryRoot, 'runtime', packaged ? 'shift' : 'electron');
    if (!packaged) {
      const stagedApp = join(temporaryRoot, 'app');
      await mkdir(stagedApp);
      await cp(join(root, 'dist'), join(stagedApp, 'dist'), { recursive: true });
      await writeFile(
        join(stagedApp, 'package.json'),
        JSON.stringify({
          name: 'shift-smoke',
          version: '0.0.0',
          type: 'module',
          main: 'dist/main/index.js',
        }),
      );
      args = [stagedApp, '--shift-smoke'];
    }
    if (env.XAUTHORITY) {
      const authority = join(state, 'Xauthority');
      await writeFile(authority, await readFile(env.XAUTHORITY), { mode: 0o600 });
      await chown(authority, 65534, 65534);
      env.XAUTHORITY = authority;
    }
    args = ['--preserve-environment', '-u', 'nobody', '--', executable, ...args];
    executable = 'runuser';
    // Child receives an isolated home; the parent environment stays unchanged.
    env['HOME'] = state;
    env.XDG_RUNTIME_DIR = state;
    delete env.DBUS_SESSION_BUS_ADDRESS;
  }
  const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  timeout = setTimeout(() => child.kill(), 45_000);
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
