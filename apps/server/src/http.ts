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

export function createHttpServer(options: {
  store: Store;
  clock: Clock;
  readiness: ReadinessState;
  logger: Logger;
  administrative: boolean;
  stop: () => void;
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
    // Nothing in this foundation accepts arbitrary JSON bodies or caller request IDs.
    if (
      req.headers['transfer-encoding'] !== undefined ||
      (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')
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
    const safe = publicError(error);
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
