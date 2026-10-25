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
  | DeviceResponse
  | Project
  | Workflow
  | Run
  | Interaction
  | Workspace
  | CommandReceipt
  | ProjectResponse
  | WorkflowResponse
  | RunResponse
  | InteractionResponse
  | WorkspaceResponse
  | CommandReceiptResponse
  | ProjectList
  | WorkflowList
  | RunList
  | InteractionList
  | WorkspaceList
  | ExecutionPage
  | Event
  | EventPage
  | Snapshot;
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
export type EventCursor = string;

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
  commands: boolean;
  events: boolean;
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
export interface Project {
  id: Uuid;
  name: string;
  repositoryPath: string;
  baseRef: string;
  createdAt: number;
}
export interface Workflow {
  id: Uuid;
  projectId: Uuid;
  name: string;
  enabled: boolean;
  draftRevision: number;
  draft: {
    [k: string]: unknown;
  };
  activeVersionId: Uuid | null;
  /**
   * @maxItems 100000
   */
  versions: {
    id: Uuid;
    number: number;
    hash: string;
    createdAt: number;
  }[];
  createdAt: number;
}
export interface Run {
  id: Uuid;
  state:
    | 'QUEUED'
    | 'RUNNING'
    | 'WAITING'
    | 'HELD'
    | 'NEEDS_HUMAN'
    | 'FAILED'
    | 'CANCEL_REQUESTED'
    | 'CANCELLED'
    | 'COMPLETED';
  workflowId: Uuid | null;
  versionId: Uuid | null;
  versionNumber: number | null;
  repository: string;
  baseCommit: string | null;
  workspace: null | {
    id: Uuid;
    path: string | null;
    state: string | null;
  };
  attention: {
    [k: string]: unknown;
  } | null;
  wait: {
    [k: string]: unknown;
  } | null;
  activeTime: {
    usedMs: number;
    limitMs: number;
  };
  cancelRequested: boolean;
  outcome: unknown;
  createdAt: number;
  finishedAt: number | null;
  /**
   * @maxItems 100000
   */
  executions: Execution[];
  /**
   * @maxItems 100000
   */
  invocations: {
    id: Uuid;
    kind: 'goal' | 'correction' | 'continuation';
    state: string;
    correlationId: string;
    submissions: number;
    acceptedSubmissions: number;
  }[];
  /**
   * @maxItems 100000
   */
  controls: {
    id: Uuid;
    kind: 'cancel' | 'retry' | 'fail' | 'complete' | 'extend';
    executionId: Uuid | null;
    actor: {
      kind: string;
      id: string;
    };
    payload: unknown;
    createdAt: number;
  }[];
}
export interface Execution {
  id: Uuid;
  node: string;
  type: string;
  sequence: number;
  state: 'PENDING' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  port: string | null;
  predecessorId: Uuid | null;
  connectionId: string | null;
  sources: {
    [k: string]: unknown;
  } | null;
  output: unknown;
  error: unknown;
  /**
   * @maxItems 1000
   */
  attempts: Attempt[];
}
export interface Attempt {
  number: number;
  state: 'PENDING' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED' | 'CANCELLED';
  error: unknown;
}
export interface Interaction {
  id: Uuid;
  runId: Uuid;
  executionId: Uuid;
  node: string;
  kind: 'input' | 'approval';
  state: 'PENDING' | 'RESPONDED' | 'EXPIRED' | 'CANCELLED';
  revision: number;
  title: string;
  instructions: string | null;
  form: {
    [k: string]: unknown;
  };
  outcomes:
    | null
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string];
  expiresAt: number | null;
  createdAt: number;
  settledAt: number | null;
  runState:
    | 'QUEUED'
    | 'RUNNING'
    | 'WAITING'
    | 'HELD'
    | 'NEEDS_HUMAN'
    | 'FAILED'
    | 'CANCEL_REQUESTED'
    | 'CANCELLED'
    | 'COMPLETED';
  response: null | {
    decision: string | null;
    data: unknown;
    actor: {
      kind: string;
      id: string;
    };
    createdAt: number;
  };
}
export interface Workspace {
  id: Uuid;
  projectId: Uuid;
  runId: Uuid;
  path: string;
  repositoryPath: string;
  baseRef: string;
  baseCommit: string;
  state: 'CREATING' | 'READY' | 'RETIRED';
  createdAt: number;
  readyAt: number | null;
  retiredAt: number | null;
  claimed: boolean;
}
export interface CommandReceipt {
  commandId: CommandId;
  status: number;
  body: {
    [k: string]: unknown;
  };
  createdAt: number;
}
export interface ProjectResponse {
  schemaVersion: 1;
  requestId: Uuid;
  project: Project;
}
export interface WorkflowResponse {
  schemaVersion: 1;
  requestId: Uuid;
  workflow: Workflow;
}
export interface RunResponse {
  schemaVersion: 1;
  requestId: Uuid;
  run: Run;
}
export interface InteractionResponse {
  schemaVersion: 1;
  requestId: Uuid;
  interaction: Interaction;
}
export interface WorkspaceResponse {
  schemaVersion: 1;
  requestId: Uuid;
  workspace: Workspace;
}
export interface CommandReceiptResponse {
  schemaVersion: 1;
  requestId: Uuid;
  receipt: CommandReceipt;
}
export interface ProjectList {
  schemaVersion: 1;
  requestId: Uuid;
  /**
   * @maxItems 10000
   */
  projects: Project[];
}
export interface WorkflowList {
  schemaVersion: 1;
  requestId: Uuid;
  /**
   * @maxItems 10000
   */
  workflows: WorkflowSummary[];
}
export interface WorkflowSummary {
  id: Uuid;
  projectId: Uuid;
  name: string;
  activeVersionId: Uuid | null;
}
export interface RunList {
  schemaVersion: 1;
  requestId: Uuid;
  /**
   * @maxItems 10000
   */
  runs: RunSummary[];
}
export interface RunSummary {
  id: Uuid;
  state:
    | 'QUEUED'
    | 'RUNNING'
    | 'WAITING'
    | 'HELD'
    | 'NEEDS_HUMAN'
    | 'FAILED'
    | 'CANCEL_REQUESTED'
    | 'CANCELLED'
    | 'COMPLETED';
  workflowId: Uuid | null;
  createdAt: number;
  finishedAt: number | null;
}
export interface InteractionList {
  schemaVersion: 1;
  requestId: Uuid;
  /**
   * @maxItems 10000
   */
  interactions: Interaction[];
}
export interface WorkspaceList {
  schemaVersion: 1;
  requestId: Uuid;
  /**
   * @maxItems 10000
   */
  workspaces: Workspace[];
}
export interface ExecutionPage {
  schemaVersion: 1;
  requestId: Uuid;
  /**
   * @maxItems 500
   */
  executions: Execution[];
  next: number | null;
}
export interface Event {
  cursor: EventCursor;
  epoch: Uuid;
  sequence: number;
  type: string;
  schemaVersion: number;
  runId: Uuid | null;
  executionId: Uuid | null;
  sessionId: Uuid | null;
  payload: {
    [k: string]: unknown;
  };
  createdAt: number;
}
export interface EventPage {
  schemaVersion: 1;
  requestId: Uuid;
  /**
   * @maxItems 1000
   */
  events: Event[];
  next: EventCursor | null;
  highWater: EventCursor;
}
export interface Snapshot {
  schemaVersion: 1;
  requestId: Uuid;
  cursor: EventCursor;
  /**
   * @maxItems 10000
   */
  projects: Project[];
  /**
   * @maxItems 10000
   */
  workflows: WorkflowSummary[];
  /**
   * @maxItems 10000
   */
  runs: RunSummary[];
  /**
   * @maxItems 10000
   */
  interactions: Interaction[];
}
