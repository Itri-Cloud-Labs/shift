import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import type { ExecutionError } from '../runs/repository.js';
import type { Outcome } from '../actions/outcome.js';
import { GitHubError, type GitHubApi } from './api.js';
import type { Binding } from './integration.js';

// Pull request nodes (server specification sections 8 and 12.3). Reads observe GitHub afresh on
// every attempt. Creating a pull request writes a hidden marker naming its operation into the
// body, so recovery can find exactly the pull request an interrupted attempt opened: one match
// is the known result, none means it was never created, and several need the owner.

export type GitHubAction = 'github_get_pr' | 'github_create_pr' | 'github_update_pr';

export interface GitHubConfig {
  action: GitHubAction;
  // Get: by number, or the pull request whose head is this branch.
  number?: number;
  head?: string;
  // Create and update.
  base?: string;
  title?: string;
  body?: string;
  draft?: boolean;
  state?: 'open' | 'closed';
  safeToRetry: false;
}

export interface Repo {
  id: number;
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface GitHubContext {
  api: GitHubApi;
  binding: Binding;
  signal: AbortSignal;
}

interface ApiPull {
  id: number;
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  merged?: boolean;
  merged_at?: string | null;
  draft?: boolean;
  title: string;
  body: string | null;
  merge_commit_sha: string | null;
  head: { ref: string; sha: string; repo: { id: number } | null };
  base: { ref: string; sha: string; repo: { id: number } };
}

const failure = (
  code: string,
  message: string,
  category: ExecutionError['category'] = 'external',
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

// A GitHub error as the action's failure. Reads and refused writes changed nothing.
export function githubFailure(error: GitHubError): Outcome {
  const category: ExecutionError['category'] =
    error.providerStatus === 401 || error.providerStatus === 403
      ? 'permission'
      : error.providerStatus === 404 || error.providerStatus === 422
        ? 'input'
        : 'external';
  return {
    kind: 'failed',
    error: {
      code: error.code,
      category,
      message: error.message,
      retryDisposition:
        error.providerStatus === null || error.providerStatus >= 500 ? 'safe' : 'never',
      details: error.details,
    },
  };
}

// The part of a mutation's identity that comes from the node: what it was configured to do.
export function githubIdentity(config: GitHubConfig): Json {
  const identity: Record<string, Json> = {};
  for (const field of ['number', 'head', 'base', 'title', 'body', 'draft', 'state'] as const)
    if (config[field] !== undefined) identity[field] = config[field];
  return identity;
}

// A write GitHub may have carried out: it never answered, or it failed on its side. Either way the
// effect is decided from GitHub's records under the same operation, not retried as a new one.
export const mayHaveApplied = (error: GitHubError) =>
  error.providerStatus === null || error.providerStatus >= 500;

export const marker = (operationId: string) => `<!-- shift-operation: ${operationId} -->`;

// The body as stored on GitHub: authored text, then the marker on its own line.
const markedBody = (body: string, operationId: string) =>
  `${body}${body ? '\n\n' : ''}${marker(operationId)}`;

const normalize = (text: string | null) => (text ?? '').replace(/\r\n/g, '\n').trimEnd();

export function pullRequest(repo: Repo, pull: ApiPull): Record<string, Json> {
  return {
    repositoryId: repo.id,
    repository: `${repo.owner}/${repo.name}`,
    number: pull.number,
    id: pull.id,
    url: pull.html_url,
    state: pull.state,
    merged: pull.merged ?? Boolean(pull.merged_at),
    draft: pull.draft ?? false,
    title: pull.title,
    head: { ref: pull.head.ref, sha: pull.head.sha, repositoryId: pull.head.repo?.id ?? null },
    base: { ref: pull.base.ref, sha: pull.base.sha },
    mergeCommitSha: pull.merge_commit_sha,
  };
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

// The bound repository as it is named now: identity is its ID, so a rename or transfer is followed.
export async function resolveRepository(context: GitHubContext): Promise<Repo> {
  const repo = await call<{
    id: number;
    name: string;
    owner: { login: string };
    default_branch: string;
  }>(
    context,
    'GET /repositories/{repository_id}',
    { repository_id: context.binding.repositoryId },
    'Reading the repository',
  );
  if (repo.id !== context.binding.repositoryId)
    throw new ShiftError('GITHUB_REPOSITORY_MISMATCH', 'GitHub returned another repository.', 502);
  return {
    id: repo.id,
    owner: repo.owner.login,
    name: repo.name,
    defaultBranch: repo.default_branch,
  };
}

const maxPages = 10;

async function pulls(
  context: GitHubContext,
  repo: Repo,
  head: string,
  state: 'open' | 'all',
): Promise<ApiPull[]> {
  const found: ApiPull[] = [];
  for (let page = 1; ; page++) {
    // A partial list would let recovery miss its own pull request and create another, so a
    // branch with more than Shift reads is an error, never a guess.
    if (page > maxPages)
      throw new GitHubError(
        'GITHUB_TOO_MANY_RESULTS',
        `Branch ${head} has more than ${maxPages * 100} pull requests; Shift cannot read them all.`,
        422,
        422,
        false,
      );
    const batch = await call<ApiPull[]>(
      context,
      'GET /repos/{owner}/{repo}/pulls',
      {
        owner: repo.owner,
        repo: repo.name,
        head: `${repo.owner}:${head}`,
        state,
        per_page: 100,
        page,
      },
      'Listing pull requests',
    );
    // Only pull requests from this repository's own branch.
    found.push(...batch.filter((pull) => pull.head.ref === head && pull.head.repo?.id === repo.id));
    if (batch.length < 100) break;
  }
  return found;
}

export async function getPull(
  context: GitHubContext,
  repo: Repo,
  number: number,
): Promise<ApiPull> {
  return call<ApiPull>(
    context,
    'GET /repos/{owner}/{repo}/pulls/{pull_number}',
    { owner: repo.owner, repo: repo.name, pull_number: number },
    `Reading pull request #${number}`,
  );
}

export async function getPr(
  config: GitHubConfig,
  context: GitHubContext,
  repo: Repo,
): Promise<Outcome> {
  if (config.number !== undefined) {
    try {
      return {
        kind: 'succeeded',
        data: pullRequest(repo, await getPull(context, repo, config.number)),
      };
    } catch (error) {
      if (error instanceof GitHubError && error.providerStatus === 404)
        return failure('PR_NOT_FOUND', `There is no pull request #${config.number}.`, 'input');
      throw error;
    }
  }
  const head = config.head!;
  const open = await pulls(context, repo, head, 'open');
  const candidates = open.length > 0 ? open : await pulls(context, repo, head, 'all');
  if (candidates.length === 0)
    return failure('PR_NOT_FOUND', `No pull request has ${head} as its head branch.`, 'input');
  // Several open pull requests from one branch (into different bases), or none open and several
  // closed: picking one would be a guess.
  if (open.length > 1 || (open.length === 0 && candidates.length > 1))
    return failure(
      'PR_AMBIGUOUS',
      `${candidates.length} pull requests have ${head} as their head branch. Find the pull request by number.`,
      'input',
      { numbers: candidates.map((pull) => pull.number) },
    );
  return { kind: 'succeeded', data: pullRequest(repo, candidates[0]!) };
}

export type Plan =
  | { kind: 'ready'; args: Record<string, Json>; evidence: Record<string, Json> }
  | { kind: 'done'; outcome: Outcome };

export function planPr(config: GitHubConfig, repo: Repo): Plan {
  if (config.action === 'github_create_pr') {
    const head = config.head!;
    const base = config.base ?? repo.defaultBranch;
    if (head === base)
      return {
        kind: 'done',
        outcome: failure('INVALID_ARGUMENT', 'The head and base branches are the same.', 'input'),
      };
    return {
      kind: 'ready',
      args: {
        repositoryId: repo.id,
        head,
        base,
        title: config.title!,
        body: config.body ?? '',
        draft: config.draft === true,
      },
      evidence: {},
    };
  }
  const args: Record<string, Json> = { repositoryId: repo.id, number: config.number! };
  for (const field of ['title', 'body', 'base', 'state'] as const)
    if (config[field] !== undefined) args[field] = config[field];
  return { kind: 'ready', args, evidence: {} };
}

// The pull requests from the head branch whose body carries this operation's marker.
async function marked(
  context: GitHubContext,
  repo: Repo,
  head: string,
  operationId: string,
): Promise<ApiPull[]> {
  const tag = marker(operationId);
  return (await pulls(context, repo, head, 'all')).filter((pull) =>
    (pull.body ?? '').includes(tag),
  );
}

export async function performPr(
  config: GitHubConfig,
  context: GitHubContext,
  repo: Repo,
  args: Record<string, Json>,
  operationId: string,
): Promise<Outcome> {
  if (config.action === 'github_create_pr') {
    const head = args['head'] as string;
    try {
      const pull = await call<ApiPull>(
        context,
        'POST /repos/{owner}/{repo}/pulls',
        {
          owner: repo.owner,
          repo: repo.name,
          head,
          base: args['base'],
          title: args['title'],
          body: markedBody(args['body'] as string, operationId),
          draft: args['draft'],
        },
        'Creating the pull request',
      );
      return { kind: 'succeeded', data: pullRequest(repo, pull) };
    } catch (error) {
      if (!(error instanceof GitHubError)) throw error;
      // No answer, or a server error that may have come after the change was made: whether it
      // was created is decided from GitHub's records under this operation, never assumed.
      if (mayHaveApplied(error))
        return (await reconcileCreate(context, repo, args, operationId, false)) as Outcome;
      // Refused: perhaps because an earlier submission of this operation already created it.
      if (error.providerStatus === 422) {
        const found = await marked(context, repo, head, operationId);
        if (found.length === 1) return { kind: 'succeeded', data: pullRequest(repo, found[0]!) };
      }
      return githubFailure(error);
    }
  }
  const number = args['number'] as number;
  const fields: Record<string, unknown> = {};
  for (const field of ['title', 'body', 'base', 'state'] as const)
    if (args[field] !== undefined) fields[field] = args[field];
  try {
    const pull = await call<ApiPull>(
      context,
      'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner: repo.owner, repo: repo.name, pull_number: number, ...fields },
      `Updating pull request #${number}`,
    );
    return { kind: 'succeeded', data: pullRequest(repo, pull) };
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    if (mayHaveApplied(error)) {
      const settled = await reconcileUpdate(context, repo, args);
      return settled.kind === 'redo'
        ? { kind: 'uncertain', explanation: `GitHub did not answer the update of #${number}.` }
        : settled;
    }
    if (error.providerStatus === 404)
      return failure('PR_NOT_FOUND', `There is no pull request #${number}.`, 'input');
    return githubFailure(error);
  }
}

// Decides from GitHub what an interrupted create did. With `redo`, none of its pull requests
// exists, so it can be sent again as recorded: GitHub refuses a second open pull request for the
// same head and base, and that refusal is checked against the marker again.
export async function reconcileCreate(
  context: GitHubContext,
  repo: Repo,
  args: Record<string, Json>,
  operationId: string,
  allowRedo = true,
): Promise<Outcome | { kind: 'redo' }> {
  let found: ApiPull[];
  try {
    found = await marked(context, repo, args['head'] as string, operationId);
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    return {
      kind: 'uncertain',
      explanation: 'GitHub could not be read to check whether the pull request was created.',
    };
  }
  if (found.length === 1) return { kind: 'succeeded', data: pullRequest(repo, found[0]!) };
  if (found.length > 1)
    return {
      kind: 'uncertain',
      explanation: `${found.length} pull requests carry this step's marker (${found.map((pull) => `#${pull.number}`).join(', ')}). Choose which is the step's result.`,
      evidence: { matches: found.map((pull) => pull.number) },
    };
  if (allowRedo) return { kind: 'redo' };
  return {
    kind: 'uncertain',
    explanation:
      'GitHub did not answer, and no pull request with this step’s marker exists yet. Retrying sends the same request; GitHub refuses a duplicate open pull request for the branch.',
  };
}

// An update sets fields to fixed values, so reading the pull request shows whether it landed and
// sending it again is the same request.
export async function reconcileUpdate(
  context: GitHubContext,
  repo: Repo,
  args: Record<string, Json>,
): Promise<Outcome | { kind: 'redo' }> {
  let pull: ApiPull;
  try {
    pull = await getPull(context, repo, args['number'] as number);
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    return { kind: 'uncertain', explanation: 'GitHub could not be read to check the update.' };
  }
  const matches =
    (args['title'] === undefined || pull.title === args['title']) &&
    (args['body'] === undefined || normalize(pull.body) === normalize(args['body'] as string)) &&
    (args['base'] === undefined || pull.base.ref === args['base']) &&
    (args['state'] === undefined || pull.state === args['state']);
  return matches ? { kind: 'succeeded', data: pullRequest(repo, pull) } : { kind: 'redo' };
}
