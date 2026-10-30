import * as v from 'valibot';
import { preferencesSchema, type Preferences } from '../shared/contracts.js';

// This computer's own choices, kept apart from anything the server knows. A file that cannot be
// read or no longer fits falls back to the defaults.

export const defaultPreferences: Preferences = { theme: 'system', notifications: false };

export interface PreferenceStore {
  load(): Promise<unknown>;
  save(preferences: Preferences): Promise<void>;
}

export class MemoryPreferenceStore implements PreferenceStore {
  #value: unknown;
  async load(): Promise<unknown> {
    return this.#value;
  }
  async save(preferences: Preferences): Promise<void> {
    this.#value = preferences;
  }
}

export class PreferenceRuntime {
  #value = defaultPreferences;
  #saving: Promise<void> = Promise.resolve();
  readonly #listeners = new Set<(preferences: Preferences) => void>();
  constructor(private readonly store: PreferenceStore) {}

  get value(): Preferences {
    return this.#value;
  }

  async load(): Promise<void> {
    const loaded = v.safeParse(preferencesSchema, await this.store.load());
    if (loaded.success) this.#value = loaded.output;
    this.#notify();
  }

  // Applies at once; a failed save only means the choice lasts until the app quits. Saves run
  // one at a time, so the last choice is the one left on disk.
  async set(next: Preferences): Promise<void> {
    this.#value = next;
    this.#notify();
    this.#saving = this.#saving.then(() => this.store.save(next)).catch(() => undefined);
    await this.#saving;
  }

  subscribe(listener: (preferences: Preferences) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener(this.#value);
  }
}
