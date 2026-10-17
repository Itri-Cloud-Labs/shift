import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import type { CommandReceipts, CommandResponse } from '../persistence/receipts.js';
import { normalizeDocument } from './document.js';
import type { DefinitionRepository } from './repository.js';

const git = promisify(execFile);
const local = { kind: 'cli' as const, id: 'local' };
const ajv = new Ajv2020({ strict: true, coerceTypes: false });
const commandId = { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' };
const name = { type: 'string', minLength: 1, maxLength: 200 };

const validators = {
  project: ajv.compile({
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: {
      path: { type: 'string', minLength: 1, maxLength: 4096 },
      name,
      baseRef: { type: 'string', minLength: 1, maxLength: 255 },
      commandId,
    },
  }),
  workflow: ajv.compile({
    type: 'object',
    additionalProperties: false,
    required: ['projectId', 'name', 'draft'],
    properties: { projectId: { type: 'string' }, name, draft: {}, commandId },
  }),
  draft: ajv.compile({
    type: 'object',
    additionalProperties: false,
    required: ['revision', 'draft'],
    properties: { revision: { type: 'integer', minimum: 0 }, draft: {}, commandId },
  }),
  publish: ajv.compile({
    type: 'object',
    additionalProperties: false,
    properties: { revision: { type: 'integer', minimum: 0 }, commandId },
  }),
};

function check<T>(validate: (typeof validators)[keyof typeof validators], input: unknown): T {
  if (!validate(input)) {
    throw new ShiftError(
      'INVALID_REQUEST',
      'Invalid request.',
      422,
      false,
      (validate.errors ?? []).map((error) => error.instancePath || '/'),
    );
  }
  return input as T;
}

// Definition commands. Host checks run first; each mutation then commits with its receipt.
export class DefinitionService {
  constructor(
    private readonly definitions: DefinitionRepository,
    private readonly receipts: CommandReceipts,
  ) {}

  // A project is an existing repository on this host, addressed by its canonical top level.
  async addProject(input: unknown): Promise<CommandResponse> {
    const request = check<{ path: string; name?: string; baseRef?: string; commandId?: string }>(
      validators.project,
      input,
    );
    if (!isAbsolute(request.path)) {
      throw new ShiftError('INVALID_REQUEST', 'The repository path must be absolute.', 422);
    }
    const path = await realpath(request.path).catch(() => {
      throw new ShiftError('INVALID_REQUEST', 'The repository path does not exist.', 422);
    });
    const top = await git('git', ['-C', path, 'rev-parse', '--show-toplevel']).catch(() => {
      throw new ShiftError('NOT_A_REPOSITORY', 'The path is not inside a Git repository.', 422);
    });
    if (top.stdout.trim() !== path) {
      throw new ShiftError('NOT_A_REPOSITORY', 'Register the repository top level.', 422);
    }
    const baseRef =
      request.baseRef ??
      (await git('git', ['-C', path, 'symbolic-ref', '--short', 'HEAD'])
        .then((result) => result.stdout.trim())
        .catch(() => 'HEAD'));
    await git('git', ['-C', path, 'rev-parse', '--verify', `${baseRef}^{commit}`]).catch(() => {
      throw new ShiftError('INVALID_BASE_REF', `The base ref ${baseRef} is not a commit.`, 422);
    });
    const project = { name: request.name ?? basename(path), repositoryPath: path, baseRef };
    return this.receipts.execute(
      local,
      request.commandId,
      { op: 'project.add', ...project },
      () => ({
        status: 201,
        body: { project: this.definitions.addProject(project) as unknown as Json },
      }),
    );
  }

  createWorkflow(input: unknown): CommandResponse {
    const request = check<{ projectId: string; name: string; draft: Json; commandId?: string }>(
      validators.workflow,
      input,
    );
    const draft = normalizeDocument(request.draft) as Json;
    const { commandId: id, ...rest } = request;
    return this.receipts.execute(local, id, { op: 'workflow.create', ...rest }, () => ({
      status: 201,
      body: {
        workflow: this.definitions.createWorkflow({
          projectId: request.projectId,
          name: request.name,
          draft,
        }),
      },
    }));
  }

  saveDraft(workflowId: string, input: unknown): CommandResponse {
    const request = check<{ revision: number; draft: Json; commandId?: string }>(
      validators.draft,
      input,
    );
    const draft = normalizeDocument(request.draft) as Json;
    const { commandId: id, ...rest } = request;
    return this.receipts.execute(local, id, { op: 'workflow.save', workflowId, ...rest }, () => ({
      status: 200,
      body: { workflow: this.definitions.saveDraft(workflowId, request.revision, draft) },
    }));
  }

  publish(workflowId: string, input: unknown): CommandResponse {
    const request = check<{ revision?: number; commandId?: string }>(validators.publish, input);
    const { commandId: id, ...rest } = request;
    return this.receipts.execute(
      local,
      id,
      { op: 'workflow.publish', workflowId, ...rest },
      () => ({
        status: 200,
        body: { workflow: this.definitions.publish(workflowId, request.revision) },
      }),
    );
  }
}
