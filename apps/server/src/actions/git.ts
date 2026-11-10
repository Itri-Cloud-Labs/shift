import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import type { ExecutionError } from '../runs/repository.js';
import type { GitConfig } from './config.js';
import type { Outcome } from './outcome.js';
import type { ProcessRunner } from './process.js';

// Deterministic Git operations in a run's worktree (specification sections 7, 8 and 11.2). Every
// call uses an argument array and `--end-of-options` where Git accepts it, so no configured or
// generated value is read as an option. Mutations record what they expect to find and what they
// will produce before they change anything, so recovery can tell a finished operation from one
// that never happened, and anything else from both.

const run = promisify(execFile);

// How Git reaches a remote. The host transport uses the owner's own SSH agent and credential
// helpers; the GitHub App transport supplies a temporary credential helper instead. Neither may
// put a token into a URL, an argument, the repository's configuration or a log.
export interface GitTransport {
  environment(): Record<string, string>;
  configArgs(): string[];
}

export const hostTransport: GitTransport = {
  environment: () => ({}),
  configArgs: () => [],
};

// Authenticates HTTPS Git with an installation token for this one command. The helper reads the
// token from the command's environment, so it never appears in arguments, and `credential.helper=`
// first empties the helper list, so none of the owner's helpers is asked or told to store it.
export function appTransport(token: string): GitTransport {
  return {
    environment: () => ({ SHIFT_GIT_TOKEN: token, GIT_ASKPASS: '', SSH_ASKPASS: '' }),
    configArgs: () => [
      '-c',
      'credential.helper=',
      '-c',
      `credential.helper=!f() { test "$1" = get && printf 'username=x-access-token\\npassword=%s\\n' "$SHIFT_GIT_TOKEN"; }; f`,
      '-c',
      'credential.interactive=never',
      '-c',
      'core.askPass=',
    ],
  };
}

export interface GitContext {
  cwd: string;
  baseCommit: string;
  env: Record<string, string>;
  transport: GitTransport;
  // Push to this remote instead of a named one of the workspace's, such as the project's GitHub
  // repository; the URL carries no credentials.
  remote?: { name: string; url: string };
  runner?: ProcessRunner;
  signal: AbortSignal;
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

export class GitError extends ShiftError {
  constructor(
    code: string,
    message: string,
    readonly stderr = '',
  ) {
    super(code, message, 422);
  }
}

export async function git(
  context: Pick<GitContext, 'cwd' | 'env'>,
  args: string[],
  options: { input?: string; env?: Record<string, string>; maxBuffer?: number } = {},
): Promise<string> {
  try {
    const child = run('git', args, {
      cwd: context.cwd,
      env: {
        ...context.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C',
        ...options.env,
      },
      maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
      timeout: 60_000,
      encoding: 'utf8',
    });
    if (options.input !== undefined) child.child.stdin?.end(options.input);
    return (await child).stdout;
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').slice(0, 4000);
    throw new GitError(
      'GIT_FAILED',
      `git ${args[0]} failed: ${stderr.trim() || 'no output'}`,
      stderr,
    );
  }
}

const trim = (text: string) => text.trim();

async function head(context: GitContext): Promise<{ commit: string; branch: string | null }> {
  const commit = trim(await git(context, ['rev-parse', '--verify', 'HEAD^{commit}']));
  const symbolic = await git(context, ['symbolic-ref', '--quiet', 'HEAD']).catch(() => '');
  const ref = trim(symbolic);
  return { commit, branch: ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null };
}

// A branch name Git accepts and that cannot be read as an option or a revision range.
export async function checkBranch(context: GitContext, name: string): Promise<string | null> {
  if (name.startsWith('-') || name.length > 200 || /[\0\s]/.test(name))
    return `${JSON.stringify(name.slice(0, 100))} is not a valid branch name.`;
  try {
    await git(context, ['check-ref-format', '--branch', name]);
    return null;
  } catch {
    return `${JSON.stringify(name.slice(0, 100))} is not a valid branch name.`;
  }
}

async function branchCommit(context: GitContext, name: string): Promise<string | null> {
  const out = await git(context, [
    'rev-parse',
    '--verify',
    '--quiet',
    '--end-of-options',
    `refs/heads/${name}^{commit}`,
  ]).catch(() => '');
  return trim(out) || null;
}

// The part of a mutation's identity that comes from the node: what it was configured to do.
export function gitIdentity(config: GitConfig): Json {
  switch (config.action) {
    case 'git_create_branch':
      return { name: config.name ?? null };
    case 'git_commit':
      return { message: config.message ?? null, allowEmpty: config.allowEmpty === true };
    case 'git_push':
      return {
        remote: config.remote ?? 'origin',
        branch: config.branch ?? null,
        remoteBranch: config.remoteBranch ?? null,
        ...(config.transport === 'github_app' ? { transport: 'github_app' } : {}),
      };
    default:
      return null;
  }
}

// ---- Reads: a fresh observation every time, never an effect operation. ----

interface StatusEntry {
  path: string;
  index: string;
  worktree: string;
  from?: string;
}

async function statusEntries(context: GitContext): Promise<StatusEntry[]> {
  const out = await git(context, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const fields = out.split('\0');
  const entries: StatusEntry[] = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!;
    if (field.length < 4) continue;
    const entry: StatusEntry = { index: field[0]!, worktree: field[1]!, path: field.slice(3) };
    // A rename or copy is followed by the path it came from.
    if (entry.index === 'R' || entry.index === 'C') entry.from = fields[++index] ?? '';
    entries.push(entry);
  }
  return entries;
}

export async function gitStatus(config: GitConfig, context: GitContext): Promise<Outcome> {
  const current = await head(context);
  const entries = await statusEntries(context);
  const limit = config.maxEntries ?? 1000;
  return {
    kind: 'succeeded',
    data: {
      baseCommit: context.baseCommit,
      head: current.commit,
      branch: current.branch,
      clean: entries.length === 0,
      entries: entries.slice(0, limit) as unknown as Json,
      entryCount: entries.length,
      entriesTruncated: entries.length > limit,
    },
  };
}

export async function gitDiff(config: GitConfig, context: GitContext): Promise<Outcome> {
  const current = await head(context);
  const against = config.against === 'head' ? current.commit : context.baseCommit;
  const paths = config.paths ?? [];
  const pathArgs = paths.length ? ['--', ...paths.map((path) => `:(literal)${path}`)] : [];
  const limit = config.maxBytes ?? 256 * 1024;
  const diff = await git(context, ['diff', '--no-color', '--no-ext-diff', against, ...pathArgs], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const numstat = await git(context, ['diff', '--numstat', '-z', against, ...pathArgs], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const files: Array<{ path: string; additions: number | null; deletions: number | null }> = [];
  const parts = numstat.split('\0');
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (!part) continue;
    const [additions, deletions, path] = part.split('\t');
    // A rename lists its old and new path as the next two fields.
    const name = path === '' ? `${parts[++index]} -> ${parts[++index]}` : path!;
    files.push({
      path: name,
      additions: additions === '-' ? null : Number(additions),
      deletions: deletions === '-' ? null : Number(deletions),
    });
  }
  const untracked = (await statusEntries(context))
    .filter((entry) => entry.index === '?')
    .map((entry) => entry.path)
    .filter(
      (path) =>
        paths.length === 0 ||
        paths.some((wanted) => path === wanted || path.startsWith(`${wanted.replace(/\/$/, '')}/`)),
    );
  const bytes = Buffer.byteLength(diff);
  return {
    kind: 'succeeded',
    data: {
      against,
      head: current.commit,
      branch: current.branch,
      diff: bytes > limit ? Buffer.from(diff).subarray(0, limit).toString('utf8') : diff,
      diffBytes: bytes,
      truncated: bytes > limit,
      files: files as unknown as Json,
      untracked,
    },
  };
}

// ---- Mutations: prepared, then performed under a submitted operation. ----

export type Plan =
  | { kind: 'ready'; args: Record<string, Json>; evidence: Record<string, Json> }
  | { kind: 'done'; outcome: Outcome };

// What a mutation will do, decided before anything changes. The arguments become the operation's
// fixed identity; the evidence is what recovery compares against.
export async function planGit(config: GitConfig, context: GitContext): Promise<Plan> {
  const current = await head(context);
  switch (config.action) {
    case 'git_create_branch': {
      const problem = await checkBranch(context, config.name!);
      if (problem) return { kind: 'done', outcome: failure('INVALID_BRANCH', problem, 'input') };
      return {
        kind: 'ready',
        args: { name: config.name! },
        evidence: { head: current.commit, previousBranch: current.branch },
      };
    }
    case 'git_commit': {
      await git(context, ['add', '--all']);
      const tree = trim(await git(context, ['write-tree']));
      const parentTree = trim(await git(context, ['rev-parse', '--verify', 'HEAD^{tree}']));
      if (tree === parentTree && !config.allowEmpty)
        return {
          kind: 'done',
          outcome: failure(
            'NOTHING_TO_COMMIT',
            'The workspace has no changes to commit.',
            'input',
            {
              head: current.commit,
            },
          ),
        };
      // A fixed date makes the commit's ID a function of what was recorded, so recovery can
      // recognize it.
      const date = `${Math.floor(Date.now() / 1000)} +0000`;
      const dated = { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
      let commit: string;
      try {
        commit = trim(
          await git(context, ['commit-tree', tree, '-p', current.commit, '-F', '-'], {
            input: config.message!,
            env: dated,
          }),
        );
      } catch (error) {
        const stderr = (error as GitError).stderr ?? '';
        if (/identity|user\.(name|email)|empty ident/i.test(stderr))
          return {
            kind: 'done',
            outcome: failure(
              'GIT_IDENTITY_MISSING',
              'Git has no author identity. Set user.name and user.email for the repository or account.',
              'input',
            ),
          };
        throw error;
      }
      return {
        kind: 'ready',
        args: { message: config.message!, allowEmpty: config.allowEmpty === true },
        evidence: {
          parent: current.commit,
          tree,
          commit,
          date,
          branch: current.branch,
        },
      };
    }
    case 'git_push': {
      const branch = config.branch ?? current.branch;
      if (!branch)
        return {
          kind: 'done',
          outcome: failure(
            'DETACHED_HEAD',
            'The workspace is not on a branch. Create one first or name the branch to push.',
            'input',
          ),
        };
      for (const name of [branch, config.remoteBranch ?? branch]) {
        const problem = await checkBranch(context, name);
        if (problem) return { kind: 'done', outcome: failure('INVALID_BRANCH', problem, 'input') };
      }
      const remote = context.remote?.name ?? config.remote ?? 'origin';
      const url = context.remote ? context.remote.url : await remoteUrl(context, remote);
      if (typeof url !== 'string') return { kind: 'done', outcome: url };
      const commit = await branchCommit(context, branch);
      if (!commit)
        return {
          kind: 'done',
          outcome: failure('BRANCH_NOT_FOUND', `There is no branch ${branch} to push.`, 'input'),
        };
      const remoteRef = `refs/heads/${config.remoteBranch ?? branch}`;
      const before = await remoteHead(context, url, remoteRef);
      if (typeof before !== 'string' && before !== null) return { kind: 'done', outcome: before };
      return {
        kind: 'ready',
        // The commit is part of the identity: pushing another commit is another operation.
        args: { remote, branch, remoteRef, commit },
        evidence: { before, url },
      };
    }
    default:
      throw new ShiftError('UNSUPPORTED_NODE', `${config.action} is not a Git mutation.`, 422);
  }
}

// The remote's URL without any user information. A URL that carries a password or token is
// refused: Shift never sends or records a credential that way.
async function remoteUrl(context: GitContext, remote: string): Promise<string | Outcome> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(remote))
    return failure(
      'INVALID_REMOTE',
      `${JSON.stringify(remote.slice(0, 100))} is not a remote name.`,
      'input',
    );
  let urls: string[];
  try {
    // Where `git push` sends: the push URL when one is configured, otherwise the fetch URL.
    urls = (await git(context, ['remote', 'get-url', '--push', '--all', '--', remote]))
      .split('\n')
      .map(trim)
      .filter(Boolean);
  } catch {
    return failure('REMOTE_NOT_FOUND', `The repository has no remote ${remote}.`, 'input');
  }
  if (urls.length !== 1)
    return failure(
      'MULTIPLE_PUSH_URLS',
      `Remote ${remote} pushes to ${urls.length} places. Shift pushes to exactly one, so it can check what landed.`,
      'input',
    );
  const url = urls[0]!;
  try {
    const parsed = new URL(url);
    if (parsed.password || (/^https?:$/.test(parsed.protocol) && parsed.username))
      return failure(
        'REMOTE_URL_HAS_CREDENTIALS',
        `Remote ${remote} has credentials in its push URL. Use a credential helper or SSH instead.`,
        'permission',
      );
  } catch {
    // scp-like SSH addresses and local paths are not URLs and carry no password.
  }
  // Pushed to and observed at this exact address, so the push and every check of it agree.
  return url;
}

// The commit `ref` points at on the remote, null when it does not exist.
async function remoteHead(
  context: GitContext,
  remote: string,
  ref: string,
): Promise<string | null | Outcome> {
  try {
    const out = await git(
      { ...context, env: { ...context.env, ...context.transport.environment() } },
      [...context.transport.configArgs(), 'ls-remote', '--end-of-options', remote, ref],
    );
    const line = out.split('\n').find((candidate) => candidate.endsWith(`\t${ref}`));
    return line ? line.split('\t')[0]! : null;
  } catch (error) {
    return {
      kind: 'failed',
      error: {
        code: 'REMOTE_UNREACHABLE',
        category: 'external',
        message: `Shift could not read ${ref} on ${remote}: ${(error as GitError).stderr?.trim().slice(0, 500) || 'no output'}`,
        retryDisposition: 'safe',
      },
    };
  }
}

export async function performGit(
  config: GitConfig,
  context: GitContext,
  args: Record<string, Json>,
  evidence: Record<string, Json>,
): Promise<Outcome> {
  switch (config.action) {
    case 'git_create_branch': {
      const name = args['name'] as string;
      if (await branchCommit(context, name))
        return failure('BRANCH_EXISTS', `Branch ${name} already exists.`, 'input', {
          branch: name,
        });
      try {
        // Keeps the worktree's changes: a branch can be named after the edits were made.
        await git(context, ['switch', '--create', name]);
      } catch (error) {
        return failure('GIT_FAILED', (error as Error).message);
      }
      return { kind: 'succeeded', data: { branch: name, commit: evidence['head'] as string } };
    }
    case 'git_commit': {
      const parent = evidence['parent'] as string;
      const commit = evidence['commit'] as string;
      try {
        // Compare-and-swap: the commit lands only if HEAD is still the recorded parent.
        await git(context, ['update-ref', '-m', 'shift: commit', 'HEAD', commit, parent]);
      } catch {
        const now = await head(context);
        if (now.commit !== commit)
          return failure(
            'GIT_HEAD_MOVED',
            `HEAD moved from ${parent.slice(0, 12)} to ${now.commit.slice(0, 12)} while the commit was being made.`,
            'external',
            { expected: parent, actual: now.commit },
          );
      }
      return commitResult(evidence, args);
    }
    case 'git_push': {
      const remote = args['remote'] as string;
      const ref = args['remoteRef'] as string;
      const commit = args['commit'] as string;
      if (!context.runner)
        throw new ShiftError('ACTION_CONTAINMENT_UNAVAILABLE', 'No runner.', 503);
      const result = await context.runner.run({
        unit: evidence['unit'] as string,
        command: 'git',
        args: [
          ...context.transport.configArgs(),
          'push',
          '--porcelain',
          '--end-of-options',
          evidence['url'] as string,
          `${commit}:${ref}`,
        ],
        cwd: context.cwd,
        env: {
          ...context.env,
          ...context.transport.environment(),
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C',
        },
        timeoutMs: config.timeoutMs ?? 5 * 60 * 1000,
        maxOutputBytes: 16 * 1024,
        signal: context.signal,
      });
      if (result.stopped) return { kind: 'stopped' };
      // The remote says what happened, whatever the exit code: a ref is updated or it is not.
      const after = await remoteHead(context, evidence['url'] as string, ref);
      const output = { stdout: result.stdout.text, stderr: result.stderr.text } as Json;
      if (after === commit)
        return {
          kind: 'succeeded',
          data: {
            remote,
            remoteRef: ref,
            commit,
            before: evidence['before'] ?? null,
            url: evidence['url'] ?? null,
          },
        };
      if (typeof after !== 'string' && after !== null)
        return {
          kind: 'uncertain',
          explanation: `The push ended and the remote could not be read to confirm it.`,
        };
      if (result.timedOut)
        return failure(
          'GIT_PUSH_TIMED_OUT',
          'The push timed out and the remote does not have the commit.',
          'external',
          output,
        );
      const rejected = /\[rejected\]|non-fast-forward|fetch first|stale info/.test(
        `${result.stdout.text}\n${result.stderr.text}`,
      );
      return failure(
        rejected ? 'GIT_PUSH_REJECTED' : 'GIT_PUSH_FAILED',
        rejected
          ? `The remote refused ${ref}; it has commits this branch does not.`
          : `The push failed: ${result.stderr.text.trim().slice(0, 500) || `exit ${result.exitCode}`}`,
        'external',
        output,
      );
    }
    default:
      throw new ShiftError('UNSUPPORTED_NODE', `${config.action} is not a Git mutation.`, 422);
  }
}

function commitResult(evidence: Record<string, Json>, args: Record<string, Json>): Outcome {
  return {
    kind: 'succeeded',
    data: {
      commit: evidence['commit'] as string,
      parent: evidence['parent'] as string,
      tree: evidence['tree'] as string,
      branch: (evidence['branch'] as string | null) ?? null,
      message: args['message'] as string,
    },
  };
}

// Decides what a submitted mutation did from what the repository and the remote show now.
// `redo` means the observation proves it had no effect and it can be performed as recorded.
export async function reconcileGit(
  config: GitConfig,
  context: GitContext,
  args: Record<string, Json>,
  evidence: Record<string, Json>,
): Promise<Outcome | { kind: 'redo' }> {
  const current = await head(context);
  switch (config.action) {
    case 'git_create_branch': {
      const name = args['name'] as string;
      const at = await branchCommit(context, name);
      if (at === evidence['head'] && current.branch === name)
        return { kind: 'succeeded', data: { branch: name, commit: at } };
      if (at === null && current.commit === evidence['head']) return { kind: 'redo' };
      return {
        kind: 'uncertain',
        explanation: `Branch ${name} or the workspace's HEAD changed outside the step, so Shift cannot tell whether it created the branch.`,
        evidence: { observedHead: current.commit, observedBranch: current.branch, branchAt: at },
      };
    }
    case 'git_commit': {
      // The same commit on another branch is someone else's change, not this step's.
      const sameBranch = current.branch === ((evidence['branch'] as string | null) ?? null);
      if (sameBranch && current.commit === evidence['commit']) return commitResult(evidence, args);
      if (sameBranch && current.commit === evidence['parent']) return { kind: 'redo' };
      if (!sameBranch)
        return {
          kind: 'uncertain',
          explanation: `The workspace is on ${current.branch ?? 'no branch'}, not ${(evidence['branch'] as string | null) ?? 'the detached HEAD'} the commit was made on, so it changed outside the step.`,
          evidence: { observedHead: current.commit, observedBranch: current.branch },
        };
      return {
        kind: 'uncertain',
        explanation: `HEAD is ${current.commit.slice(0, 12)}, neither the recorded parent nor the commit Shift was making, so the workspace changed outside the step.`,
        evidence: { observedHead: current.commit },
      };
    }
    case 'git_push': {
      const remote = args['remote'] as string;
      const ref = args['remoteRef'] as string;
      const after = await remoteHead(context, evidence['url'] as string, ref);
      if (after === args['commit'])
        return {
          kind: 'succeeded',
          data: {
            remote,
            remoteRef: ref,
            commit: after,
            before: evidence['before'] ?? null,
            url: evidence['url'] ?? null,
          },
        };
      // Unchanged since before the push: it never landed, and pushing the same commit again is
      // the same request.
      if (after === (evidence['before'] ?? null)) return { kind: 'redo' };
      if (typeof after !== 'string' && after !== null)
        return {
          kind: 'uncertain',
          explanation: 'The remote could not be read to check the push.',
        };
      return {
        kind: 'uncertain',
        explanation: `${ref} on ${remote} moved to ${after?.slice(0, 12) ?? 'nothing'}, neither its earlier value nor the pushed commit.`,
        evidence: { observedRemote: after },
      };
    }
    default:
      throw new ShiftError('UNSUPPORTED_NODE', `${config.action} is not a Git mutation.`, 422);
  }
}
