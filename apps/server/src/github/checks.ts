import type { Json } from '../harness/types.js';
import type { ExecutionError } from '../runs/repository.js';
import type { Outcome } from '../actions/outcome.js';
import { GitHubError } from './api.js';
import {
  getPull,
  githubFailure,
  mayHaveApplied,
  type GitHubContext,
  type Repo,
} from './actions.js';

// Checks and merges (server specification sections 8 and 12.3). Verify and Wait read the checks
// of one explicitly resolved commit: check runs and commit statuses, latest per name. Nothing here
// decides whether a pull request may merge; the author's graph does, and Merge acts immediately.

export type CheckState = 'pending' | 'success' | 'failure';

export interface CheckEntry {
  name: string;
  source: 'check_run' | 'status';
  state: CheckState;
  // GitHub's own words: a check run's conclusion or status, a commit status's state.
  conclusion: string | null;
  url: string | null;
}

export interface CheckSummary {
  commit: string;
  // `none` when no check reported anything for the commit.
  state: CheckState | 'none';
  checks: CheckEntry[];
  // Required names nothing reported yet.
  missing: string[];
  counts: { success: number; failure: number; pending: number };
}

const passing = new Set(['success', 'neutral', 'skipped']);

interface ApiCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string | null;
  completed_at?: string | null;
  started_at?: string | null;
}
interface ApiStatus {
  context: string;
  state: string;
  target_url?: string | null;
  updated_at?: string;
}

async function call<T>(
  context: GitHubContext,
  route: string,
  parameters: Record<string, unknown>,
  what: string,
): Promise<T> {
  const { api, binding, signal } = context;
  return api.asInstallation<T>(
    binding.keys,
    binding.installationId,
    { repositoryIds: [binding.repositoryId], permissions: binding.permissions },
    route,
    parameters,
    what,
    signal,
  );
}

// Reads every check run and status of `commit` now and summarizes them. With `required`, only
// those names count, and one nothing reported keeps the summary pending.
export async function readChecks(
  context: GitHubContext,
  repo: Repo,
  commit: string,
  required: readonly string[] = [],
): Promise<CheckSummary> {
  const runs: ApiCheckRun[] = [];
  for (let page = 1; ; page++) {
    // A partial list could hide a failing check, so too many is an error rather than a summary.
    if (page > 10)
      throw new GitHubError(
        'GITHUB_TOO_MANY_RESULTS',
        `Commit ${commit.slice(0, 12)} has more than 1000 check runs; Shift cannot read them all.`,
        422,
        422,
        false,
      );
    const batch = await call<{ check_runs: ApiCheckRun[] }>(
      context,
      'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
      { owner: repo.owner, repo: repo.name, ref: commit, per_page: 100, page, filter: 'latest' },
      'Reading check runs',
    );
    runs.push(...batch.check_runs);
    if (batch.check_runs.length < 100) break;
  }
  const combined = await call<{ statuses: ApiStatus[]; total_count?: number }>(
    context,
    'GET /repos/{owner}/{repo}/commits/{ref}/status',
    { owner: repo.owner, repo: repo.name, ref: commit, per_page: 100 },
    'Reading commit statuses',
  );
  if ((combined.total_count ?? combined.statuses.length) > combined.statuses.length)
    throw new GitHubError(
      'GITHUB_TOO_MANY_RESULTS',
      `Commit ${commit.slice(0, 12)} has more than ${combined.statuses.length} statuses; Shift cannot read them all.`,
      422,
      422,
      false,
    );
  // Keyed by source and name: a check run and a commit status may share a name, and each counts,
  // so a passing one can never hide a failing one.
  const entries = new Map<string, CheckEntry>();
  // The newest run of each name decides; GitHub lists newer runs first.
  for (const run of runs) {
    if (entries.has(`check_run:${run.name}`)) continue;
    entries.set(`check_run:${run.name}`, {
      name: run.name,
      source: 'check_run',
      state:
        run.status !== 'completed'
          ? 'pending'
          : passing.has(run.conclusion ?? '')
            ? 'success'
            : 'failure',
      conclusion: run.status === 'completed' ? run.conclusion : run.status,
      url: run.html_url ?? null,
    });
  }
  // The combined status already holds only the latest state per context.
  for (const status of combined.statuses) {
    if (entries.has(`status:${status.context}`)) continue;
    entries.set(`status:${status.context}`, {
      name: status.context,
      source: 'status',
      state:
        status.state === 'success' ? 'success' : status.state === 'pending' ? 'pending' : 'failure',
      conclusion: status.state,
      url: status.target_url ?? null,
    });
  }
  const all = [...entries.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source),
  );
  const watched = required.length ? all.filter((entry) => required.includes(entry.name)) : all;
  const missing = required.filter((name) => !all.some((entry) => entry.name === name));
  const counts = { success: 0, failure: 0, pending: missing.length };
  for (const entry of watched) counts[entry.state]++;
  const state: CheckSummary['state'] =
    counts.failure > 0
      ? 'failure'
      : counts.pending > 0
        ? 'pending'
        : watched.length === 0
          ? 'none'
          : 'success';
  return { commit, state, checks: watched, missing, counts };
}

export interface MergeConfig {
  number: number;
  method: 'merge' | 'squash' | 'rebase';
  expectedCommit?: string;
  title?: string;
  message?: string;
}

const failure = (
  code: string,
  message: string,
  category: ExecutionError['category'],
  details?: Json,
): Outcome => ({
  kind: 'failed',
  error: {
    code,
    category,
    message,
    retryDisposition: 'never',
    ...(details === undefined ? {} : { details }),
  },
});

// What the merge will act on, read for recovery evidence only: Shift does not decide from it
// whether to merge. GitHub does, when the request arrives.
export async function planMerge(
  config: MergeConfig,
  context: GitHubContext,
  repo: Repo,
): Promise<
  | { kind: 'ready'; args: Record<string, Json>; evidence: Record<string, Json> }
  | { kind: 'done'; outcome: Outcome }
> {
  let pull;
  try {
    pull = await getPull(context, repo, config.number);
  } catch (error) {
    if (error instanceof GitHubError && error.providerStatus === 404)
      return {
        kind: 'done',
        outcome: failure('PR_NOT_FOUND', `There is no pull request #${config.number}.`, 'input'),
      };
    throw error;
  }
  const args: Record<string, Json> = {
    repositoryId: repo.id,
    number: config.number,
    method: config.method,
  };
  if (config.expectedCommit) args['sha'] = config.expectedCommit;
  if (config.title !== undefined) args['title'] = config.title;
  if (config.message !== undefined) args['message'] = config.message;
  return {
    kind: 'ready',
    args,
    evidence: { headSha: pull.head.sha, wasMerged: pull.merged ?? Boolean(pull.merged_at) },
  };
}

const merged = (repo: Repo, number: number, method: string, sha: string | null, head: string) => ({
  kind: 'succeeded' as const,
  data: {
    repositoryId: repo.id,
    number,
    merged: true,
    method,
    mergeCommitSha: sha,
    headSha: head,
  },
});

export async function performMerge(
  context: GitHubContext,
  repo: Repo,
  args: Record<string, Json>,
  evidence: Record<string, Json>,
): Promise<Outcome> {
  const number = args['number'] as number;
  try {
    const result = await call<{ sha: string; merged: boolean }>(
      context,
      'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
      {
        owner: repo.owner,
        repo: repo.name,
        pull_number: number,
        merge_method: args['method'],
        ...(args['sha'] !== undefined ? { sha: args['sha'] } : {}),
        ...(args['title'] !== undefined ? { commit_title: args['title'] } : {}),
        ...(args['message'] !== undefined ? { commit_message: args['message'] } : {}),
      },
      `Merging pull request #${number}`,
    );
    return merged(
      repo,
      number,
      args['method'] as string,
      result.sha,
      (args['sha'] as string | undefined) ?? (evidence['headSha'] as string),
    );
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    // No answer, or a server error that may have come after the merge: decided from GitHub.
    if (mayHaveApplied(error)) {
      const settled = await reconcileMerge(context, repo, args, evidence);
      return settled.kind === 'redo'
        ? {
            kind: 'uncertain',
            explanation: `GitHub did not answer the merge of #${number}, and the pull request is not merged yet.`,
          }
        : settled;
    }
    // A protection rule, a moved head, a conflict: GitHub's refusal is the step's error.
    return githubFailure(error);
  }
}

// Decides from the pull request what an interrupted merge did. Merged by this step: merged now,
// not before, with the head the step expected. Not merged and the head unchanged: the same request
// can be sent again, and GitHub decides again. Anything else needs the owner.
export async function reconcileMerge(
  context: GitHubContext,
  repo: Repo,
  args: Record<string, Json>,
  evidence: Record<string, Json>,
): Promise<Outcome | { kind: 'redo' }> {
  const number = args['number'] as number;
  let pull;
  try {
    pull = await getPull(context, repo, number);
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    return { kind: 'uncertain', explanation: 'GitHub could not be read to check the merge.' };
  }
  const expectedHead = (args['sha'] as string | undefined) ?? (evidence['headSha'] as string);
  const isMerged = pull.merged ?? Boolean(pull.merged_at);
  if (isMerged && !evidence['wasMerged'] && pull.head.sha === expectedHead)
    return merged(repo, number, args['method'] as string, pull.merge_commit_sha, pull.head.sha);
  if (!isMerged && pull.head.sha === expectedHead) return { kind: 'redo' };
  return {
    kind: 'uncertain',
    explanation: isMerged
      ? `#${number} is merged, but with head ${pull.head.sha.slice(0, 12)} rather than ${expectedHead.slice(0, 12)}${evidence['wasMerged'] ? ', and it was merged before this step' : ''}.`
      : `#${number}'s head moved from ${expectedHead.slice(0, 12)} to ${pull.head.sha.slice(0, 12)} while the merge was in doubt.`,
    evidence: { observedHead: pull.head.sha, merged: isMerged },
  };
}
