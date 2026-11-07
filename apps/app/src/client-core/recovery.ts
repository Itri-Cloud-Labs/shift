// Unsaved workflow edits kept on this computer (client specification 4.2), so a crash or a quit
// does not lose them. They are kept per connection profile, which belongs to one server, and are
// never sent anywhere: the editor reads them back against the server's draft.

export interface KeptDraft {
  workflowId: string;
  revision: number;
  draft: Record<string, unknown>;
  keptAt: number;
}

export interface RecoveryStore {
  load(profileId: string): Promise<KeptDraft[] | undefined>;
  save(profileId: string, drafts: KeptDraft[]): Promise<void>;
  remove(profileId: string): Promise<void>;
}

export class MemoryRecoveryStore implements RecoveryStore {
  readonly #records = new Map<string, KeptDraft[]>();
  async load(profileId: string): Promise<KeptDraft[] | undefined> {
    return this.#records.get(profileId);
  }
  async save(profileId: string, drafts: KeptDraft[]): Promise<void> {
    this.#records.set(profileId, structuredClone(drafts));
  }
  async remove(profileId: string): Promise<void> {
    this.#records.delete(profileId);
  }
}

// At most this many workflows' edits, and this many bytes in all; the oldest go first.
export const keptLimit = 20;
export const keptBytes = 8 * 1024 * 1024;

const size = (item: KeptDraft) => new TextEncoder().encode(JSON.stringify(item)).byteLength;

export class DraftRecovery {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: RecoveryStore,
    private readonly now: () => number = Date.now,
  ) {}

  // Writes one at a time, so a later change never lands before an earlier one.
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #read(profileId: string): Promise<KeptDraft[]> {
    return (await this.store.load(profileId)) ?? [];
  }

  list(profileId: string): Promise<KeptDraft[]> {
    return this.#serial(() => this.#read(profileId));
  }

  keep(
    profileId: string,
    workflowId: string,
    revision: number,
    draft: Record<string, unknown>,
  ): Promise<void> {
    return this.#serial(async () => {
      const others = (await this.#read(profileId)).filter((item) => item.workflowId !== workflowId);
      const kept = [{ workflowId, revision, draft, keptAt: this.now() }, ...others].sort(
        (a, b) => b.keptAt - a.keptAt,
      );
      let total = 0;
      const bounded = kept.filter((item, index) => {
        total += size(item);
        return index < keptLimit && total <= keptBytes;
      });
      await this.store.save(profileId, bounded);
    });
  }

  forget(profileId: string, workflowId: string): Promise<void> {
    return this.#serial(async () => {
      const kept = await this.#read(profileId);
      if (!kept.some((item) => item.workflowId === workflowId)) return;
      await this.store.save(
        profileId,
        kept.filter((item) => item.workflowId !== workflowId),
      );
    });
  }

  clear(profileId: string): Promise<void> {
    return this.#serial(() => this.store.remove(profileId));
  }
}
