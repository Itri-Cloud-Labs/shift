import type { Json } from '../harness/types.js';

export interface AgentTask {
  goal: string;
  cwd: string;
  resultSchema: Json;
  readOnly: boolean;
}

const submission = (task: AgentTask) =>
  [
    'When you finish, call the shift_submit_result tool with one of:',
    `- {"status": "completed", "data": <a value matching this JSON Schema: ${JSON.stringify(task.resultSchema)}>}`,
    '- {"status": "blocked", "blocker": {"code": "<SHORT_CODE>", "message": "<what you need>"}} if you cannot continue without a decision or input you do not have',
    '- {"status": "failed", "error": {"code": "<SHORT_CODE>", "message": "<what went wrong>"}} if the task cannot be done',
    'If Shift rejects the result, correct it and call the tool again. A text reply alone does not finish the task.',
  ].join('\n');

// Default prompts explain unattended execution, broad intent, blocker reporting and the required
// result (specification 6.5). A reused session still receives the full goal.
export function goalPrompt(task: AgentTask, artifactDirectory: string): string {
  return [
    'You are running unattended as one step of a Shift workflow. Nobody will answer questions while you work, so resolve low-risk ambiguity yourself and report a blocker when you cannot proceed.',
    '',
    `Task: ${task.goal}`,
    '',
    `Working directory: ${task.cwd}`,
    task.readOnly
      ? `You may not modify the working directory. You may write files only under ${artifactDirectory}.`
      : `You may modify the working directory. Put any reports under ${artifactDirectory}.`,
    '',
    submission(task),
  ].join('\n');
}

export function correctionPrompt(task: AgentTask): string {
  return [
    'Your previous turn ended without a result accepted by Shift. Do not redo work that is already done.',
    '',
    submission(task),
  ].join('\n');
}

export function continuationPrompt(task: AgentTask, artifactDirectory: string): string {
  return [
    'Your previous turn was interrupted before it finished. First inspect the working directory to see what was already done, then continue the original task without repeating completed steps.',
    '',
    goalPrompt(task, artifactDirectory),
  ].join('\n');
}
