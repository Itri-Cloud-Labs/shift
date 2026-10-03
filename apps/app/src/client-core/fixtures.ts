import type { ShellState } from '../shared/contracts.js';

// UI-only samples, never server records or a claim about installed capabilities.
const samples: ShellState = {
  connection: 'unconfigured',
  samples: true,
  capturedAt: '2026-10-02T15:40:00.000Z',
  projects: [
    { id: 'sample-shift', name: 'Shift', repository: 'itri-cloud-labs/shift', branch: 'main' },
    {
      id: 'sample-docs',
      name: 'Developer docs',
      repository: 'itri-cloud-labs/docs',
      branch: 'main',
    },
  ],
  workflows: [
    {
      id: 'sample-review',
      projectId: 'sample-shift',
      name: 'Pull request review',
      description: 'Review a change, collect findings, and request approval.',
      version: 'Version 3',
      trigger: 'Pull request opened',
      updatedAt: 'Oct 2, 15:40 UTC',
      nodes: ['GitHub event', 'Review change', 'Human approval', 'Post review'],
    },
    {
      id: 'sample-fix',
      projectId: 'sample-shift',
      name: 'Issue to pull request',
      description: 'Investigate an issue and prepare a change for review.',
      version: 'Version 1',
      trigger: 'Manual start',
      updatedAt: 'Oct 2, 12:10 UTC',
      nodes: ['Manual start', 'Investigate issue', 'Implement fix', 'Run checks', 'Human approval'],
    },
    {
      id: 'sample-audit',
      projectId: 'sample-shift',
      name: 'Dependency audit',
      description: 'Check dependencies and summarize proposed updates.',
      version: 'Draft',
      trigger: 'Weekly schedule',
      updatedAt: 'Oct 1, 09:00 UTC',
      nodes: ['Schedule', 'Inspect dependencies', 'Write report'],
    },
    {
      id: 'sample-doc-review',
      projectId: 'sample-docs',
      name: 'Documentation review',
      description: 'Check documentation changes before publication.',
      version: 'Version 2',
      trigger: 'Manual start',
      updatedAt: 'Oct 1, 16:00 UTC',
      nodes: ['Manual start', 'Review documentation', 'Human approval'],
    },
  ],
  runs: [
    {
      id: 'sample-run-104',
      projectId: 'sample-shift',
      workflowId: 'sample-review',
      name: 'Review #104',
      version: 'Version 3',
      status: 'Waiting for approval',
      startedAt: 'Oct 2, 15:32 UTC',
      detail: 'Review completed. A human decision is required before posting.',
    },
    {
      id: 'sample-run-103',
      projectId: 'sample-shift',
      workflowId: 'sample-fix',
      name: 'Fix issue #38',
      version: 'Version 1',
      status: 'Completed',
      startedAt: 'Oct 2, 12:10 UTC',
      detail: 'The sample run finished after its checks passed.',
    },
    {
      id: 'sample-run-102',
      projectId: 'sample-shift',
      workflowId: 'sample-review',
      name: 'Review #102',
      version: 'Version 2',
      status: 'Failed',
      startedAt: 'Oct 1, 17:21 UTC',
      detail: 'The sample check failed. No external review was posted.',
    },
  ],
  sessions: [
    {
      id: 'sample-session-review',
      projectId: 'sample-shift',
      name: 'Review session',
      status: 'Idle',
      lifetime: 'Persistent',
      detail: 'Retained after review #104. Idle session state does not imply a completed run.',
    },
    {
      id: 'sample-session-fix',
      projectId: 'sample-shift',
      name: 'Issue #38 investigation',
      status: 'Archived',
      lifetime: 'Run',
      detail: 'Archived after the sample fix completed.',
    },
  ],
  attention: [
    {
      id: 'sample-approval',
      projectId: 'sample-shift',
      runId: 'sample-run-104',
      title: 'Review #104 needs approval',
      detail: 'Inspect the proposed review before it is posted to the pull request.',
    },
  ],
  catalog: [
    { type: 'agent', label: 'Agent' },
    { type: 'human', label: 'Human approval' },
    { type: 'condition', label: 'Condition' },
  ],
};
export function createShell(samplesEnabled: boolean): ShellState {
  return structuredClone(
    samplesEnabled
      ? samples
      : {
          connection: 'unconfigured',
          samples: false,
          capturedAt: '2026-10-02T15:40:00.000Z',
          projects: [],
          workflows: [],
          runs: [],
          sessions: [],
          attention: [],
          catalog: [],
        },
  );
}
