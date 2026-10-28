import { contextBridge, ipcRenderer } from 'electron';
import {
  CHANGE_CHANNEL,
  IPC_CHANNEL,
  parseRequest,
  parseResponse,
  type DesktopBridge,
  type DesktopRequest,
  type DesktopResponse,
} from '../shared/contracts.js';
import {
  validateRunResponse,
  validateServerHealth,
  validateServerInfo,
  validateWorkflowResponse,
  validateWorkflowVersionResponse,
} from '../protocol/generated/validators.js';

const resourceValidators = {
  workflow: validateWorkflowResponse,
  version: validateWorkflowVersionResponse,
  run: validateRunResponse,
};

async function invoke(request: DesktopRequest): Promise<DesktopResponse> {
  if (!parseRequest(request))
    return { kind: 'error', code: 'INVALID_REQUEST', message: 'The desktop request is invalid.' };
  const response = parseResponse(await ipcRenderer.invoke(IPC_CHANNEL, request));
  if (
    !response ||
    (response.kind === 'server' &&
      !(response.operation === 'info'
        ? validateServerInfo(response.value)
        : validateServerHealth(response.value))) ||
    (response.kind === 'resource' && !resourceValidators[response.resource](response.value))
  ) {
    return { kind: 'error', code: 'INVALID_RESPONSE', message: 'The server response is invalid.' };
  }
  return response;
}
const bridge: DesktopBridge = {
  readShell: () => invoke({ kind: 'shell.read' }),
  connection: Object.freeze({
    read: () => invoke({ kind: 'connection.read' }),
    pair: (form: { url: string; phrase: string; deviceName: string }) =>
      invoke({
        kind: 'connection.pair',
        url: form?.url,
        phrase: form?.phrase,
        deviceName: form?.deviceName,
      } as DesktopRequest),
    abandonPairing: () => invoke({ kind: 'connection.abandonPairing' }),
    connect: (profileId: string) => invoke({ kind: 'connection.connect', profileId }),
    changeAddress: (profileId: string, url: string) =>
      invoke({ kind: 'connection.changeAddress', profileId, url }),
    clear: (profileId: string) => invoke({ kind: 'connection.clear', profileId }),
  }),
  sync: Object.freeze({
    read: () => invoke({ kind: 'sync.read' }),
  }),
  data: Object.freeze({
    overview: () => invoke({ kind: 'data.overview' }),
    workflow: (workflowId: string) => invoke({ kind: 'data.workflow', workflowId }),
    version: (workflowId: string, versionId: string) =>
      invoke({ kind: 'data.version', workflowId, versionId }),
    run: (runId: string) => invoke({ kind: 'data.run', runId }),
  }),
  run: Object.freeze({
    start: (workflowId: string, input: unknown) => invoke({ kind: 'run.start', workflowId, input }),
    cancel: (runId: string) => invoke({ kind: 'run.cancel', runId }),
  }),
  // The notification carries nothing; the listener reads what it needs through the bridge.
  onChange: (listener: () => void) => {
    if (typeof listener !== 'function') return () => undefined;
    const handler = () => listener();
    ipcRenderer.on(CHANGE_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(CHANGE_CHANNEL, handler);
    };
  },
  setSamples: (enabled) => invoke({ kind: 'samples.set', enabled }),
  queryServer: (operation) => invoke({ kind: 'server.query', operation }),
  openDocumentation: () => invoke({ kind: 'desktop.openDocumentation' }),
};
if (!process.sandboxed || !process.contextIsolated)
  throw new Error('Unsafe renderer configuration');
contextBridge.exposeInMainWorld('shift', Object.freeze(bridge));
