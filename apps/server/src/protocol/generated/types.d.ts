/* Generated from foundation.schema.json. Do not edit. */

export type FoundationPayload =
  | ServerInfo
  | ServerHealth
  | ProtocolError
  | ShutdownAcknowledgement
  | ServerIdentity
  | Device
  | PairRequest
  | PairResponse
  | PairingIssued
  | DeviceList
  | DeviceResponse;
export type Uuid = string;
export type Readiness = {
  ready: boolean;
  phase: 'starting' | 'ready' | 'stopping' | 'failed';
  reason: 'STARTING' | 'READY' | 'STOPPING' | 'PERSISTENCE_UNAVAILABLE';
} & Readiness1;
export type Readiness1 =
  | {
      ready?: false;
      phase?: 'starting';
      reason?: 'STARTING';
      [k: string]: unknown;
    }
  | {
      ready?: true;
      phase?: 'ready';
      reason?: 'READY';
      [k: string]: unknown;
    }
  | {
      ready?: false;
      phase?: 'stopping';
      reason?: 'STOPPING';
      [k: string]: unknown;
    }
  | {
      ready?: false;
      phase?: 'failed';
      reason?: 'PERSISTENCE_UNAVAILABLE';
      [k: string]: unknown;
    };
export type DeviceName = string;
export type CommandId = string;

export interface ServerInfo {
  schemaVersion: 1;
  requestId: Uuid;
  serverId: Uuid;
  eventEpoch: Uuid;
  serverVersion: string;
  protocol: ProtocolRange;
  readiness: Readiness;
  capabilities: ServerCapabilities;
  time: Timestamp;
}
export interface ProtocolRange {
  min: 0;
  max: 0;
}
export interface ServerCapabilities {
  commands: false;
  events: false;
  pairing: boolean;
  /**
   * @maxItems 0
   */
  nodeTypes: [];
  /**
   * @maxItems 0
   */
  harnesses: [];
}
export interface Timestamp {
  epochMs: number;
  iso: string;
}
export interface ServerHealth {
  schemaVersion: 1;
  requestId: Uuid;
  serverId: Uuid;
  eventEpoch: Uuid;
  protocol: ProtocolRange;
  liveness: 'alive';
  readiness: Readiness;
  time: Timestamp;
}
export interface ProtocolError {
  schemaVersion: 1;
  requestId: Uuid;
  code: string;
  message: string;
  retryable: boolean;
  /**
   * @maxItems 32
   */
  diagnostics: Diagnostic[];
}
export interface Diagnostic {
  field: string;
  message: string;
}
export interface ShutdownAcknowledgement {
  schemaVersion: 1;
  requestId: Uuid;
  accepted: true;
}
export interface ServerIdentity {
  serverId: Uuid;
  eventEpoch: Uuid;
}
export interface Device {
  id: Uuid;
  name: DeviceName;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}
export interface PairRequest {
  phrase: string;
  deviceName: DeviceName;
  commandId: CommandId;
}
export interface PairResponse {
  schemaVersion: 1;
  requestId: Uuid;
  device: Device;
  token: string;
}
export interface PairingIssued {
  schemaVersion: 1;
  requestId: Uuid;
  pairing: {
    phrase: string;
    expiresAt: number;
  };
}
export interface DeviceList {
  schemaVersion: 1;
  requestId: Uuid;
  /**
   * @maxItems 1000
   */
  devices: Device[];
  currentDeviceId: Uuid;
}
export interface DeviceResponse {
  schemaVersion: 1;
  requestId: Uuid;
  device: Device;
}
