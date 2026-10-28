import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseResponse,
  type ConnectionView,
  type DesktopResponse,
  type Overview,
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
export function useLive<T>(read: () => Promise<T | undefined>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T>();
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    const next = await read();
    // An older read that finishes late never replaces a newer one.
    if (ticket === latest.current && next !== undefined) setValue(next);
  }, deps);
  useEffect(() => {
    void refresh();
    return window.shift?.onChange(() => void refresh());
  }, [refresh]);
  return value;
}

export interface DesktopState {
  connection: ConnectionView;
  sync: SyncView;
  overview: Overview;
}

export function useDesktop(): DesktopState | undefined {
  return useLive(async () => {
    const [connection, sync, overview] = await Promise.all([
      ask(bridge().connection.read()),
      ask(bridge().sync.read()),
      ask(bridge().data.overview()),
    ]);
    if (connection.kind !== 'connection' || sync.kind !== 'sync' || overview.kind !== 'overview')
      return undefined;
    return { connection: connection.connection, sync: sync.sync, overview: overview.overview };
  }, []);
}
