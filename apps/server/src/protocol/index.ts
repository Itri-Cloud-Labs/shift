export type {
  ProtocolError,
  ServerInfo,
  ServerHealth,
  ServerIdentity,
  Readiness,
  ShutdownAcknowledgement,
  Device,
  PairRequest,
  PairResponse,
  PairingIssued,
  DeviceList,
  DeviceResponse,
} from './generated/types.js';
export {
  validateProtocolError,
  validateServerInfo,
  validateServerHealth,
  validateServerIdentity,
  validateShutdownAcknowledgement,
  validatePairRequest,
  validatePairResponse,
  validatePairingIssued,
  validateDeviceList,
  validateDeviceResponse,
} from './generated/validators.js';

export const protocolRange = { min: 0, max: 0 } as const;
export const serverVersion = '0.0.0';
