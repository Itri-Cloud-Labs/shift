/* Generated. Do not edit. */
import type {
  ServerInfo,
  ServerHealth,
  ProtocolError,
  ShutdownAcknowledgement,
  ServerIdentity,
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
