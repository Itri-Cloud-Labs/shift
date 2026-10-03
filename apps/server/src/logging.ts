import { pino, type DestinationStream, type Logger } from 'pino';
import type { ServerConfig } from './config.js';

const secretKeys = [
  'authorization',
  'cookie',
  'token',
  'secret',
  'password',
  'privateKey',
  'credential',
  'pairingPhrase',
];

export function createLogger(
  level: ServerConfig['logLevel'],
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      level,
      base: { service: 'shift-server' },
      redact: {
        paths: secretKeys.flatMap((key) => [key, `*.${key}`, `*.*.${key}`, `req.headers.${key}`]),
        censor: '[REDACTED]',
      },
      // Call sites log selected scalar fields only; raw errors and headers are forbidden.
      serializers: { err: () => ({ message: 'Exception details omitted.' }) },
    },
    destination,
  );
}
