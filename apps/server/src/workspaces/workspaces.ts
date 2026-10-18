import type Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';

const run = promisify(execFile);

export type WorkspaceState = 'CREATING' | 'READY' | 'RETIRED';

export interface Workspace {
  id: string;
  projectId: string;
  runId: string;
  path: string;
  repositoryPath: string;
  baseRef: string;
  baseCommit: string;
  state: WorkspaceState;
  createdAt: number;
  readyAt: number | null;
  retiredAt: number | null;
  // Whether a nonterminal run still owns it.
  claimed: boolean;
}

interface Row {
  id: string;
  project_id: string;
  created_by_run_id: string;
  path: string;
  repository_path: string;
  base_ref: string;
  base_commit: string;
  state: WorkspaceState;
  created_at: number;
  ready_at: number | null;
  retired_at: number | null;
  run_state: string;
}

const select =
  'SELECT w.*, r.state AS run_state FROM workspaces w JOIN runs r ON r.id = w.created_by_run_id';
// A run owns its workspace until it is terminal, including while it waits for a human.
const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

const view = (row: Row): Workspace => ({
  id: row.id,
  projectId: row.project_id,
  runId: row.created_by_run_id,
  path: row.path,
  repositoryPath: row.repository_path,
  baseRef: row.base_ref,
  baseCommit: row.base_commit,
  state: row.state,
  createdAt: row.created_at,
  readyAt: row.ready_at,
  retiredAt: row.retired_at,
  claimed: !terminal.has(row.run_state),
});

// Git runs non-interactively; hooks still run, as they would for the owner.
async function git(repository: string, args: string[]): Promise<string> {
  const result = await run('git', ['-C', repository, ...args], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

const unavailable = (message: string) => new ShiftError('WORKSPACE_UNAVAILABLE', message, 422);

// Run workspaces (specification section 7): each run gets a detached worktree of its project at
// the commit recorded when the run was admitted, under `<state>/workspaces/<id>`. The project's
// own checkout is never modified. Completed runs keep their worktree until it is removed.
export class Workspaces {
  readonly #creating = new Map<string, Promise<Workspace>>();

  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
    readonly root: string,
  ) {}

  // The exact commit a run starts from. Resolved once at admission, so later commits to the base
  // ref never change an admitted run.
  async resolveBase(repositoryPath: string, baseRef: string): Promise<string> {
    try {
      return await git(repositoryPath, [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${baseRef}^{commit}`,
      ]);
    } catch {
      throw new ShiftError(
        'INVALID_BASE_REF',
        `The project base ref ${baseRef} does not resolve to a commit.`,
        422,
      );
    }
  }

  // The run's workspace, recorded before any Git work so a crash leaves a row to recover from.
  allocate(input: {
    runId: string;
    projectId: string;
    repositoryPath: string;
    baseRef: string;
    baseCommit: string;
  }): Workspace {
    return this.db
      .transaction(() => {
        const existing = this.#byRun(input.runId);
        if (existing) return existing;
        const id = randomUUID();
        this.db
          .prepare(
            "INSERT INTO workspaces (id, project_id, created_by_run_id, path, repository_path, base_ref, base_commit, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'CREATING', ?)",
          )
          .run(
            id,
            input.projectId,
            input.runId,
            join(this.root, id),
            input.repositoryPath,
            input.baseRef,
            input.baseCommit,
            this.clock.now(),
          );
        this.db
          .prepare('UPDATE runs SET primary_workspace_id = ? WHERE id = ?')
          .run(id, input.runId);
        return this.#byRun(input.runId)!;
      })
      .immediate();
  }

  // Creates the worktree if it is not ready yet. Concurrent callers share one creation.
  async ensureReady(id: string): Promise<Workspace> {
    const pending = this.#creating.get(id);
    if (pending) return pending;
    const creation = this.#ensure(id).finally(() => this.#creating.delete(id));
    this.#creating.set(id, creation);
    return creation;
  }

  async #ensure(id: string): Promise<Workspace> {
    const workspace = this.get(id);
    if (workspace.state === 'RETIRED') throw unavailable('The run workspace was removed.');
    if (workspace.state === 'READY') {
      if (!existsSync(workspace.path)) {
        throw unavailable('The run workspace directory is missing; it was removed outside Shift.');
      }
      return workspace;
    }
    try {
      // A CREATING workspace never had work run in it, so whatever a crash left is discarded.
      await this.#discard(workspace);
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await git(workspace.repositoryPath, [
        'worktree',
        'add',
        '--detach',
        workspace.path,
        workspace.baseCommit,
      ]);
    } catch {
      await this.#discard(workspace).catch(() => undefined);
      throw unavailable(
        `Shift could not create a worktree of ${workspace.repositoryPath} at ${workspace.baseCommit}.`,
      );
    }
    this.db
      .prepare(
        "UPDATE workspaces SET state = 'READY', ready_at = ? WHERE id = ? AND state = 'CREATING'",
      )
      .run(this.clock.now(), id);
    return this.get(id);
  }

  // Removes a worktree registration and directory. Only paths under the workspace root are touched.
  async #discard(workspace: { path: string; repositoryPath: string }): Promise<void> {
    if (!workspace.path.startsWith(this.root + sep)) {
      throw new ShiftError('INTERNAL_ERROR', 'A workspace path is outside the workspace root.');
    }
    await git(workspace.repositoryPath, ['worktree', 'remove', '--force', workspace.path]).catch(
      () => undefined,
    );
    await rm(workspace.path, { recursive: true, force: true });
    await git(workspace.repositoryPath, ['worktree', 'prune']).catch(() => undefined);
  }

  // Explicit removal. A workspace its run still owns is refused, and uncommitted changes are kept
  // unless `force` discards them.
  async remove(id: string, options: { force?: boolean } = {}): Promise<Workspace> {
    const workspace = this.get(id);
    if (workspace.state === 'RETIRED') return workspace;
    if (workspace.claimed) {
      throw new ShiftError(
        'WORKSPACE_IN_USE',
        'The run that owns this workspace has not finished.',
        409,
      );
    }
    if (existsSync(workspace.path)) {
      const dirty =
        workspace.state === 'READY' &&
        (await git(workspace.path, ['status', '--porcelain']).catch(() => '')) !== '';
      if (dirty && !options.force) {
        throw new ShiftError(
          'WORKSPACE_DIRTY',
          'The workspace has uncommitted changes. Remove it with --force to discard them.',
          409,
        );
      }
    }
    await this.#discard(workspace);
    this.db
      .prepare(
        "UPDATE workspaces SET state = 'RETIRED', retired_at = ? WHERE id = ? AND state != 'RETIRED'",
      )
      .run(this.clock.now(), id);
    return this.get(id);
  }

  get(id: string): Workspace {
    const row = this.db.prepare(`${select} WHERE w.id = ?`).get(id) as Row | undefined;
    if (!row) throw new ShiftError('WORKSPACE_NOT_FOUND', 'No such workspace.', 404);
    return view(row);
  }

  list(projectId?: string): Workspace[] {
    const rows = (
      projectId === undefined
        ? this.db.prepare(`${select} ORDER BY w.created_at DESC, w.id`).all()
        : this.db
            .prepare(`${select} WHERE w.project_id = ? ORDER BY w.created_at DESC, w.id`)
            .all(projectId)
    ) as Row[];
    return rows.map(view);
  }

  #byRun(runId: string): Workspace | undefined {
    const row = this.db.prepare(`${select} WHERE w.created_by_run_id = ?`).get(runId) as
      Row | undefined;
    return row && view(row);
  }
}
