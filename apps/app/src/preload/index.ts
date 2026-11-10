import { contextBridge, ipcRenderer } from 'electron';
import {
  CHANGE_CHANNEL,
  IPC_CHANNEL,
  parseRequest,
  parseResponse,
  type Answer,
  type DesktopBridge,
  type DesktopRequest,
  type DesktopResponse,
  type Preferences,
  type RunControl,
} from '../shared/contracts.js';
import { validInteractions } from '../shared/interactions.js';
import {
  validateArtifactList,
  validateCredentialList,
  validateGitHubAppList,
  validateGitHubConnectionResponse,
  validateProjectPermissionsResponse,
  validateArtifactResponse,
  validateDeviceList,
  validateRunResponse,
  validateSessionList,
  validateSessionResponse,
  validateTranscriptPage,
  validateServerHealth,
  validateServerInfo,
  validateWorkflowResponse,
  validateWorkflowVersionResponse,
} from '../protocol/generated/validators.js';

const resourceValidators = {
  workflow: validateWorkflowResponse,
  version: validateWorkflowVersionResponse,
  run: validateRunResponse,
  sessions: validateSessionList,
  session: validateSessionResponse,
  transcript: validateTranscriptPage,
  artifacts: validateArtifactList,
  credentials: validateCredentialList,
  permissions: validateProjectPermissionsResponse,
  github: validateGitHubConnectionResponse,
  githubApps: validateGitHubAppList,
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
    (response.kind === 'resource' && !resourceValidators[response.resource](response.value)) ||
    (response.kind === 'interactions' && !validInteractions(response.value)) ||
    (response.kind === 'devices' && !validateDeviceList(response.value)) ||
    (response.kind === 'report' &&
      !validateArtifactResponse({
        schemaVersion: 1,
        requestId: '00000000-0000-4000-8000-000000000000',
        artifact: response.artifact,
      }))
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
    devices: () => invoke({ kind: 'data.devices' }),
    sessions: (projectId: string) => invoke({ kind: 'data.sessions', projectId }),
    session: (sessionId: string) => invoke({ kind: 'data.session', sessionId }),
    transcript: (sessionId: string, after?: number) =>
      invoke({
        kind: 'data.transcript',
        sessionId,
        ...(after === undefined ? {} : { after }),
      } as DesktopRequest),
    artifacts: (runId: string) => invoke({ kind: 'data.artifacts', runId }),
    report: (artifactId: string) => invoke({ kind: 'data.report', artifactId }),
    credentials: (projectId: string) => invoke({ kind: 'data.credentials', projectId }),
    permissions: (projectId: string) => invoke({ kind: 'data.permissions', projectId }),
    github: (projectId: string) => invoke({ kind: 'data.github', projectId }),
    githubApps: () => invoke({ kind: 'data.githubApps' }),
  }),
  github: Object.freeze({
    register: (input: {
      appId: number;
      host?: string;
      privateKey: string;
      webhookSecret?: string;
    }) =>
      invoke({
        kind: 'github.register',
        appId: input?.appId,
        privateKey: input?.privateKey,
        ...(input?.host === undefined ? {} : { host: input.host }),
        ...(input?.webhookSecret === undefined ? {} : { webhookSecret: input.webhookSecret }),
      } as DesktopRequest),
    rotate: (appId: string, input: { privateKey?: string; webhookSecret?: string }) =>
      invoke({
        kind: 'github.rotate',
        appId,
        ...(input?.privateKey === undefined ? {} : { privateKey: input.privateKey }),
        ...(input?.webhookSecret === undefined ? {} : { webhookSecret: input.webhookSecret }),
      } as DesktopRequest),
    refresh: (appId: string) => invoke({ kind: 'github.refresh', appId }),
    connect: (projectId: string, installationId: string, repositoryId: number) =>
      invoke({ kind: 'github.connect', projectId, installationId, repositoryId }),
    verify: (projectId: string) => invoke({ kind: 'github.verify', projectId }),
    disconnect: (projectId: string) => invoke({ kind: 'github.disconnect', projectId }),
  }),
  credential: Object.freeze({
    put: (projectId: string, name: string, value: string) =>
      invoke({ kind: 'credential.put', projectId, name, value }),
    revoke: (projectId: string, credentialId: string) =>
      invoke({ kind: 'credential.revoke', projectId, credentialId }),
  }),
  session: Object.freeze({
    goal: (sessionId: string, goal: string) => invoke({ kind: 'session.goal', sessionId, goal }),
  }),
  run: Object.freeze({
    start: (workflowId: string, input: unknown) => invoke({ kind: 'run.start', workflowId, input }),
    cancel: (runId: string) => invoke({ kind: 'run.cancel', runId }),
    control: (runId: string, control: RunControl) =>
      invoke({ kind: 'run.control', runId, control }),
  }),
  interaction: Object.freeze({
    list: () => invoke({ kind: 'data.interactions' }),
    respond: (interactionId: string, answer: Answer) =>
      invoke({
        kind: 'interaction.respond',
        interactionId,
        revision: answer?.revision,
        ...(answer?.decision === undefined ? {} : { decision: answer.decision }),
        response: answer?.response,
      } as DesktopRequest),
  }),
  workflow: Object.freeze({
    save: (workflowId: string, revision: number, draft: Record<string, unknown>) =>
      invoke({ kind: 'workflow.save', workflowId, revision, draft }),
    publish: (workflowId: string, revision: number) =>
      invoke({ kind: 'workflow.publish', workflowId, revision }),
    create: (projectId: string, name: string) =>
      invoke({ kind: 'workflow.create', projectId, name }),
  }),
  recovery: Object.freeze({
    list: () => invoke({ kind: 'recovery.list' }),
    keep: (workflowId: string, revision: number, draft: Record<string, unknown>) =>
      invoke({ kind: 'recovery.keep', workflowId, revision, draft }),
    forget: (workflowId: string) => invoke({ kind: 'recovery.forget', workflowId }),
  }),
  project: Object.freeze({
    create: (path: string) => invoke({ kind: 'project.create', path }),
    permissions: (projectId: string, allow: string[], deny: string[]) =>
      invoke({ kind: 'project.permissions', projectId, allow, deny } as DesktopRequest),
  }),
  device: Object.freeze({
    revoke: (deviceId: string) => invoke({ kind: 'device.revoke', deviceId }),
  }),
  preferences: Object.freeze({
    read: () => invoke({ kind: 'preferences.read' }),
    set: (preferences: Preferences) => invoke({ kind: 'preferences.set', preferences }),
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
