import { Ajv2020 } from 'ajv/dist/2020.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import type { Actor, CommandReceipts, CommandResponse } from '../persistence/receipts.js';
import type { Workspaces } from './workspaces.js';

const local = { kind: 'cli' as const, id: 'local' };
const validateRemove = new Ajv2020({ strict: true, coerceTypes: false }).compile({
  type: 'object',
  additionalProperties: false,
  properties: {
    force: { type: 'boolean' },
    commandId: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' },
  },
});

// Workspace commands. Removal is Git work outside a transaction, so its receipt commits after the
// worktree is gone; removing a removed workspace is a no-op, which makes a retry safe.
export class WorkspaceService {
  constructor(
    readonly workspaces: Workspaces,
    private readonly receipts: CommandReceipts,
  ) {}

  async remove(id: string, input: unknown, actor: Actor = local): Promise<CommandResponse> {
    if (!validateRemove(input)) {
      throw new ShiftError(
        'INVALID_REQUEST',
        'Invalid request.',
        422,
        false,
        (validateRemove.errors ?? []).map((error) => error.instancePath || '/'),
      );
    }
    const { commandId, force = false } = input as { force?: boolean; commandId?: string };
    const request = { op: 'workspace.remove', workspaceId: id, force };
    const stored = commandId === undefined ? null : this.receipts.lookup(actor, commandId, request);
    if (stored) return stored;
    const workspace = await this.workspaces.remove(id, { force });
    return this.receipts.execute(actor, commandId, request, () => ({
      status: 200,
      body: { workspace: workspace as unknown as Json },
    }));
  }
}
