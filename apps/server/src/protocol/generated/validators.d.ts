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
  WorkflowVersionResponse,
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
  RunVariables,
  ArtifactList,
  ArtifactResponse,
  CredentialList,
  CredentialResponse,
  ProjectPermissionsResponse,
  GitHubAppList,
  GitHubAppResponse,
  GitHubConnectionResponse,
  GitHubDeliveryResponse,
  GitHubDeliveryPage,
  TriggerList,
  OccurrencePage,
  OccurrenceResponse,
  SchedulePreview,
  SessionList,
  SessionResponse,
  InvocationResponse,
  TranscriptPage,
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
export const validateWorkflowVersionResponse: Validator<WorkflowVersionResponse>;
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
export const validateRunVariables: Validator<RunVariables>;
export const validateArtifactList: Validator<ArtifactList>;
export const validateArtifactResponse: Validator<ArtifactResponse>;
export const validateCredentialList: Validator<CredentialList>;
export const validateCredentialResponse: Validator<CredentialResponse>;
export const validateProjectPermissionsResponse: Validator<ProjectPermissionsResponse>;
export const validateGitHubAppList: Validator<GitHubAppList>;
export const validateGitHubAppResponse: Validator<GitHubAppResponse>;
export const validateGitHubConnectionResponse: Validator<GitHubConnectionResponse>;
export const validateGitHubDeliveryResponse: Validator<GitHubDeliveryResponse>;
export const validateGitHubDeliveryPage: Validator<GitHubDeliveryPage>;
export const validateTriggerList: Validator<TriggerList>;
export const validateOccurrencePage: Validator<OccurrencePage>;
export const validateOccurrenceResponse: Validator<OccurrenceResponse>;
export const validateSchedulePreview: Validator<SchedulePreview>;
export const validateSessionList: Validator<SessionList>;
export const validateSessionResponse: Validator<SessionResponse>;
export const validateInvocationResponse: Validator<InvocationResponse>;
export const validateTranscriptPage: Validator<TranscriptPage>;
export const validateEvent: Validator<Event>;
export const validateEventPage: Validator<EventPage>;
export const validateSnapshot: Validator<Snapshot>;
