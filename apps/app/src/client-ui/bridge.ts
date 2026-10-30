import { useCallback, useEffect, useRef, useState } from 'react';
import type { Interaction } from '../protocol/generated/types.js';
import {
  parseResponse,
  type ConnectionView,
  type DesktopResponse,
  type Overview,
  type Preferences,
  type SyncView,
} from '../shared/contracts.js';

// Renderer access to the desktop bridge. Every answer is parsed again here; main's change
// notifications only say "read again".

export function bridge() {
  if (!window.shift) throw new Error('The desktop bridge is unavailable.');
  return window.shift;
}

export async function ask(call: Promise<DesktopResponse>): Promise<DesktopResponse> {
  try {
    return (
      parseResponse(await call) ?? {
        kind: 'error',
        code: 'INVALID_RESPONSE',
        message: 'The server response is invalid.',
      }
    );
  } catch {
    return {
      kind: 'error',
      code: 'UNAVAILABLE',
      message: 'The desktop operation is unavailable.',
    };
  }
}

// Calls `read` now and again after each change notification.
// A value belongs to the deps it was read for: when they change, the old value is not shown.
export function useLive<T>(read: () => Promise<T | undefined>, deps: unknown[]): T | undefined {
  const key = JSON.stringify(deps);
  const [state, setState] = useState<{ key: string; value: T }>();
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    const next = await read();
    // An older read that finishes late never replaces a newer one.
    if (ticket === latest.current && next !== undefined) setState({ key, value: next });
  }, [key]);
  useEffect(() => {
    void refresh();
    return window.shift?.onChange(() => void refresh());
  }, [refresh]);
  return state?.key === key ? state.value : undefined;
}

export interface DesktopState {
  connection: ConnectionView;
  sync: SyncView;
  overview: Overview;
  // Pending human requests and settled ones seen since the snapshot; checked by preload.
  interactions: Interaction[];
  preferences: Preferences;
}

export function useDesktop(): DesktopState | undefined {
  return useLive(async () => {
    const [connection, sync, overview, interactions, preferences] = await Promise.all([
      ask(bridge().connection.read()),
      ask(bridge().sync.read()),
      ask(bridge().data.overview()),
      ask(bridge().interaction.list()),
      ask(bridge().preferences.read()),
    ]);
    if (
      connection.kind !== 'connection' ||
      sync.kind !== 'sync' ||
      overview.kind !== 'overview' ||
      interactions.kind !== 'interactions' ||
      preferences.kind !== 'preferences'
    )
      return undefined;
    return {
      connection: connection.connection,
      sync: sync.sync,
      overview: overview.overview,
      interactions: (interactions.value as { interactions: Interaction[] }).interactions,
      preferences: preferences.preferences,
    };
  }, []);
}
