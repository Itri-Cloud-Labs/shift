import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNEL,
  parseRequest,
  parseResponse,
  type DesktopBridge,
  type DesktopRequest,
  type DesktopResponse,
} from '../shared/contracts.js';
import { validateServerInfo, validateServerHealth } from '../protocol/generated/validators.js';

async function invoke(request: DesktopRequest): Promise<DesktopResponse> {
  if (!parseRequest(request))
    return { kind: 'error', code: 'INVALID_REQUEST', message: 'The desktop request is invalid.' };
  const response = parseResponse(await ipcRenderer.invoke(IPC_CHANNEL, request));
  if (
    !response ||
    (response.kind === 'server' &&
      !(response.operation === 'info'
        ? validateServerInfo(response.value)
        : validateServerHealth(response.value)))
  ) {
    return { kind: 'error', code: 'INVALID_RESPONSE', message: 'The server response is invalid.' };
  }
  return response;
}
const bridge: DesktopBridge = {
  readShell: () => invoke({ kind: 'shell.read' }),
  setSamples: (enabled) => invoke({ kind: 'samples.set', enabled }),
  queryServer: (operation) => invoke({ kind: 'server.query', operation }),
  openDocumentation: () => invoke({ kind: 'desktop.openDocumentation' }),
};
if (!process.sandboxed || !process.contextIsolated)
  throw new Error('Unsafe renderer configuration');
contextBridge.exposeInMainWorld('shift', Object.freeze(bridge));
