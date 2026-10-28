import { chmod, chown, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// CI/desktop users run Electron directly. A development container runs as root, so stage only
// the app in an owned temporary directory and launch it as nobody. Never compensate for root by
// disabling Chromium's sandbox.
export async function stageElectron({
  root,
  temporaryRoot,
  state,
  executable,
  args,
  env,
  packaged,
}) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) return { executable, args, env };
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
    args = [stagedApp, ...args.slice(1)];
  }
  if (env.XAUTHORITY) {
    const authority = join(state, 'Xauthority');
    await writeFile(authority, await readFile(env.XAUTHORITY), { mode: 0o600 });
    await chown(authority, 65534, 65534);
    env.XAUTHORITY = authority;
  }
  // The child receives an isolated home; the parent environment stays unchanged.
  env.HOME = state;
  env.XDG_RUNTIME_DIR = state;
  delete env.DBUS_SESSION_BUS_ADDRESS;
  return {
    executable: 'runuser',
    args: ['--preserve-environment', '-u', 'nobody', '--', executable, ...args],
    env,
  };
}
