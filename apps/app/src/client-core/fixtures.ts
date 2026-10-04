import type { ShellState } from '../shared/contracts.js';

export function createShell(samplesEnabled: boolean): ShellState {
  return { connection: 'unconfigured', samples: samplesEnabled };
}
