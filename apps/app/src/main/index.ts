import { app, BrowserWindow, ipcMain, protocol, session, shell } from 'electron';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientCore } from '../client-core/runtime.js';
import { IPC_CHANNEL } from '../shared/contracts.js';
import { dispatch } from './dispatcher.js';
import { APP_URL, CSP, assetPath, securePreferences } from './security.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const smoke = process.argv.includes('--shift-smoke');
protocol.registerSchemesAsPrivileged([
  { scheme: 'shift', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.enableSandbox();
// Chromium process sandbox flags are never disabled by the application.
if (smoke && process.env.SHIFT_SMOKE_STATE) app.setPath('userData', process.env.SHIFT_SMOKE_STATE);
let window: BrowserWindow | undefined;
const core = new ClientCore(
  {
    query: async () => {
      throw new Error('Disconnected');
    },
  },
  { resolve: async () => undefined },
  undefined,
  !app.isPackaged,
);

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
  window = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    show: false,
    title: 'Shift',
    backgroundColor: '#ffffff',
    webPreferences: { ...securePreferences, preload: join(root, 'preload/index.cjs') },
  });
  window.removeMenu();
  const contents = window.webContents;
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
  if (smoke) {
    const { runSmoke } = await import('./smoke.js');
    await runSmoke(window, core);
    console.log('SHIFT_SMOKE_OK');
    window.destroy();
    app.quit();
  }
}
app.on('window-all-closed', () => {
  core.disconnect();
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
  .then(createWindow)
  .catch((error) => {
    if (smoke) console.error(error);
    console.error('The desktop could not start.');
    app.exit(1);
  });
