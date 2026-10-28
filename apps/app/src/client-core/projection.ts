import type {
  Interaction,
  Project,
  RunSummary,
  WorkflowSummary,
} from '../protocol/generated/types.js';

// The cached server state (client specification 4.3). A projection belongs to one server, device
// and event epoch, and its cursor is the last event already applied to it: the two are saved
// together, so a cursor is never reused without the state it produced.

export interface ProjectionKey {
  serverId: string;
  deviceId: string;
  epoch: string;
}

export interface Projection {
  key: ProjectionKey;
  cursor: string;
  projects: Project[];
  workflows: WorkflowSummary[];
  runs: RunSummary[];
  // Pending requests, and settled ones seen settling since the snapshot, so a form answered on
  // another device is replaced by the accepted response.
  interactions: Interaction[];
  updatedAt: number;
}

// A command whose outcome is still being confirmed. Bodies are never saved: after a restart an
// uncertain command can be checked by its receipt but not resent.
export interface SavedCommand {
  commandId: string;
  method: 'POST' | 'PUT';
  path: string;
  state: 'unknown' | 'accepted' | 'rejected' | 'not_applied';
  code: string | null;
  createdAt: number;
}

export interface SyncRecord {
  projection: Projection | null;
  commands: SavedCommand[];
}

export interface SyncStore {
  load(profileId: string): Promise<SyncRecord | undefined>;
  save(profileId: string, record: SyncRecord): Promise<void>;
  remove(profileId: string): Promise<void>;
}

export class MemorySyncStore implements SyncStore {
  readonly #records = new Map<string, SyncRecord>();
  async load(profileId: string): Promise<SyncRecord | undefined> {
    const record = this.#records.get(profileId);
    return record && structuredClone(record);
  }
  async save(profileId: string, record: SyncRecord): Promise<void> {
    this.#records.set(profileId, structuredClone(record));
  }
  async remove(profileId: string): Promise<void> {
    this.#records.delete(profileId);
  }
}

export function sameKey(a: ProjectionKey, b: ProjectionKey): boolean {
  return a.serverId === b.serverId && a.deviceId === b.deviceId && a.epoch === b.epoch;
}

export function cursorSequence(cursor: string): number {
  return Number(cursor.slice(cursor.lastIndexOf(':') + 1));
}
