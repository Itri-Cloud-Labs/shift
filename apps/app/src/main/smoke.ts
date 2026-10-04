import { app, type BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import type { ClientCore } from '../client-core/runtime.js';
import { APP_URL } from './security.js';

export async function runSmoke(window: BrowserWindow, core: ClientCore): Promise<void> {
  const renderer = app
    .getAppMetrics()
    .find((metric) => metric.pid === window.webContents.getOSProcessId());
  if (process.platform !== 'linux' && !renderer?.sandboxed)
    throw new Error('Renderer is not sandboxed');
  if (process.platform === 'linux') {
    const status = await readFile(`/proc/${window.webContents.getOSProcessId()}/status`, 'utf8');
    if (!/NoNewPrivs:\s+1/.test(status) || !/Seccomp:\s+2/.test(status))
      throw new Error('Linux renderer sandbox is absent');
  }
  if (app.isPackaged && core.shell().samples)
    throw new Error('Packaged app enabled samples by default');
  if (core.shell().connection !== 'unconfigured') throw new Error('Smoke started a connection');
  const report: unknown = await window.webContents.executeJavaScript(`(async () => {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const wait = async (predicate) => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('UI wait timed out'); };
    assert(location.href === '${APP_URL}', 'Wrong document');
    assert(typeof require === 'undefined' && typeof process === 'undefined' && typeof Buffer === 'undefined', 'Node leaked');
    assert(window.shift && Object.keys(window.shift).sort().join(',') === 'openDocumentation,queryServer,readShell,setSamples', 'Broad bridge');
    assert((await window.shift.queryServer('info')).code === 'DISCONNECTED', 'Unexpected live transport');
    assert((await window.shift.queryServer('admin/shutdown')).code === 'INVALID_REQUEST', 'Operation accepted');
    assert((await window.shift.setSamples('bearer-secret')).code === 'INVALID_REQUEST', 'Invalid sample request accepted');
    const state = await window.shift.setSamples(true);
    assert(state.kind === 'shell' && state.state.connection === 'unconfigured', 'Bad fixture state');
    assert(!/bearer|credentialHandle|authorization|accessToken/.test(JSON.stringify(state)), 'Credential leaked');
    await wait(() => document.querySelector('h2'));
    for (const section of ['Projects', 'Workflows', 'Runs', 'Sessions', 'Attention', 'Settings']) {
      const button = [...document.querySelectorAll('nav button')].find(item => item.textContent === section);
      assert(button, 'Missing shell section ' + section);
      button.click();
      await wait(() => document.querySelector('h2').textContent === section);
      assert(button.getAttribute('aria-current') === 'page', 'Section selection failed');
      assert(document.querySelector('main').textContent.includes('No server connected.'), 'Missing disconnected state');
    }
    assert(!document.querySelector('input, [role="dialog"], .resource-row, .sidebar'), 'Product UI remains');
    let blocked = false;
    try { await fetch('https://example.com'); } catch { blocked = true; }
    assert(blocked, 'Renderer network allowed');
    blocked = false;
    try { eval('1 + 1'); } catch { blocked = true; }
    assert(blocked, 'CSP permits eval');
    assert(window.open('https://example.com') === null, 'Window opened');
    const link = document.createElement('a'); link.href = 'https://example.com'; document.body.append(link); link.click(); link.remove();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert(location.href === '${APP_URL}', 'Navigation escaped');
    return { views: 6, sandbox: true, bridge: 'narrow', connection: 'unconfigured' };
  })()`);
  window.setSize(780, 600);
  const overflow = await window.webContents.executeJavaScript(
    'document.documentElement.scrollWidth > window.innerWidth',
  );
  if (overflow) throw new Error('Shell overflows at its minimum desktop width');
  window.setSize(1240, 820);
  console.log(JSON.stringify(report));
}
