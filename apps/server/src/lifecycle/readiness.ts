import type { Readiness } from '../protocol/index.js';

export class ReadinessState {
  private value: Readiness = { ready: false, phase: 'starting', reason: 'STARTING' };

  snapshot(): Readiness {
    return { ...this.value };
  }
  ready(): void {
    this.value = { ready: true, phase: 'ready', reason: 'READY' };
  }
  stopping(): void {
    this.value = { ready: false, phase: 'stopping', reason: 'STOPPING' };
  }
  persistenceFailed(): void {
    this.value = { ready: false, phase: 'failed', reason: 'PERSISTENCE_UNAVAILABLE' };
  }
}
