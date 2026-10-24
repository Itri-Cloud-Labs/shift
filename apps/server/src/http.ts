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
  type ServerInfo,
  type ServerHealth,
  type ProtocolError,
} from './protocol/index.js';
import type { Store } from './persistence/store.js';
import type { ReadinessState } from './lifecycle/readiness.js';
import type { CommandResponse } from './persistence/receipts.js';
import type { RunEngine } from './runs/engine.js';
import type { WorkspaceService } from './workspaces/service.js';
import type { DefinitionRepository } from './workflows/repository.js';
import type { DefinitionService } from './workflows/service.js';

const admin = '/api/v0/admin';

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
    const acceptsBody =
      options.administrative &&
      (req.method === 'POST' || req.method === 'PUT') &&
      req.path.startsWith(`${admin}/`) &&
      req.path !== `${admin}/shutdown`;
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
        commands: false,
        events: false,
        pairing: false,
        nodeTypes: [],
        harnesses: [],
      },
    };
    if (!validateServerInfo(payload))
      throw new ShiftError('INTERNAL_ERROR', 'Invalid server info response.');
    res.json(payload);
  });
  if (options.administrative && options.engine && options.definitions) {
    const engine = options.engine;
    const { service, repository } = options.definitions;
    const local = (req: express.Request) => {
      if (req.headers.origin !== undefined)
        throw new ShiftError(
          'INVALID_REQUEST',
          'Browser-origin administration is unavailable.',
          403,
        );
    };
    const reply = (res: Response, status: number, body: Record<string, unknown>) =>
      res.status(status).json({ schemaVersion: 1, requestId: res.locals['requestId'], ...body });
    // A replayed command answers with the status and body stored in its receipt.
    const command = (res: Response, response: CommandResponse) =>
      reply(res, response.status, response.body as Record<string, unknown>);
    const json = express.json({ limit: '2mb', strict: true });
    const id = (req: express.Request) => String(req.params['id']);
    app.post(`${admin}/projects`, json, async (req, res) => {
      local(req);
      command(res, await service.addProject(req.body));
    });
    app.get(`${admin}/projects`, (req, res) => {
      local(req);
      reply(res, 200, { projects: repository.projects() });
    });
    app.post(`${admin}/workflows`, json, (req, res) => {
      local(req);
      command(res, service.createWorkflow(req.body));
    });
    app.get(`${admin}/workflows`, (req, res) => {
      local(req);
      const project =
        typeof req.query['projectId'] === 'string' ? req.query['projectId'] : undefined;
      reply(res, 200, { workflows: repository.workflows(project) });
    });
    app.get(`${admin}/workflows/:id`, (req, res) => {
      local(req);
      reply(res, 200, { workflow: repository.workflow(id(req)) });
    });
    app.put(`${admin}/workflows/:id/draft`, json, (req, res) => {
      local(req);
      command(res, service.saveDraft(id(req), req.body));
    });
    app.post(`${admin}/workflows/:id/publish`, json, (req, res) => {
      local(req);
      command(res, service.publish(id(req), req.body ?? {}));
    });
    app.post(`${admin}/runs`, json, async (req, res) => {
      local(req);
      command(res, await engine.startRun(req.body));
    });
    app.get(`${admin}/runs`, (req, res) => {
      local(req);
      reply(res, 200, { runs: engine.repository.runs() });
    });
    app.get(`${admin}/runs/:id`, (req, res) => {
      local(req);
      reply(res, 200, { run: engine.repository.run(id(req)) });
    });
    for (const kind of ['cancel', 'retry', 'fail', 'complete', 'extend'] as const) {
      app.post(`${admin}/runs/:id/${kind}`, json, (req, res) => {
        local(req);
        command(res, engine.controlRun(id(req), kind, req.body ?? {}));
      });
    }
    app.get(`${admin}/interactions`, (req, res) => {
      local(req);
      reply(res, 200, {
        interactions: engine.repository.interactions(req.query['all'] === 'true'),
      });
    });
    app.get(`${admin}/interactions/:id`, (req, res) => {
      local(req);
      reply(res, 200, { interaction: engine.repository.interaction(id(req)) });
    });
    app.post(`${admin}/interactions/:id/respond`, json, (req, res) => {
      local(req);
      command(res, engine.respond(id(req), req.body ?? {}));
    });
    const workspaces = options.workspaces;
    if (workspaces) {
      app.get(`${admin}/workspaces`, (req, res) => {
        local(req);
        const project =
          typeof req.query['projectId'] === 'string' ? req.query['projectId'] : undefined;
        reply(res, 200, { workspaces: workspaces.workspaces.list(project) });
      });
      app.get(`${admin}/workspaces/:id`, (req, res) => {
        local(req);
        reply(res, 200, { workspace: workspaces.workspaces.get(id(req)) });
      });
      app.post(`${admin}/workspaces/:id/remove`, json, async (req, res) => {
        local(req);
        command(res, await workspaces.remove(id(req), req.body ?? {}));
      });
    }
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
      diagnostics: safe.fields
        .slice(0, 32)
        .map((field) => ({ field: field.slice(0, 256), message: 'Invalid field.' })),
    };
    if (!validateProtocolError(payload)) {
      res.status(500).end();
      return;
    }
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
