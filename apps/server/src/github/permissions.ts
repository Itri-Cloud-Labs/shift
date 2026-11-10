import type { Json } from '../harness/types.js';
import type { Permissions } from './api.js';

// The least an installation must grant for each GitHub node (server specification 12.3). A node
// asks for nothing it does not use, and its installation token is minted with exactly these.
export const nodePermissions: Record<string, Permissions> = {
  github_get_pr: { metadata: 'read', pull_requests: 'read' },
  github_create_pr: { metadata: 'read', pull_requests: 'write' },
  github_update_pr: { metadata: 'read', pull_requests: 'write' },
  github_verify_checks: { metadata: 'read', checks: 'read', statuses: 'read' },
  github_wait_checks: { metadata: 'read', checks: 'read', statuses: 'read' },
  // GitHub's merge endpoint needs contents write; reading the pull request needs pull requests.
  github_merge: { metadata: 'read', contents: 'write', pull_requests: 'write' },
  // Git Push only when it is configured to push with the App.
  git_push: { metadata: 'read', contents: 'write' },
};

export const githubTypes = new Set([
  'github_get_pr',
  'github_create_pr',
  'github_update_pr',
  'github_verify_checks',
  'github_wait_checks',
  'github_merge',
]);

// What a configured node needs from the project's GitHub connection, or null when it needs none.
export function requiredPermissions(type: string, config: Json): Permissions | null {
  if (type === 'git_push')
    return (config as { transport?: unknown } | null)?.transport === 'github_app'
      ? nodePermissions['git_push']!
      : null;
  return githubTypes.has(type) ? nodePermissions[type]! : null;
}
