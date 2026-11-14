import express, { type ErrorRequestHandler, type Response } from 'express';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Clock } from './domain/clock.js';
import { ShiftError, publicError } from './domain/errors.js';
import {
  protocolRange,
  serverVersion,
  validateServerInfo,
  validateServerHealth,
  validateProtocolError,
  validateShutdownAcknowledgement,
  validatePairResponse,
  validatePairingIssued,
  validateDeviceList,
  validateDeviceResponse,
  validateProjectResponse,
  validateProjectList,
  validateWorkflowResponse,
  validateWorkflowVersionResponse,
  validateWorkflowList,
  validateRunResponse,
  validateRunList,
  validateExecutionPage,
  validateRunVariables,
  validateArtifactList,
  validateCredentialList,
  validateGitHubAppList,
  validateGitHubAppResponse,
  validateGitHubConnectionResponse,
  validateGitHubDeliveryResponse,
  validateGitHubDeliveryPage,
  validateTriggerList,
  validateOccurrencePage,
  validateOccurrenceResponse,
  validateCredentialResponse,
  validateProjectPermissionsResponse,
  validateArtifactResponse,
  validateSessionList,
  validateSessionResponse,
  validateInvocationResponse,
  validateTranscriptPage,
  validateInteractionResponse,
  validateInteractionList,
  validateWorkspaceResponse,
  validateWorkspaceList,
  validateCommandReceiptResponse,
  validateEventPage,
  validateSnapshot,
  type ServerInfo,
  type ServerHealth,
  type ProtocolError,
} from './protocol/index.js';
import type { Store } from './persistence/store.js';
import type { ReadinessState } from './lifecycle/readiness.js';
import type { Actor, CommandReceipts, CommandResponse } from './persistence/receipts.js';
import type { DeviceService } from './devices/service.js';
import type { EventLog } from './events/log.js';
import type { EventStreams } from './events/streams.js';
import type { Device } from './devices/registry.js';
import type { Credentials } from './actions/credentials.js';
import type { GitHubIntegration } from './github/integration.js';
import type { GitHubWebhooks } from './github/webhooks.js';
import type { TriggerService } from './triggers/service.js';
import type { RunEngine } from './runs/engine.js';
import type { WorkspaceService } from './workspaces/service.js';
import type { DefinitionRepository } from './workflows/repository.js';
import type { DefinitionService } from './workflows/service.js';

const admin = '/api/v0/admin';
const cli = { kind: 'cli' as const, id: 'local' };

export function createHttpServer(options: {
  store: Store;
  clock: Clock;
  readiness: ReadinessState;
  logger: Logger;
  administrative: boolean;
  stop: () => void;
  engine?: RunEngine;
  definitions?: { service: DefinitionService; repository: DefinitionRepository };
  workspaces?: WorkspaceService;
  credentials?: Credentials;
  github?: GitHubIntegration;
  triggers?: TriggerService;
  webhooks?: GitHubWebhooks;
  devices?: DeviceService;
  receipts?: CommandReceipts;
  events?: { log: EventLog; streams: EventStreams };
}): Server {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.locals['requestId'] = requestId;
    res.set({
      'X-Request-ID': requestId,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    // Only run creation on the administrative socket accepts a (bounded JSON) body.
    // Administrative commands on the private socket accept a bounded JSON body; shutdown does not.
    // On TCP, only device commands take a body.
    const acceptsBody = options.administrative
      ? (req.method === 'POST' || req.method === 'PUT') &&
        req.path.startsWith(`${admin}/`) &&
        req.path !== `${admin}/shutdown`
      : (req.method === 'POST' || req.method === 'PUT') &&
        options.devices !== undefined &&
        req.path.startsWith('/api/v0/') &&
        !/^\/api\/v0\/(info|health|ready|admin(\/.*)?)$/.test(req.path);
    if (
      !acceptsBody &&
      (req.headers['transfer-encoding'] !== undefined ||
        (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0'))
    ) {
      next(new ShiftError('INVALID_REQUEST', 'This endpoint does not accept a request body.', 400));
      return;
    }
    next();
  });
  const health = (requestId: string): ServerHealth => {
    if (options.readiness.snapshot().ready) {
      try {
        options.store.check();
      } catch {
        options.readiness.persistenceFailed();
      }
    }
    const epochMs = options.clock.now();
    return {
      schemaVersion: 1,
      requestId,
      ...options.store.identity,
      protocol: protocolRange,
      liveness: 'alive',
      readiness: options.readiness.snapshot(),
      time: { epochMs, iso: new Date(epochMs).toISOString() },
    };
  };
  const sendHealth = (res: Response, readinessOnly: boolean) => {
    const payload = health(res.locals['requestId'] as string);
    if (!validateServerHealth(payload))
      throw new ShiftError('INTERNAL_ERROR', 'Invalid health response.');
    res.status(readinessOnly && !payload.readiness.ready ? 503 : 200).json(payload);
  };
  app.get('/api/v0/health', (_req, res) => sendHealth(res, false));
  app.get('/api/v0/ready', (_req, res) => sendHealth(res, true));
  app.get('/api/v0/info', (_req, res) => {
    const observedHealth = health(res.locals['requestId'] as string);
    const payload: ServerInfo = {
      schemaVersion: 1,
      requestId: observedHealth.requestId,
      ...options.store.identity,
      serverVersion,
      protocol: protocolRange,
      readiness: observedHealth.readiness,
      time: observedHealth.time,
      capabilities: {
        commands: options.engine !== undefined && options.devices !== undefined,
        events: options.events !== undefined && options.devices !== undefined,
        pairing: options.devices !== undefined,
        nodeTypes: [],
        harnesses: [],
      },
    };
    if (!validateServerInfo(payload))
      throw new ShiftError('INTERNAL_ERROR', 'Invalid server info response.');
    res.json(payload);
  });
  // Resources shared by the administrative socket and paired devices (specification 13.2). Each
  // route runs `guard` first: an Origin check on the socket, bearer authentication on TCP. Commands
  // are recorded for the caller's actor, and every response is checked against the shared schema.
  // A replayed receipt is answered as stored, because an older server may have written it.
  const resources = (
    guard: express.RequestHandler,
    actorOf: (res: Response) => Actor,
    requireCommandId: boolean,
  ): express.Router | null => {
    const engine = options.engine;
    if (!engine || !options.definitions) return null;
    const { service, repository } = options.definitions;
    const router = express.Router();
    const json = express.json({ limit: '2mb', strict: true });
    const id = (req: express.Request) => String(req.params['id']);
    const reply = (
      res: Response,
      status: number,
      body: Record<string, unknown>,
      validate: (value: unknown) => boolean,
    ) => {
      const payload = { schemaVersion: 1, requestId: res.locals['requestId'] as string, ...body };
      if (!validate(payload)) throw new ShiftError('INTERNAL_ERROR', 'Invalid response.');
      res.status(status).json(payload);
    };
    const command = (
      res: Response,
      response: CommandResponse,
      validate: (value: unknown) => boolean,
    ) =>
      reply(
        res,
        response.status,
        response.body as Record<string, unknown>,
        response.replayed ? () => true : validate,
      );
    // Devices must name every mutation, so a lost response can be looked up or resent.
    const body = (req: express.Request): unknown => {
      const value = req.body ?? {};
      if (
        requireCommandId &&
        typeof (value as { commandId?: unknown } | null)?.commandId !== 'string'
      ) {
        throw new ShiftError('INVALID_REQUEST', 'commandId is required.', 422, false, [
          '/commandId',
        ]);
      }
      return value;
    };
    const query = (req: express.Request, name: string) =>
      typeof req.query[name] === 'string' ? (req.query[name] as string) : undefined;
    const cursor = (req: express.Request, name: string, max: number) => {
      const value = query(req, name);
      if (value === undefined) return undefined;
      if (!/^[1-9][0-9]{0,15}$/.test(value) || Number(value) > max)
        throw new ShiftError('INVALID_REQUEST', `Invalid ${name}.`, 422, false, [`/${name}`]);
      return Number(value);
    };
    router.post('/projects', guard, json, async (req, res) => {
      command(res, await service.addProject(body(req), actorOf(res)), validateProjectResponse);
    });
    router.get('/projects', guard, (_req, res) => {
      reply(res, 200, { projects: repository.projects() }, validateProjectList);
    });
    const credentials = options.credentials;
    if (credentials) {
      // Credential values are write-only: listings and responses carry names and revisions.
      router.get('/projects/:id/credentials', guard, (req, res) => {
        reply(res, 200, { credentials: credentials.list(id(req)) }, validateCredentialList);
      });
      router.post('/projects/:id/credentials', guard, json, (req, res) => {
        command(res, credentials.put(id(req), body(req), actorOf(res)), validateCredentialResponse);
      });
      router.post('/projects/:id/credentials/:credentialId/revoke', guard, json, (req, res) => {
        command(
          res,
          credentials.revoke(id(req), String(req.params['credentialId']), body(req), actorOf(res)),
          validateCredentialResponse,
        );
      });
      router.get('/projects/:id/permissions', guard, (req, res) => {
        reply(
          res,
          200,
          { permissions: { projectId: id(req), denied: credentials.denied(id(req)) } },
          validateProjectPermissionsResponse,
        );
      });
      router.post('/projects/:id/permissions', guard, json, (req, res) => {
        command(
          res,
          credentials.setPermissions(id(req), body(req), actorOf(res)),
          validateProjectPermissionsResponse,
        );
      });
    }
    const github = options.github;
    if (github) {
      // The owner's App: secret inputs are write-only; responses say configured or missing.
      router.get('/github/apps', guard, (_req, res) => {
        reply(res, 200, { apps: github.apps() }, validateGitHubAppList);
      });
      router.post('/github/apps', guard, json, async (req, res) => {
        command(res, await github.register(body(req), actorOf(res)), validateGitHubAppResponse);
      });
      router.post('/github/apps/:appId/rotate', guard, json, async (req, res) => {
        command(
          res,
          await github.rotate(String(req.params['appId']), body(req), actorOf(res)),
          validateGitHubAppResponse,
        );
      });
      router.post('/github/apps/:appId/refresh', guard, json, async (req, res) => {
        reply(
          res,
          200,
          { app: await github.refresh(String(req.params['appId'])) },
          validateGitHubAppResponse,
        );
      });
      router.get('/projects/:id/github', guard, (req, res) => {
        reply(
          res,
          200,
          { connection: github.connection(id(req)) },
          validateGitHubConnectionResponse,
        );
      });
      router.post('/projects/:id/github', guard, json, async (req, res) => {
        command(
          res,
          await github.connect(id(req), body(req), actorOf(res)),
          validateGitHubConnectionResponse,
        );
      });
      router.post('/projects/:id/github/verify', guard, json, async (req, res) => {
        reply(
          res,
          200,
          { connection: await github.verify(id(req)) },
          validateGitHubConnectionResponse,
        );
      });
      router.post('/projects/:id/github/disconnect', guard, json, (req, res) => {
        command(
          res,
          github.disconnect(id(req), body(req), actorOf(res)),
          validateGitHubConnectionResponse,
        );
      });
      const webhooks = options.webhooks;
      if (webhooks)
        router.get('/github/apps/:appId/deliveries', guard, (req, res) => {
          const before = cursor(req, 'before', Number.MAX_SAFE_INTEGER);
          const limit = cursor(req, 'limit', 200);
          const page = webhooks.deliveries(String(req.params['appId']), {
            ...(before ? { before } : {}),
            ...(limit ? { limit } : {}),
          });
          reply(res, 200, page, validateGitHubDeliveryPage);
        });
    }
    const triggers = options.triggers;
    if (triggers) {
      router.get('/workflows/:id/triggers', guard, (req, res) => {
        reply(res, 200, { triggers: triggers.triggers(id(req)) }, validateTriggerList);
      });
      router.get('/occurrences', guard, (req, res) => {
        const workflowId = query(req, 'workflowId');
        const triggerId = query(req, 'triggerId');
        const before = cursor(req, 'before', Number.MAX_SAFE_INTEGER);
        const limit = cursor(req, 'limit', 200);
        reply(
          res,
          200,
          triggers.occurrences({
            ...(workflowId ? { workflowId } : {}),
            ...(triggerId ? { triggerId } : {}),
            ...(before ? { before } : {}),
            ...(limit ? { limit } : {}),
          }),
          validateOccurrencePage,
        );
      });
      router.get('/occurrences/:id', guard, (req, res) => {
        reply(res, 200, { occurrence: triggers.occurrence(id(req)) }, validateOccurrenceResponse);
      });
    }
    router.post('/workflows', guard, json, (req, res) => {
      command(res, service.createWorkflow(body(req), actorOf(res)), validateWorkflowResponse);
    });
    router.get('/workflows', guard, (req, res) => {
      reply(
        res,
        200,
        { workflows: repository.workflows(query(req, 'projectId')) },
        validateWorkflowList,
      );
    });
    router.get('/workflows/:id', guard, (req, res) => {
      reply(res, 200, { workflow: repository.workflow(id(req)) }, validateWorkflowResponse);
    });
    // A published version's frozen document, so a run can be shown as it was started.
    router.get('/workflows/:id/versions/:versionId', guard, (req, res) => {
      const version = repository.version(String(req.params['versionId']));
      if (version.workflowId !== id(req))
        throw new ShiftError('NOT_FOUND', 'Workflow version not found.', 404);
      const { workflowId, number, hash, createdAt, document } = version;
      reply(
        res,
        200,
        { version: { id: version.id, workflowId, number, hash, createdAt, document } },
        validateWorkflowVersionResponse,
      );
    });
    router.put('/workflows/:id/draft', guard, json, (req, res) => {
      command(res, service.saveDraft(id(req), body(req), actorOf(res)), validateWorkflowResponse);
    });
    router.post('/workflows/:id/publish', guard, json, (req, res) => {
      command(res, service.publish(id(req), body(req), actorOf(res)), validateWorkflowResponse);
    });
    for (const [path, enabled] of [
      ['pause', false],
      ['unpause', true],
    ] as const)
      router.post(`/workflows/:id/${path}`, guard, json, (req, res) => {
        command(
          res,
          service.setEnabled(id(req), enabled, body(req), actorOf(res)),
          validateWorkflowResponse,
        );
      });
    router.post('/runs', guard, json, async (req, res) => {
      command(res, await engine.startRun(body(req), actorOf(res)), validateRunResponse);
    });
    router.get('/runs', guard, (_req, res) => {
      reply(res, 200, { runs: engine.repository.runs() }, validateRunList);
    });
    router.get('/runs/:id', guard, (req, res) => {
      reply(res, 200, { run: engine.repository.run(id(req)) }, validateRunResponse);
    });
    // A page of a run's history: `after` is a sequence number, `limit` at most 500.
    router.get('/runs/:id/executions', guard, (req, res) => {
      const number = (name: string, fallback: number, min: number, max: number) => {
        const raw = req.query[name];
        if (raw === undefined) return fallback;
        const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
        if (!(value >= min && value <= max)) {
          throw new ShiftError('INVALID_REQUEST', `Invalid ${name}.`, 422, false, [`/${name}`]);
        }
        return value;
      };
      reply(
        res,
        200,
        engine.repository.executions(
          id(req),
          number('after', 0, 0, Number.MAX_SAFE_INTEGER),
          number('limit', 100, 1, 500),
        ) as Record<string, unknown>,
        validateExecutionPage,
      );
    });
    // A run's variables now, and every revision with the execution that wrote it.
    router.get('/runs/:id/variables', guard, (req, res) => {
      reply(
        res,
        200,
        engine.repository.variableHistory(id(req)) as Record<string, unknown>,
        validateRunVariables,
      );
    });
    // Reports and other immutable artifacts: metadata by run or ID, bytes by authenticated download.
    router.get('/runs/:id/artifacts', guard, (req, res) => {
      reply(
        res,
        200,
        { artifacts: engine.repository.artifacts({ runId: id(req) }) },
        validateArtifactList,
      );
    });
    router.get('/artifacts/:id', guard, (req, res) => {
      const { storageKey: _key, ...artifact } = engine.repository.artifact(id(req));
      reply(res, 200, { artifact }, validateArtifactResponse);
    });
    // Agent sessions: a project's, or all, newest first; one with its executions and invocations.
    router.get('/sessions', guard, (req, res) => {
      reply(
        res,
        200,
        { sessions: engine.repository.sessions(query(req, 'projectId')) },
        validateSessionList,
      );
    });
    router.get('/sessions/:id', guard, (req, res) => {
      reply(
        res,
        200,
        { session: engine.repository.sessionDetail(id(req)) },
        validateSessionResponse,
      );
    });
    // An owner's goal for a session: answered once recorded, then run by the server.
    router.post('/sessions/:id/goals', guard, json, (req, res) => {
      command(res, engine.sendGoal(id(req), body(req), actorOf(res)), validateInvocationResponse);
    });
    // A session's normalized conversation: `after` is a position, `limit` at most 500.
    router.get('/sessions/:id/transcript', guard, (req, res) => {
      const after = query(req, 'after') ?? '0';
      const limit = query(req, 'limit') ?? '200';
      if (!/^\d+$/.test(after) || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 500)
        throw new ShiftError('INVALID_REQUEST', 'Invalid after or limit.', 422);
      reply(
        res,
        200,
        engine.repository.transcript(id(req), Number(after), Number(limit)) as Record<
          string,
          unknown
        >,
        validateTranscriptPage,
      );
    });
    router.get('/invocations/:id', guard, (req, res) => {
      reply(
        res,
        200,
        { invocation: engine.repository.invocationDetail(id(req)) },
        validateInvocationResponse,
      );
    });
    router.get('/artifacts/:id/content', guard, async (req, res) => {
      const artifact = engine.repository.artifact(id(req));
      const stream = await engine.blobs.read(artifact.storageKey);
      if (!stream)
        throw new ShiftError('ARTIFACT_BYTES_MISSING', 'The artifact’s bytes are missing.', 410);
      res.status(200);
      res.setHeader('Content-Type', artifact.mediaType);
      res.setHeader('Content-Length', String(artifact.sizeBytes));
      res.setHeader('ETag', `"${artifact.sha256}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${artifact.filename.replace(/[^\w.-]/g, '_')}"`,
      );
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });
    for (const kind of ['cancel', 'retry', 'fail', 'complete', 'extend'] as const) {
      router.post(`/runs/:id/${kind}`, guard, json, (req, res) => {
        command(
          res,
          engine.controlRun(id(req), kind, body(req), actorOf(res)),
          validateRunResponse,
        );
      });
    }
    router.get('/interactions', guard, (req, res) => {
      reply(
        res,
        200,
        { interactions: engine.repository.interactions(req.query['all'] === 'true') },
        validateInteractionList,
      );
    });
    router.get('/interactions/:id', guard, (req, res) => {
      reply(
        res,
        200,
        { interaction: engine.repository.interaction(id(req)) },
        validateInteractionResponse,
      );
    });
    router.post('/interactions/:id/respond', guard, json, (req, res) => {
      command(res, engine.respond(id(req), body(req), actorOf(res)), validateInteractionResponse);
    });
    const workspaces = options.workspaces;
    if (workspaces) {
      router.get('/workspaces', guard, (req, res) => {
        reply(
          res,
          200,
          { workspaces: workspaces.workspaces.list(query(req, 'projectId')) },
          validateWorkspaceList,
        );
      });
      router.get('/workspaces/:id', guard, (req, res) => {
        reply(
          res,
          200,
          { workspace: workspaces.workspaces.get(id(req)) },
          validateWorkspaceResponse,
        );
      });
      router.post('/workspaces/:id/remove', guard, json, async (req, res) => {
        command(
          res,
          await workspaces.remove(id(req), body(req), actorOf(res)),
          validateWorkspaceResponse,
        );
      });
    }
    const events = options.events;
    if (events) {
      // Durable history after a cursor; without one, from the beginning.
      router.get('/events', guard, (req, res) => {
        const raw = query(req, 'limit');
        const limit = raw === undefined ? 100 : /^\d+$/.test(raw) ? Number(raw) : NaN;
        if (!(limit >= 1 && limit <= 1000)) {
          throw new ShiftError('INVALID_REQUEST', 'Invalid limit.', 422, false, ['/limit']);
        }
        const after = query(req, 'after');
        reply(
          res,
          200,
          events.log.page(after === undefined ? 0 : events.log.parse(after), limit),
          validateEventPage,
        );
      });
      // Current state with the cursor to stream from, read together.
      router.get('/snapshot', guard, (_req, res) => {
        reply(
          res,
          200,
          events.log.snapshot(() => ({
            projects: repository.projects(),
            workflows: repository.workflows(),
            runs: engine.repository.runs(),
            interactions: engine.repository.interactions(),
          })),
          validateSnapshot,
        );
      });
      // The cursor is checked before the stream opens, so a stale one gets a plain 409.
      router.get('/events/stream', guard, (req, res) => {
        const header = req.headers['last-event-id'];
        const after = events.log.parse(typeof header === 'string' ? header : query(req, 'after'));
        const device = res.locals['device'] as Device | undefined;
        events.streams.open(res, after, device?.id ?? null);
      });
    }
    // The caller's own receipt after a lost response; another actor's receipt does not exist.
    router.get('/commands/:commandId', guard, (req, res) => {
      reply(
        res,
        200,
        {
          receipt: options.receipts!.get(actorOf(res), String(req.params['commandId'])),
        },
        validateCommandReceiptResponse,
      );
    });
    return router;
  };
  if (options.administrative) {
    const local: express.RequestHandler = (req, _res, next) => {
      if (req.headers.origin !== undefined) {
        next(
          new ShiftError('INVALID_REQUEST', 'Browser-origin administration is unavailable.', 403),
        );
        return;
      }
      next();
    };
    const router = resources(local, () => cli, false);
    if (router) app.use(admin, router);
  }
  if (options.administrative) {
    app.post('/api/v0/admin/shutdown', (req, res) => {
      if (req.headers.origin !== undefined)
        throw new ShiftError(
          'INVALID_REQUEST',
          'Browser-origin administration is unavailable.',
          403,
        );
      const payload = {
        schemaVersion: 1,
        requestId: res.locals['requestId'] as string,
        accepted: true,
      };
      if (!validateShutdownAcknowledgement(payload))
        throw new ShiftError('INTERNAL_ERROR', 'Invalid administrative response.');
      res.once('finish', options.stop);
      res.status(202).json(payload);
    });
  }
  // Paired devices (specification 13.1). Every TCP route but pairing itself needs a bearer token.
  const devices = options.devices;
  if (devices) {
    const small = express.json({ limit: '16kb', strict: true });
    const send = <T>(
      res: Response,
      status: number,
      body: Record<string, unknown>,
      validate: (value: unknown) => value is T,
    ) => {
      const payload = { schemaVersion: 1, requestId: res.locals['requestId'] as string, ...body };
      if (!validate(payload)) throw new ShiftError('INTERNAL_ERROR', 'Invalid device response.');
      res.status(status).json(payload);
    };
    if (options.administrative) {
      const local = (req: express.Request) => {
        if (req.headers.origin !== undefined)
          throw new ShiftError(
            'INVALID_REQUEST',
            'Browser-origin administration is unavailable.',
            403,
          );
      };
      app.post(`${admin}/pairing`, (req, res) => {
        local(req);
        send(res, 201, { pairing: devices.issue(cli) }, validatePairingIssued);
      });
      app.get(`${admin}/devices`, (req, res) => {
        local(req);
        res.json({
          schemaVersion: 1,
          requestId: res.locals['requestId'],
          devices: devices.registry.list(),
        });
      });
      app.post(`${admin}/devices/:id/revoke`, express.json({ limit: '16kb' }), (req, res) => {
        local(req);
        const response = devices.revoke(String(req.params['id']), cli, req.body ?? {});
        send(
          res,
          response.status,
          response.body as Record<string, unknown>,
          validateDeviceResponse,
        );
      });
    } else {
      app.post('/api/v0/pair', small, (req, res) => {
        const paired = devices.pair(req.body, req.socket.remoteAddress ?? 'unknown');
        send(res, 201, paired, validatePairResponse);
      });
      const authenticated: express.RequestHandler = (req, res, next) => {
        const header = req.headers.authorization ?? '';
        const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
        const device = match ? devices.registry.authenticate(match[1]!) : null;
        if (!device) {
          next(new ShiftError('DEVICE_UNAUTHORIZED', 'A valid device token is required.', 401));
          return;
        }
        res.locals['device'] = device;
        next();
      };
      const caller = (res: Response) => ({
        kind: 'device' as const,
        id: (res.locals['device'] as Device).id,
      });
      // GitHub signs its deliveries; the raw body is what the signature covers.
      const webhooks = options.webhooks;
      if (webhooks)
        app.post(
          '/api/v0/github/apps/:id/webhook',
          express.raw({ type: () => true, limit: '2mb' }),
          async (req, res) => {
            const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
            const result = await webhooks.receive(String(req.params['id']), req.headers, body);
            send(
              res,
              result.status,
              { delivery: result.delivery, duplicate: result.duplicate },
              validateGitHubDeliveryResponse,
            );
          },
        );
      const deviceResources = resources(authenticated, caller, true);
      if (deviceResources) app.use('/api/v0', deviceResources);
      app.get('/api/v0/devices', authenticated, (_req, res) => {
        send(
          res,
          200,
          { devices: devices.registry.list(), currentDeviceId: caller(res).id },
          validateDeviceList,
        );
      });
      app.post('/api/v0/devices/:id/revoke', authenticated, small, (req, res) => {
        const response = devices.revoke(String(req.params['id']), caller(res), req.body ?? {});
        send(
          res,
          response.status,
          response.body as Record<string, unknown>,
          validateDeviceResponse,
        );
      });
      app.post('/api/v0/pairing', authenticated, (_req, res) => {
        send(res, 201, { pairing: devices.issue(caller(res)) }, validatePairingIssued);
      });
    }
  }
  app.use((_req, _res, next) => next(new ShiftError('NOT_FOUND', 'Endpoint not found.', 404)));
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const bodyError = (error as { type?: unknown } | null)?.type;
    const safe =
      bodyError === 'entity.too.large'
        ? new ShiftError('REQUEST_TOO_LARGE', 'The request body is too large.', 413)
        : bodyError === 'entity.parse.failed'
          ? new ShiftError('INVALID_REQUEST', 'The request body is not valid JSON.', 400)
          : publicError(error);
    const requestId = res.locals['requestId'] as string;
    options.logger.warn({ code: safe.code, requestId }, 'Request rejected.');
    const payload: ProtocolError = {
      schemaVersion: 1,
      requestId,
      code: safe.code,
      message: safe.message,
      retryable: safe.retryable,
      diagnostics: safe.fields.slice(0, 32).map((field) => ({
        field: field.slice(0, 256),
        message: safe.fieldMessages[field]?.slice(0, 500) ?? 'Invalid field.',
      })),
    };
    if (!validateProtocolError(payload)) {
      res.status(500).end();
      return;
    }
    if (safe.code === 'DEVICE_UNAUTHORIZED') res.set('WWW-Authenticate', 'Bearer');
    res.status(safe.status).json(payload);
  };
  app.use(errorHandler);
  const server = createServer(
    {
      maxHeaderSize: 16 * 1024,
      requestTimeout: 10000,
      headersTimeout: 10000,
      keepAliveTimeout: 1000,
    },
    app,
  );
  server.maxHeadersCount = 64;
  return server;
}
