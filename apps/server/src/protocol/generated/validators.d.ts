/* Generated. Do not edit. */
import type {
  ServerInfo,
  ServerHealth,
  ProtocolError,
  ShutdownAcknowledgement,
  ServerIdentity,
  Device,
  PairRequest,
  PairResponse,
  PairingIssued,
  DeviceList,
  DeviceResponse,
} from './types.js';

export interface ValidationDiagnostic {
  instancePath: string;
  keyword: string;
  message?: string;
}

export interface Validator<T> {
  (value: unknown): value is T;
  errors?: readonly ValidationDiagnostic[] | null;
}

export const validateServerInfo: Validator<ServerInfo>;
export const validateServerHealth: Validator<ServerHealth>;
export const validateProtocolError: Validator<ProtocolError>;
export const validateShutdownAcknowledgement: Validator<ShutdownAcknowledgement>;
export const validateServerIdentity: Validator<ServerIdentity>;
export const validateDevice: Validator<Device>;
export const validatePairRequest: Validator<PairRequest>;
export const validatePairResponse: Validator<PairResponse>;
export const validatePairingIssued: Validator<PairingIssued>;
export const validateDeviceList: Validator<DeviceList>;
export const validateDeviceResponse: Validator<DeviceResponse>;
