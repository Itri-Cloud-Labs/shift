import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import {
  documentHash,
  maxDocumentBytes,
  validateDocument,
  type WorkflowDocument,
} from './document.js';

export interface ProjectRow {
  id: string;
  name: string;
  repositoryPath: string;
  baseRef: string;
  createdAt: number;
}

export interface VersionRow {
  id: string;
  workflowId: string;
  projectId: string;
  number: number;
  hash: string;
  createdAt: number;
  document: WorkflowDocument;
}

const notFound = (what: string) => new ShiftError('NOT_FOUND', `${what} not found.`, 404);

// Synchronous definition storage. Drafts are mutable under compare-and-swap revisions; published
// versions are immutable (database triggers reject updates and deletes).
export class DefinitionRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
  ) {}

  #event(type: string, payload: Json): void {
    this.db
      .prepare(
        'INSERT INTO events (type, schema_version, payload_json, created_at) VALUES (?, 1, ?, ?)',
      )
      .run(type, JSON.stringify(payload), this.clock.now());
  }

  addProject(project: { name: string; repositoryPath: string; baseRef: string }): ProjectRow {
    const existing = this.db
      .prepare('SELECT id FROM projects WHERE repository_path = ?')
      .get(project.repositoryPath);
    if (existing) {
      throw new ShiftError('PROJECT_EXISTS', 'This repository is already a project.', 409);
    }
    const id = randomUUID();
    const now = this.clock.now();
    this.db
      .prepare(
        "INSERT INTO projects (id, name, repository_path, base_ref, defaults_json, permissions_json, revision, created_at) VALUES (?, ?, ?, ?, '{}', '{}', 0, ?)",
      )
      .run(id, project.name, project.repositoryPath, project.baseRef, now);
    this.#event('project.created', { projectId: id });
    return { id, ...project, createdAt: now };
  }

  project(id: string): ProjectRow {
    const row = this.db
      .prepare(
        'SELECT id, name, repository_path, base_ref, created_at FROM projects WHERE id = ? AND archived_at IS NULL',
      )
      .get(id) as
      | { id: string; name: string; repository_path: string; base_ref: string; created_at: number }
      | undefined;
    if (!row) throw notFound('Project');
    return {
      id: row.id,
      name: row.name,
      repositoryPath: row.repository_path,
      baseRef: row.base_ref,
      createdAt: row.created_at,
    };
  }

  projects(): ProjectRow[] {
    return (
      this.db
        .prepare('SELECT id FROM projects WHERE archived_at IS NULL ORDER BY created_at')
        .all() as Array<{ id: string }>
    ).map((row) => this.project(row.id));
  }

  createWorkflow(workflow: { projectId: string; name: string; draft: Json }): Json {
    this.project(workflow.projectId);
    this.#checkDraft(workflow.draft);
    if (
      this.db
        .prepare('SELECT 1 FROM workflows WHERE project_id = ? AND name = ?')
        .get(workflow.projectId, workflow.name)
    ) {
      throw new ShiftError(
        'WORKFLOW_EXISTS',
        'The project already has a workflow with this name.',
        409,
      );
    }
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO workflows (id, project_id, name, draft_json, draft_revision, enabled, revision, created_at) VALUES (?, ?, ?, ?, 0, 1, 0, ?)',
      )
      .run(id, workflow.projectId, workflow.name, JSON.stringify(workflow.draft), this.clock.now());
    this.#event('workflow.created', { workflowId: id });
    return this.workflow(id);
  }

  // Compare-and-swap: a stale draft revision is a conflict, never a silent overwrite.
  saveDraft(id: string, expectedRevision: number, draft: Json): Json {
    this.#checkDraft(draft);
    const changed = this.db
      .prepare(
        'UPDATE workflows SET draft_json = ?, draft_revision = draft_revision + 1, revision = revision + 1 WHERE id = ? AND draft_revision = ? AND archived_at IS NULL',
      )
      .run(JSON.stringify(draft), id, expectedRevision).changes;
    if (changed !== 1) {
      this.workflow(id);
      throw new ShiftError('REVISION_CONFLICT', 'The draft changed since revision was read.', 409);
    }
    this.#event('workflow.draft_saved', { workflowId: id, draftRevision: expectedRevision + 1 });
    return this.workflow(id);
  }

  // Validates the draft and freezes it as the next version. Publishing an unchanged draft returns
  // the active version rather than numbering a duplicate.
  publish(id: string, expectedRevision?: number): Json {
    const row = this.db
      .prepare(
        'SELECT draft_json, draft_revision, active_version_id FROM workflows WHERE id = ? AND archived_at IS NULL',
      )
      .get(id) as
      { draft_json: string; draft_revision: number; active_version_id: string | null } | undefined;
    if (!row) throw notFound('Workflow');
    if (expectedRevision !== undefined && row.draft_revision !== expectedRevision) {
      throw new ShiftError('REVISION_CONFLICT', 'The draft changed since revision was read.', 409);
    }
    const document = validateDocument(JSON.parse(row.draft_json));
    const hash = documentHash(document);
    const active = row.active_version_id ? this.version(row.active_version_id) : null;
    if (active?.hash === hash) return this.workflow(id);
    const number =
      (
        this.db
          .prepare(
            'SELECT COALESCE(MAX(version_number), 0) AS n FROM workflow_versions WHERE workflow_id = ?',
          )
          .get(id) as { n: number }
      ).n + 1;
    const versionId = randomUUID();
    this.db
      .prepare(
        'INSERT INTO workflow_versions (id, workflow_id, version_number, document_json, document_hash, format_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        versionId,
        id,
        number,
        JSON.stringify(document),
        hash,
        document.formatVersion,
        this.clock.now(),
      );
    this.db
      .prepare('UPDATE workflows SET active_version_id = ?, revision = revision + 1 WHERE id = ?')
      .run(versionId, id);
    this.#event('workflow.published', { workflowId: id, versionId, number });
    return this.workflow(id);
  }

  version(id: string): VersionRow {
    const row = this.db
      .prepare(
        'SELECT v.id, v.workflow_id, w.project_id, v.version_number, v.document_hash, v.document_json, v.created_at FROM workflow_versions v JOIN workflows w ON w.id = v.workflow_id WHERE v.id = ?',
      )
      .get(id) as
      | {
          id: string;
          workflow_id: string;
          project_id: string;
          version_number: number;
          document_hash: string;
          document_json: string;
          created_at: number;
        }
      | undefined;
    if (!row) throw notFound('Workflow version');
    return {
      id: row.id,
      workflowId: row.workflow_id,
      projectId: row.project_id,
      number: row.version_number,
      hash: row.document_hash,
      createdAt: row.created_at,
      document: JSON.parse(row.document_json) as WorkflowDocument,
    };
  }

  activeVersion(workflowId: string): VersionRow {
    const row = this.db
      .prepare(
        'SELECT active_version_id, enabled FROM workflows WHERE id = ? AND archived_at IS NULL',
      )
      .get(workflowId) as { active_version_id: string | null; enabled: number } | undefined;
    if (!row) throw notFound('Workflow');
    if (!row.enabled) {
      throw new ShiftError('WORKFLOW_DISABLED', 'The workflow is paused and starts no runs.', 409);
    }
    if (!row.active_version_id) {
      throw new ShiftError('WORKFLOW_UNPUBLISHED', 'Publish the workflow before starting it.', 409);
    }
    return this.version(row.active_version_id);
  }

  workflow(id: string): Json {
    const row = this.db
      .prepare(
        'SELECT id, project_id, name, draft_json, draft_revision, enabled, active_version_id, created_at FROM workflows WHERE id = ? AND archived_at IS NULL',
      )
      .get(id) as
      | {
          id: string;
          project_id: string;
          name: string;
          draft_json: string;
          draft_revision: number;
          enabled: number;
          active_version_id: string | null;
          created_at: number;
        }
      | undefined;
    if (!row) throw notFound('Workflow');
    const versions = this.db
      .prepare(
        'SELECT id, version_number, document_hash, created_at FROM workflow_versions WHERE workflow_id = ? ORDER BY version_number',
      )
      .all(id) as Array<{
      id: string;
      version_number: number;
      document_hash: string;
      created_at: number;
    }>;
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      enabled: row.enabled === 1,
      draftRevision: row.draft_revision,
      draft: JSON.parse(row.draft_json) as Json,
      activeVersionId: row.active_version_id,
      versions: versions.map((version) => ({
        id: version.id,
        number: version.version_number,
        hash: version.document_hash,
        createdAt: version.created_at,
      })),
      createdAt: row.created_at,
    };
  }

  workflows(projectId?: string): Json {
    return (
      this.db
        .prepare(
          'SELECT id, project_id, name, active_version_id FROM workflows WHERE archived_at IS NULL AND (? IS NULL OR project_id = ?) ORDER BY created_at',
        )
        .all(projectId ?? null, projectId ?? null) as Array<{
        id: string;
        project_id: string;
        name: string;
        active_version_id: string | null;
      }>
    ).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      activeVersionId: row.active_version_id,
    }));
  }

  #checkDraft(draft: Json): void {
    if (Buffer.byteLength(JSON.stringify(draft)) > maxDocumentBytes) {
      throw new ShiftError('REQUEST_TOO_LARGE', 'The workflow document exceeds 1 MiB.', 413);
    }
  }
}
