export type {
  ProtocolError,
  ServerInfo,
  ServerHealth,
  ServerIdentity,
  Readiness,
  ShutdownAcknowledgement,
} from './generated/types.js';
export {
  validateProtocolError,
  validateServerInfo,
  validateServerHealth,
  validateServerIdentity,
  validateShutdownAcknowledgement,
} from './generated/validators.js';

export const protocolRange = { min: 0, max: 0 } as const;
export const serverVersion = '0.0.0';
