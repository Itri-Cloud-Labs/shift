import { ClientCore, ClientFailure, validFoundationResponse } from '../client-core/runtime.js';
import {
  validateArtifactList,
  validateArtifactResponse,
  validateDeviceList,
  validateRunResponse,
  validateSessionList,
  validateSessionResponse,
  validateTranscriptPage,
  validateWorkflowResponse,
  validateWorkflowVersionResponse,
} from '../protocol/generated/validators.js';
import {
  parseRequest,
  parseResponse,
  type ConnectionView,
  type DesktopResponse,
  type ResourceKind,
  type SyncView,
} from '../shared/contracts.js';
import { validInteractions } from '../shared/interactions.js';
import {
  DOCUMENTATION_URL,
  validExternalLink,
  validSender,
  type SenderContext,
} from './security.js';

// The renderer's view of the connection: state and public profile fields only.
async function connectionView(core: ClientCore): Promise<ConnectionView> {
  const { connection } = core;
  const state = connection.state;
  return {
    status: state.status,
    profileId: state.profileId,
    problem: state.problem,
    pairingPending: state.pairingPending,
    credentialStorage: connection.credentialStorage,
    profiles: await connection.profiles(),
  };
}

function syncView(core: ClientCore): SyncView {
  const { sync } = core;
  const state = sync.state;
  const projection = sync.projection;
  return {
    status: state.status,
    problem: state.problem,
    updatedAt: state.updatedAt,
    cached: projection && {
      projects: projection.projects.length,
      workflows: projection.workflows.length,
      runs: projection.runs.length,
      interactions: projection.interactions.length,
    },
    commands: sync.commands(),
  };
}

// A new workflow opens with the one node every workflow has.
const startingDraft = {
  nodes: [{ id: 'start', type: 'manual_trigger', position: { x: 80, y: 240 } }],
  connections: [],
};

const created = (resource: unknown): { createdId?: string } => {
  const id = (resource as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' ? { createdId: id } : {};
};

export function validResource(kind: ResourceKind, value: unknown): boolean {
  switch (kind) {
    case 'workflow':
      return validateWorkflowResponse(value);
    case 'version':
      return validateWorkflowVersionResponse(value);
    case 'run':
      return validateRunResponse(value);
    case 'sessions':
      return validateSessionList(value);
    case 'session':
      return validateSessionResponse(value);
    case 'transcript':
      return validateTranscriptPage(value);
    case 'artifacts':
      return validateArtifactList(value);
  }
}

export async function dispatch(
  core: ClientCore,
  sender: SenderContext,
  value: unknown,
  openExternal: (url: string) => Promise<void>,
): Promise<DesktopResponse> {
  if (!validSender(sender))
    return {
      kind: 'error',
      code: 'FORBIDDEN',
      message: 'This frame cannot use the desktop bridge.',
    };
  const request = parseRequest(value);
  if (!request)
    return { kind: 'error', code: 'INVALID_REQUEST', message: 'The desktop request is invalid.' };
  let response: DesktopResponse;
  try {
    switch (request.kind) {
      case 'shell.read':
        response = { kind: 'shell', state: core.shell() };
        break;
      case 'connection.read':
        response = { kind: 'connection', connection: await connectionView(core) };
        break;
      case 'connection.pair':
        await core.connection.pair({
          url: request.url,
          phrase: request.phrase,
          deviceName: request.deviceName,
        });
        response = { kind: 'connection', connection: await connectionView(core) };
        break;
      case 'connection.abandonPairing':
        core.connection.abandonPairing();
        response = { kind: 'connection', connection: await connectionView(core) };
        break;
      case 'connection.connect':
        await core.connection.connect(request.profileId);
        response = { kind: 'connection', connection: await connectionView(core) };
        break;
      case 'connection.changeAddress':
        await core.connection.changeAddress(request.profileId, request.url);
        response = { kind: 'connection', connection: await connectionView(core) };
        break;
      case 'connection.clear':
        await core.connection.clear(request.profileId);
        // The cached server state and kept edits go with the profile.
        await core.sync.forget(request.profileId);
        await core.recovery.clear(request.profileId);
        response = { kind: 'connection', connection: await connectionView(core) };
        break;
      case 'sync.read':
        response = { kind: 'sync', sync: syncView(core) };
        break;
      case 'data.overview':
        response = { kind: 'overview', overview: core.overview() };
        break;
      case 'data.workflow':
      case 'data.version':
      case 'data.run': {
        const kind =
          request.kind === 'data.workflow'
            ? 'workflow'
            : request.kind === 'data.version'
              ? 'version'
              : 'run';
        const path =
          request.kind === 'data.workflow'
            ? `/api/v0/workflows/${request.workflowId}`
            : request.kind === 'data.version'
              ? `/api/v0/workflows/${request.workflowId}/versions/${request.versionId}`
              : `/api/v0/runs/${request.runId}`;
        const read = await core.resource(kind, path);
        response = { kind: 'resource', resource: kind, ...read };
        break;
      }
      case 'data.sessions':
      case 'data.session':
      case 'data.transcript':
      case 'data.artifacts': {
        const [kind, path] =
          request.kind === 'data.sessions'
            ? (['sessions', `/api/v0/sessions?projectId=${request.projectId}`] as const)
            : request.kind === 'data.session'
              ? (['session', `/api/v0/sessions/${request.sessionId}`] as const)
              : request.kind === 'data.transcript'
                ? ([
                    'transcript',
                    `/api/v0/sessions/${request.sessionId}/transcript?after=${request.after ?? 0}&limit=500`,
                  ] as const)
                : (['artifacts', `/api/v0/runs/${request.runId}/artifacts`] as const);
        const read = await core.resource(kind, path);
        response = { kind: 'resource', resource: kind, ...read };
        break;
      }
      case 'data.report':
        response = { kind: 'report', ...(await core.report(request.artifactId)) };
        break;
      case 'session.goal': {
        const { command } = await core.command(
          'POST',
          `/api/v0/sessions/${request.sessionId}/goals`,
          { goal: request.goal },
        );
        response = { kind: 'command', command, runId: null };
        break;
      }
      case 'run.start':
      case 'run.cancel': {
        const { command, response: answer } =
          request.kind === 'run.start'
            ? await core.command('POST', '/api/v0/runs', {
                workflowId: request.workflowId,
                input: request.input,
              })
            : await core.command('POST', `/api/v0/runs/${request.runId}/cancel`, {});
        const run = (answer as { run?: { id?: unknown } } | null)?.run;
        response = {
          kind: 'command',
          command,
          runId: typeof run?.id === 'string' ? run.id : null,
        };
        break;
      }
      case 'run.control': {
        const { kind, ...body } = request.control;
        const { command } = await core.command(
          'POST',
          `/api/v0/runs/${request.runId}/${kind}`,
          body,
        );
        response = { kind: 'command', command, runId: request.runId };
        break;
      }
      case 'data.interactions':
        response = { kind: 'interactions', value: { interactions: core.interactions() } };
        break;
      case 'interaction.respond': {
        const { command } = await core.command(
          'POST',
          `/api/v0/interactions/${request.interactionId}/respond`,
          {
            revision: request.revision,
            ...(request.decision === undefined ? {} : { decision: request.decision }),
            response: request.response,
          },
        );
        response = { kind: 'command', command, runId: null };
        break;
      }
      case 'workflow.save': {
        const { command } = await core.command(
          'PUT',
          `/api/v0/workflows/${request.workflowId}/draft`,
          { revision: request.revision, draft: request.draft },
        );
        response = { kind: 'command', command, runId: null };
        break;
      }
      case 'workflow.publish': {
        const { command } = await core.command(
          'POST',
          `/api/v0/workflows/${request.workflowId}/publish`,
          { revision: request.revision },
        );
        response = { kind: 'command', command, runId: null };
        break;
      }
      case 'project.create': {
        const { command, response: answer } = await core.command('POST', '/api/v0/projects', {
          path: request.path,
        });
        response = {
          kind: 'command',
          command,
          runId: null,
          ...created((answer as { project?: unknown } | null)?.project),
        };
        break;
      }
      case 'workflow.create': {
        const { command, response: answer } = await core.command('POST', '/api/v0/workflows', {
          projectId: request.projectId,
          name: request.name,
          draft: startingDraft,
        });
        response = {
          kind: 'command',
          command,
          runId: null,
          ...created((answer as { workflow?: unknown } | null)?.workflow),
        };
        break;
      }
      case 'recovery.list':
      case 'recovery.keep':
      case 'recovery.forget': {
        const profileId = core.connection.state.profileId;
        if (!profileId) throw new ClientFailure('DISCONNECTED');
        if (request.kind === 'recovery.list') {
          response = { kind: 'recovery', drafts: await core.recovery.list(profileId) };
          break;
        }
        if (request.kind === 'recovery.keep')
          await core.recovery.keep(profileId, request.workflowId, request.revision, request.draft);
        else await core.recovery.forget(profileId, request.workflowId);
        response = { kind: 'kept' };
        break;
      }
      case 'data.devices':
        response = { kind: 'devices', value: await core.devices() };
        break;
      case 'device.revoke': {
        const { command } = await core.command(
          'POST',
          `/api/v0/devices/${request.deviceId}/revoke`,
          {},
        );
        response = { kind: 'command', command, runId: null };
        break;
      }
      case 'preferences.read':
        response = { kind: 'preferences', preferences: core.preferences.value };
        break;
      case 'preferences.set':
        await core.preferences.set(request.preferences);
        response = { kind: 'preferences', preferences: core.preferences.value };
        break;
      case 'samples.set':
        response = { kind: 'shell', state: core.setSamples(request.enabled) };
        break;
      case 'server.query':
        response = {
          kind: 'server',
          operation: request.operation,
          value: await core.query(request.operation),
        };
        break;
      case 'desktop.openDocumentation':
        if (!validExternalLink(DOCUMENTATION_URL)) throw new Error('Invalid link');
        await openExternal(DOCUMENTATION_URL);
        response = { kind: 'opened' };
        break;
    }
    if (
      !parseResponse(response) ||
      (response.kind === 'server' &&
        !validFoundationResponse(response.operation, response.value)) ||
      (response.kind === 'resource' && !validResource(response.resource, response.value)) ||
      (response.kind === 'interactions' && !validInteractions(response.value)) ||
      (response.kind === 'devices' && !validateDeviceList(response.value)) ||
      (response.kind === 'report' &&
        !validateArtifactResponse({
          schemaVersion: 1,
          requestId: '00000000-0000-4000-8000-000000000000',
          artifact: response.artifact,
        }))
    ) {
      return {
        kind: 'error',
        code: 'INVALID_RESPONSE',
        message: 'The server response is invalid.',
      };
    }
    return response;
  } catch (error) {
    if (error instanceof ClientFailure)
      return {
        kind: 'error',
        code: error.code,
        message:
          error.code === 'DISCONNECTED'
            ? 'Connect to a server before querying it.'
            : error.code === 'NOT_FOUND'
              ? 'The resource was not found.'
              : 'The server response is invalid.',
      };
    return { kind: 'error', code: 'UNAVAILABLE', message: 'The desktop operation is unavailable.' };
  }
}
