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
  ProjectResponse,
  WorkflowResponse,
  RunResponse,
  InteractionResponse,
  WorkspaceResponse,
  CommandReceiptResponse,
  ProjectList,
  WorkflowList,
  RunList,
  InteractionList,
  WorkspaceList,
  ExecutionPage,
  Event,
  EventPage,
  Snapshot,
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
export const validateProjectResponse: Validator<ProjectResponse>;
export const validateWorkflowResponse: Validator<WorkflowResponse>;
export const validateRunResponse: Validator<RunResponse>;
export const validateInteractionResponse: Validator<InteractionResponse>;
export const validateWorkspaceResponse: Validator<WorkspaceResponse>;
export const validateCommandReceiptResponse: Validator<CommandReceiptResponse>;
export const validateProjectList: Validator<ProjectList>;
export const validateWorkflowList: Validator<WorkflowList>;
export const validateRunList: Validator<RunList>;
export const validateInteractionList: Validator<InteractionList>;
export const validateWorkspaceList: Validator<WorkspaceList>;
export const validateExecutionPage: Validator<ExecutionPage>;
export const validateEvent: Validator<Event>;
export const validateEventPage: Validator<EventPage>;
export const validateSnapshot: Validator<Snapshot>;
