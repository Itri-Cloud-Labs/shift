import { app, BrowserWindow, ipcMain, nativeTheme, protocol, session, shell } from 'electron';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientCore } from '../client-core/runtime.js';
import { ConnectionRuntime } from '../client-core/connection.js';
import { ServerHttp } from '../client-core/http.js';
import { watchAttention } from './notifications.js';
import {
  credentialStore,
  FilePreferenceStore,
  FileProfileStore,
  FileSyncStore,
} from './storage.js';
import { CHANGE_CHANNEL, IPC_CHANNEL } from '../shared/contracts.js';
import { dispatch } from './dispatcher.js';
import { APP_URL, CSP, assetPath, securePreferences } from './security.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const smoke = process.argv.includes('--shift-smoke');
// Development screenshots (tools/capture.mjs); never in a packaged app.
const capture = !app.isPackaged && process.argv.includes('--shift-capture');
protocol.registerSchemesAsPrivileged([
  { scheme: 'shift', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.enableSandbox();
// Chromium process sandbox flags are never disabled by the application.
if ((smoke || capture) && process.env.SHIFT_SMOKE_STATE)
  app.setPath('userData', process.env.SHIFT_SMOKE_STATE);
let window: BrowserWindow | undefined;

// The canvas color of the current theme, so the window never flashes another color.
function canvasColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#0e1211' : '#f4f6f5';
}
function titleBarOverlay() {
  return {
    color: canvasColor(),
    symbolColor: nativeTheme.shouldUseDarkColors ? '#c9d1ce' : '#3a4340',
    height: 44,
  };
}
let core: ClientCore;

// Created once the app is ready: safeStorage and userData are only available then.
function createCore(): ClientCore {
  const http = new ServerHttp((url, init) => fetch(url, init));
  const connection = new ConnectionRuntime({
    http,
    credentials: credentialStore(join(app.getPath('userData'), 'credentials')),
    profiles: new FileProfileStore(join(app.getPath('userData'), 'connections.json')),
    // Plain HTTP to this computer is for development; remote servers always need HTTPS.
    allowLoopbackHttp: !app.isPackaged,
  });
  return new ClientCore(
    connection,
    http,
    !app.isPackaged,
    new FileSyncStore(join(app.getPath('userData'), 'sync')),
    new FilePreferenceStore(join(app.getPath('userData'), 'preferences.json')),
  );
}

async function createWindow(): Promise<void> {
  const assets = JSON.parse(await readFile(join(root, 'renderer-assets.json'), 'utf8')) as Record<
    string,
    string
  >;
  const allowed = new Set(Object.keys(assets));
  const rendererRoot = await realpath(join(root, 'renderer'));
  await protocol.handle('shift', async (request) => {
    const path = assetPath(request.url, allowed);
    if (request.method !== 'GET' || !path) return new Response(null, { status: 404 });
    try {
      const file = await realpath(join(rendererRoot, path));
      const suffix = relative(rendererRoot, file);
      if (suffix.startsWith(`..${sep}`) || suffix === '..' || suffix.startsWith(sep))
        return new Response(null, { status: 403 });
      return new Response(await readFile(file), {
        headers: {
          'Content-Type': assets[path]!,
          'Content-Security-Policy': CSP,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  const desktopSession = session.defaultSession;
  desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !assetPath(details.url, allowed) });
  });
  desktopSession.on('will-download', (event) => event.preventDefault());
  // Frameless: the canvas runs edge to edge under the system window controls.
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Shift',
    backgroundColor: canvasColor(),
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarOverlay: titleBarOverlay() }),
    webPreferences: { ...securePreferences, preload: join(root, 'preload/index.cjs') },
  });
  window.removeMenu();
  const contents = window.webContents;
  const owned = window;
  const followTheme = () => {
    if (owned.isDestroyed()) return;
    owned.setBackgroundColor(canvasColor());
    if (process.platform !== 'darwin') owned.setTitleBarOverlay(titleBarOverlay());
  };
  nativeTheme.on('updated', followTheme);
  owned.on('closed', () => nativeTheme.removeListener('updated', followTheme));
  // Change notifications carry no data, and bursts are coalesced.
  let pending: NodeJS.Timeout | undefined;
  const changed = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = undefined;
      if (!contents.isDestroyed()) contents.send(CHANGE_CHANNEL);
    }, 50);
  };
  const unsubscribe = [
    core.connection.subscribe(changed),
    core.sync.subscribe(changed),
    core.preferences.subscribe(changed),
    watchAttention(owned, core),
  ];
  owned.on('closed', () => unsubscribe.forEach((stop) => stop()));
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  ipcMain.handle(IPC_CHANNEL, async (event, value: unknown) =>
    dispatch(
      core,
      {
        senderId: event.sender.id,
        mainSenderId: contents.id,
        frameIsMain: event.senderFrame !== null && event.senderFrame === contents.mainFrame,
        url: event.senderFrame?.url ?? '',
      },
      value,
      (url) => shell.openExternal(url),
    ),
  );
  contents.on('render-process-gone', () => {
    if (smoke) app.exit(1);
  });
  await window.loadURL(APP_URL);
  window.show();
  if (capture) {
    const { runCapture } = await import('./capture.js');
    await runCapture(window, core);
    window.destroy();
    app.quit();
    return;
  }
  if (smoke) {
    const { runSmoke } = await import('./smoke.js');
    await runSmoke(window, core);
    console.log('SHIFT_SMOKE_OK');
    window.destroy();
    app.quit();
  }
}
app.on('window-all-closed', () => {
  core.connection.disconnect();
  if (process.platform !== 'darwin' || smoke) app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    ipcMain.removeHandler(IPC_CHANNEL);
    protocol.unhandle('shift');
    void createWindow().catch(() => app.exit(1));
  }
});
void app
  .whenReady()
  .then(async () => {
    core = createCore();
    // The theme applies before the window exists, so it never opens in the wrong one.
    core.preferences.subscribe(({ theme }) => {
      nativeTheme.themeSource = theme;
    });
    await core.preferences.load();
    // The smoke test starts without any saved connection.
    if (!smoke) {
      core.sync.start();
      void core.connection.start().catch(() => undefined);
    }
    await createWindow();
  })
  .catch((error) => {
    if (smoke || capture) console.error(error);
    console.error('The desktop could not start.');
    app.exit(1);
  });
