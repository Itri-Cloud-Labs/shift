import type { Permissions } from '../github/api.js';

// The GitHub events a trigger can subscribe to (server specification 12.3). Each names the least
// the App must grant for GitHub to send it, the actions authors usually pick, and where its
// branch is, so a branch filter means the same thing for every event. The App's own settings
// must also subscribe to the event; GitHub sends nothing otherwise.
interface EventSpec {
  permissions: Permissions;
  actions: readonly string[];
  // The branch the event is about, when it has one.
  branches: (payload: Payload) => string[];
}

type Payload = Record<string, unknown>;

const field = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>(
    (current, key) =>
      typeof current === 'object' && current !== null
        ? (current as Record<string, unknown>)[key]
        : undefined,
    value,
  );
const text = (value: unknown): string[] => (typeof value === 'string' && value ? [value] : []);
const pullBase = (payload: Payload) => text(field(payload, 'pull_request', 'base', 'ref'));

export const githubEvents: Record<string, EventSpec> = {
  push: {
    permissions: { contents: 'read' },
    actions: [],
    branches: (payload) => {
      const ref = field(payload, 'ref');
      return typeof ref === 'string' && ref.startsWith('refs/heads/')
        ? [ref.slice('refs/heads/'.length)]
        : [];
    },
  },
  pull_request: {
    permissions: { pull_requests: 'read' },
    actions: [
      'opened',
      'synchronize',
      'reopened',
      'closed',
      'edited',
      'ready_for_review',
      'converted_to_draft',
      'labeled',
      'unlabeled',
      'review_requested',
    ],
    branches: pullBase,
  },
  pull_request_review: {
    permissions: { pull_requests: 'read' },
    actions: ['submitted', 'edited', 'dismissed'],
    branches: pullBase,
  },
  pull_request_review_comment: {
    permissions: { pull_requests: 'read' },
    actions: ['created', 'edited', 'deleted'],
    branches: pullBase,
  },
  issues: {
    permissions: { issues: 'read' },
    actions: ['opened', 'edited', 'closed', 'reopened', 'labeled', 'unlabeled', 'assigned'],
    branches: () => [],
  },
  issue_comment: {
    permissions: { issues: 'read' },
    actions: ['created', 'edited', 'deleted'],
    branches: () => [],
  },
  check_run: {
    permissions: { checks: 'read' },
    actions: ['created', 'completed', 'rerequested', 'requested_action'],
    branches: (payload) => text(field(payload, 'check_run', 'check_suite', 'head_branch')),
  },
  check_suite: {
    permissions: { checks: 'read' },
    actions: ['completed', 'requested', 'rerequested'],
    branches: (payload) => text(field(payload, 'check_suite', 'head_branch')),
  },
  status: {
    permissions: { statuses: 'read' },
    actions: [],
    branches: (payload) => {
      const branches = field(payload, 'branches');
      return Array.isArray(branches)
        ? branches.flatMap((branch) => text(field(branch, 'name')))
        : [];
    },
  },
  workflow_run: {
    permissions: { actions: 'read' },
    actions: ['requested', 'in_progress', 'completed'],
    branches: (payload) => text(field(payload, 'workflow_run', 'head_branch')),
  },
  release: {
    permissions: { contents: 'read' },
    actions: ['published', 'created', 'released', 'prereleased', 'edited', 'deleted'],
    branches: () => [],
  },
  create: {
    permissions: { contents: 'read' },
    actions: [],
    branches: (payload) =>
      field(payload, 'ref_type') === 'branch' ? text(field(payload, 'ref')) : [],
  },
  delete: {
    permissions: { contents: 'read' },
    actions: [],
    branches: (payload) =>
      field(payload, 'ref_type') === 'branch' ? text(field(payload, 'ref')) : [],
  },
};

// A branch pattern is a name in which `*` stands for any run of characters, `/` included.
export function branchMatches(pattern: string, branch: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(branch);
}

export interface GitHubTriggerConfig {
  event: string;
  actions?: string[];
  branches?: string[];
}

// Whether a delivery is one the trigger subscribed to. A trigger with a branch filter never
// matches an event without a branch.
export function deliveryMatches(
  config: GitHubTriggerConfig,
  event: string,
  payload: Payload,
): boolean {
  if (config.event !== event) return false;
  const action = field(payload, 'action');
  if (config.actions && !(typeof action === 'string' && config.actions.includes(action)))
    return false;
  if (config.branches) {
    const branches = githubEvents[event]?.branches(payload) ?? [];
    if (!branches.some((branch) => config.branches!.some((p) => branchMatches(p, branch))))
      return false;
  }
  return true;
}

// The commit a checks or status event is about: Wait for Checks steps watching it read again now.
export function checkedCommit(event: string, payload: Payload): string | null {
  const sha =
    event === 'check_run'
      ? field(payload, 'check_run', 'head_sha')
      : event === 'check_suite'
        ? field(payload, 'check_suite', 'head_sha')
        : event === 'status'
          ? field(payload, 'sha')
          : undefined;
  return typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

export { field as payloadField };
