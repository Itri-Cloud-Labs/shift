// Generic harness contract from the server specification, section 9. Adapters translate it to a
// concrete harness; nothing here knows about workflow routing or persistence.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface HarnessCapabilities {
  persistedSessionResume: boolean;
  structuredSchemaDialect: '2020-12-subset' | 'adapter-translated' | 'unsupported';
  invocationInspection: 'durable_correlated' | 'best_effort';
  cancellation: 'acknowledged_stop' | 'best_effort';
  toolPolicy: 'enforced' | 'limited';
}

export interface ModelRef {
  providerID: string;
  id: string;
}

// `read_only` forbids repository writes and shell commands; artifact-directory writes stay allowed.
export interface ToolPolicy {
  mode: 'workspace_write' | 'read_only';
}

export interface HarnessSessionHandle {
  shiftSessionId: string;
  harnessSessionId: string;
  storageNamespace: string;
  cwd: string;
}

export interface HarnessCreateRequest {
  shiftSessionId: string;
  operationId: string;
  cwd: string;
  model: ModelRef;
}

export interface HarnessInvocationRequest {
  invocationId: string;
  goal: string;
  artifactDirectory: string;
  toolPolicy: ToolPolicy;
}

export interface InvocationCorrelation {
  shiftInvocationId: string;
  providerMessageId: string;
}

export type SubmissionReceipt =
  | { kind: 'accepted'; correlation: InvocationCorrelation }
  | { kind: 'uncertain'; correlation: InvocationCorrelation; explanation: string };

export interface HarnessPrompt {
  kind: 'permission' | 'question';
  id: string;
}

// A turn the harness itself failed, such as a provider refusing the credential. Messages are
// Shift's own text: provider responses can echo request details, so only their type and status are
// kept.
export interface HarnessFailure {
  code: 'PROVIDER_AUTH' | 'PROVIDER_ERROR' | 'HARNESS_TURN_FAILED';
  message: string;
}

// The terminal result arrives through the adapter's result handler, not through inspection, so a
// turn that ended is reported as `ended`; the caller combines it with its accepted-result record.
export type InvocationObservation =
  | { kind: 'not_accepted' }
  | { kind: 'queued' }
  | { kind: 'awaiting_harness_prompt'; prompts: HarnessPrompt[] }
  | { kind: 'running' }
  | {
      kind: 'ended';
      outcome: 'succeeded' | 'failed';
      messageIds: string[];
      // Why the harness failed the turn, when it recorded a cause.
      failure?: HarnessFailure;
    }
  | { kind: 'interrupted'; explanation: string; messageIds: string[] }
  | { kind: 'unknown'; explanation: string; messageIds: string[] };

export type HarnessSessionObservation =
  { kind: 'missing' } | { kind: 'present'; active: boolean; cwd: string; metadata: Json };

export type CancellationObservation =
  | { kind: 'stopped'; observation: InvocationObservation }
  | { kind: 'unconfirmed'; explanation: string; observation: InvocationObservation };

export type HarnessEvent =
  | { kind: 'activity'; harnessSessionId: string; type: string; at: number }
  | { kind: 'prompt_requested'; harnessSessionId: string; prompt: HarnessPrompt; at: number }
  | { kind: 'turn_ended'; harnessSessionId: string; type: string; at: number };

// Each submission is persisted by the handler before it answers; the answer reaches the agent as
// the tool result, so a rejection lets the agent correct its result within the same turn.
export interface ResultSubmission {
  harnessSessionId: string;
  assistantMessageId: string;
  toolCallId: string;
  input: unknown;
}

export type ResultVerdict = { accepted: true } | { accepted: false; reason: string };
export type ResultHandler = (submission: ResultSubmission) => Promise<ResultVerdict>;

export interface HarnessAdapter {
  readonly id: string;
  // Where the harness keeps its sessions; recorded when Shift binds a session.
  readonly storageNamespace: string;
  capabilities(): HarnessCapabilities;
  // Pure: the correlation is recorded durably before the prompt is submitted.
  correlate(invocationId: string): InvocationCorrelation;
  createSession(request: HarnessCreateRequest): Promise<HarnessSessionHandle>;
  inspectSession(handle: HarnessSessionHandle): Promise<HarnessSessionObservation>;
  submit(
    handle: HarnessSessionHandle,
    request: HarnessInvocationRequest,
  ): Promise<SubmissionReceipt>;
  inspectInvocation(
    handle: HarnessSessionHandle,
    correlation: InvocationCorrelation,
  ): Promise<InvocationObservation>;
  observe(handle: HarnessSessionHandle, signal: AbortSignal): AsyncIterable<HarnessEvent>;
  cancel(
    handle: HarnessSessionHandle,
    correlation: InvocationCorrelation,
  ): Promise<CancellationObservation>;
  archive(handle: HarnessSessionHandle): Promise<void>;
}
