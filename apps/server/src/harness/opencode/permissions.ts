import type { ToolPolicy } from '../types.js';

export interface PermissionRule {
  action: string;
  resource: string;
  effect: 'allow' | 'deny' | 'ask';
}

// OpenCode evaluates the agent's rules, then the session's, and the last matching rule wins.
// Re-emitting the agent defaults with `ask` turned into `deny` keeps their ordering (for example
// `*.env.example` stays readable after `*.env.*`) while nothing can wait for an absent human.
// Denying `edit` alone is not read-only, because the shell can still write files.
export function compilePermissions(
  agentDefaults: readonly PermissionRule[],
  policy: ToolPolicy,
  artifactDirectory?: string,
): PermissionRule[] {
  const rules: PermissionRule[] = agentDefaults.map((rule) =>
    rule.effect === 'ask' ? { ...rule, effect: 'deny' } : { ...rule },
  );
  rules.push({ action: 'question', resource: '*', effect: 'deny' });
  if (policy.mode === 'read_only') {
    rules.push(
      { action: 'edit', resource: '*', effect: 'deny' },
      { action: 'shell', resource: '*', effect: 'deny' },
    );
  }
  if (artifactDirectory !== undefined) {
    rules.push({ action: 'edit', resource: `${artifactDirectory}/*`, effect: 'allow' });
  }
  return rules;
}
