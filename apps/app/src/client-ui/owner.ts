import type { Interaction, Run } from '../protocol/generated/types.js';
import type { Overview } from '../shared/contracts.js';

// What needs the owner (client specification 5.4): pending human requests and runs stopped for
// a decision. Both come from the server's projection; nothing here is local notification state.

export interface AttentionItem {
  // The interaction or run ID; a toast appears for an ID not seen before.
  id: string;
  kind: 'request' | 'stuck';
  runId: string;
  projectId: string | null;
  workflowId: string | null;
  workflowName: string;
  // The node to select, when known without reading the run.
  nodeId: string | null;
  title: string;
  createdAt: number;
  interaction: Interaction | null;
}

export function attentionItems(overview: Overview, interactions: Interaction[]): AttentionItem[] {
  const runs = new Map(overview.runs.map((run) => [run.id, run]));
  const workflows = new Map(overview.workflows.map((workflow) => [workflow.id, workflow]));
  const place = (runId: string) => {
    const workflow = workflows.get(runs.get(runId)?.workflowId ?? '');
    return {
      workflowId: workflow?.id ?? null,
      projectId: workflow?.projectId ?? null,
      workflowName: workflow?.name ?? 'A workflow',
    };
  };
  const requests = interactions
    .filter((item) => item.state === 'PENDING')
    .map<AttentionItem>((item) => ({
      id: item.id,
      kind: 'request',
      runId: item.runId,
      ...place(item.runId),
      nodeId: item.node,
      title: item.title,
      createdAt: item.createdAt,
      interaction: item,
    }));
  const stuck = overview.runs
    .filter((run) => run.state === 'NEEDS_HUMAN')
    .map<AttentionItem>((run) => ({
      id: run.id,
      kind: 'stuck',
      runId: run.id,
      ...place(run.id),
      nodeId: null,
      title: 'A run needs your decision',
      createdAt: run.createdAt,
      interaction: null,
    }));
  return [...requests, ...stuck].sort((a, b) => a.createdAt - b.createdAt);
}

// The decisions the server accepts for a run that needs the owner, so only those are offered.
export interface RunControls {
  retry: boolean;
  fail: boolean;
  // Record a verified result: only for a stuck agent step.
  complete: boolean;
  // Which limit to raise, when a limit stopped the run.
  extend: 'executions' | 'activeMs' | null;
  // The execution the decision is about.
  executionId: string | null;
  nodeId: string | null;
}

const none: RunControls = {
  retry: false,
  fail: false,
  complete: false,
  extend: null,
  executionId: null,
  nodeId: null,
};

export function runControls(run: Run): RunControls {
  if (run.state !== 'NEEDS_HUMAN' || run.cancelRequested) return none;
  const code = run.attention?.['code'];
  // The server decides about the latest waiting execution.
  const stuck = [...run.executions]
    .filter((item) => item.state === 'WAITING')
    .sort((a, b) => b.sequence - a.sequence)[0];
  const limitedId = run.attention?.['executionId'];
  const limited = run.executions.find((item) => item.id === limitedId);
  if (code === 'EXECUTION_LIMIT' || code === 'ACTIVE_TIME_LIMIT') {
    // A node's limit names that node; otherwise the run stopped after the limited execution.
    const limit = run.attention?.['limit'] as { nodeId?: unknown } | undefined;
    return {
      ...none,
      fail: true,
      extend: code === 'EXECUTION_LIMIT' ? 'executions' : 'activeMs',
      executionId: limited?.id ?? null,
      nodeId: typeof limit?.nodeId === 'string' ? limit.nodeId : (limited?.node ?? null),
    };
  }
  if (code === 'CANCEL_UNCONFIRMED') return none;
  return {
    ...none,
    retry: stuck !== undefined,
    fail: true,
    complete: stuck?.type === 'agent',
    executionId: stuck?.id ?? null,
    nodeId: stuck?.node ?? null,
  };
}

// "approved" reads as "Approve" on its button; another outcome keeps its words.
export function outcomeLabel(outcome: string): string {
  if (outcome === 'approved') return 'Approve';
  if (outcome === 'rejected') return 'Reject';
  const words = outcome.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function decisionLabel(decision: string): string {
  if (decision === 'approved') return 'Approved';
  if (decision === 'rejected') return 'Rejected';
  return outcomeLabel(decision);
}

export function actorLabel(
  actor: { kind: string; id: string } | undefined,
  deviceId: string | null,
): string {
  if (!actor) return 'someone';
  if (actor.kind === 'device') return actor.id === deviceId ? 'this device' : 'another device';
  if (actor.kind === 'cli') return 'the server CLI';
  return 'someone';
}

// The answer this device sent for a request: the newest command to its respond path.
export function respondPath(interactionId: string): string {
  return `/api/v0/interactions/${interactionId}/respond`;
}
