import type { HarnessPrompt, InvocationObservation } from '../types.js';

export interface OpenCodeMessage {
  id: string;
  type: string;
  outcome?: 'succeeded' | 'failed' | 'interrupted';
  finish?: string;
  error?: { type?: string };
  content?: Array<{ type: string; state?: { status?: string } }>;
}

export interface InvocationEvidence {
  messageFound: boolean;
  queued: boolean;
  active: boolean;
  prompts: HarnessPrompt[];
  // Messages after the invocation's user message, up to but excluding the next user message.
  turn: OpenCodeMessage[];
  followedByUserMessage: boolean;
}

const runningTool = (message: OpenCodeMessage) =>
  (message.content ?? []).some((part) => part.type === 'tool' && part.state?.status === 'running');

// Applies the classification recorded in docs/opencode-capabilities.md section 5. Shift serializes
// invocations per session, so only one turn can be live and the turn's messages are positional.
export function classifyInvocation(evidence: InvocationEvidence): InvocationObservation {
  if (!evidence.messageFound) return { kind: evidence.queued ? 'queued' : 'not_accepted' };
  if (evidence.prompts.length > 0) {
    return { kind: 'awaiting_harness_prompt', prompts: evidence.prompts };
  }
  if (evidence.active && !evidence.followedByUserMessage) return { kind: 'running' };
  const assistants = evidence.turn.filter((message) => message.type === 'assistant');
  const messageIds = assistants.map((message) => message.id);
  const idle = evidence.turn.find((message) => message.type === 'idle');
  if (idle?.outcome === 'interrupted') {
    return { kind: 'interrupted', explanation: 'The harness interrupted the turn.', messageIds };
  }
  if (idle?.outcome === 'succeeded' || idle?.outcome === 'failed') {
    return { kind: 'ended', outcome: idle.outcome, messageIds };
  }
  // Tools run only inside an assistant step, so a turn with none produced no effects.
  if (assistants.length === 0) {
    return {
      kind: 'interrupted',
      explanation: 'The turn stopped before any assistant step started.',
      messageIds,
    };
  }
  // Dismissed questions end the turn with an aborted step but no idle record. After a later
  // prompt OpenCode also relabels crashed tools as aborted, so this applies only to the last turn.
  const last = assistants.at(-1)!;
  if (
    !evidence.followedByUserMessage &&
    last.finish === 'error' &&
    last.error?.type === 'aborted' &&
    !assistants.some(runningTool)
  ) {
    return {
      kind: 'interrupted',
      explanation: 'The harness aborted the turn without an idle record.',
      messageIds,
    };
  }
  return {
    kind: 'unknown',
    explanation:
      'The turn stopped without terminal evidence, for example after a runtime crash. Effects of its tools are unknown.',
    messageIds,
  };
}
