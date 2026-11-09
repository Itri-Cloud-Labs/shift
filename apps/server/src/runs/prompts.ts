import type { Json } from '../harness/types.js';
import type { ReportRequirement } from './repository.js';

export interface AgentTask {
  goal: string;
  cwd: string;
  resultSchema: Json;
  readOnly: boolean;
  reports: { handoff: ReportRequirement; humanReport: ReportRequirement };
  // Earlier agents' handoffs, inline or as a readable file when they are large.
  handoffs: ReceivedHandoff[];
}

export type ReceivedHandoff = { nodeId: string } & ({ text: string } | { path: string });

const reportText: Record<keyof AgentTask['reports'], [string, string]> = {
  handoff: [
    'tothenextagent.md',
    'for the agent that continues after you: what you did, the decisions you made, the current state and anything left open',
  ],
  humanReport: [
    'toahumanreader.md',
    'for the person who owns this workflow: a short account of what you did and why, and anything they should check',
  ],
};

// The reports a completed result needs, in the turn's own directory (specification 6.5).
function reports(task: AgentTask, artifactDirectory: string): string[] {
  const wanted = (Object.keys(reportText) as (keyof AgentTask['reports'])[]).filter(
    (role) => task.reports[role] !== 'off',
  );
  if (wanted.length === 0) return [];
  return [
    '',
    `Before you submit a completed result, write these Markdown files in ${artifactDirectory}:`,
    ...wanted.map(
      (role) => `- ${reportText[role][0]} (${task.reports[role]}), ${reportText[role][1]}.`,
    ),
    'A blocked or failed result needs no reports.',
  ];
}

function handoffs(task: AgentTask): string[] {
  if (task.handoffs.length === 0) return [];
  return [
    '',
    'Earlier agents in this run left these handoffs. Read them before you start; they describe work already done.',
    ...task.handoffs.flatMap((handoff) => {
      const from = handoff.nodeId ? `the ${handoff.nodeId} node` : 'an earlier node';
      return 'text' in handoff
        ? [`--- Handoff from ${from} ---`, handoff.text, '--- End of handoff ---']
        : [`- The handoff from ${from} is in ${handoff.path}.`];
    }),
  ];
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
    ...handoffs(task),
    '',
    `Working directory: ${task.cwd}`,
    task.readOnly
      ? `You may not modify the working directory. You may write files only under ${artifactDirectory}.`
      : `You may modify the working directory. Put any reports under ${artifactDirectory}.`,
    ...reports(task, artifactDirectory),
    '',
    submission(task),
  ].join('\n');
}

// `missing` names required reports a completed result came without; otherwise no result was
// accepted. Reports belong to the turn that submits the result, so they are written again here.
export function correctionPrompt(
  task: AgentTask,
  artifactDirectory: string,
  missing: string[] = [],
): string {
  return [
    missing.length
      ? `Shift accepted your result, but these required reports were missing or unreadable: ${missing.join(', ')}. Do not redo work that is already done. Write the reports again, then submit the result again.`
      : 'Your previous turn ended without a result accepted by Shift. Do not redo work that is already done.',
    ...reports(task, artifactDirectory),
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

// Starts a later attempt. After an owner retry the earlier attempt stopped without evidence of
// what it did; after an automatic retry it failed with `failure`, possibly midway. Either way the
// agent must establish the current state before acting again.
export function retryPrompt(
  task: AgentTask,
  artifactDirectory: string,
  failure?: { code: string; message: string },
): string {
  return [
    failure
      ? `An earlier attempt at this task failed before it finished (${failure.code}: ${failure.message}). Shift is retrying it. Its tools may have completed some steps. First inspect the working directory to establish what was already done, then finish the original task without repeating completed steps.`
      : 'An earlier attempt at this task stopped unexpectedly, and what it changed is unknown. Its tools may have completed some steps. First inspect the working directory to establish what was already done, then finish the original task without repeating completed steps.',
    '',
    goalPrompt(task, artifactDirectory),
  ].join('\n');
}
