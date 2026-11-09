import type { Readable } from 'node:stream';
import { ShiftError } from '../domain/errors.js';
import type { SystemdScopes } from '../harness/containment.js';

// Runs one owner-authored process inside its own systemd scope (specification sections 8 and
// 11.2). The scope holds every descendant, so a timeout, a cancellation or a restart can stop all
// of them and prove that nothing is left. A scope's name is derived from its operation, so the
// process can be found again from the durable record after a crash.

export interface Captured {
  text: string;
  // Bytes the process wrote, of which `text` holds at most the configured number.
  bytes: number;
  truncated: boolean;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  // Stopped by Shift because the attempt was aborted.
  stopped: boolean;
  stdout: Captured;
  stderr: Captured;
  // Descriptor 3, when a result pipe was asked for. It is never truncated: past its limit the
  // process is stopped and `resultTooLarge` is set.
  result?: string;
  resultTooLarge?: boolean;
  durationMs: number;
}

export interface ProcessRequest {
  unit: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  stdin?: string;
  maxResultBytes?: number;
  signal: AbortSignal;
  // Called once the process is in its scope, with its PID.
  started?: (pid: number) => void;
}

// Keeps the last `limit` bytes of a stream: the end of a log says most about how it finished.
function tail(stream: Readable, limit: number): () => Captured {
  const chunks: Buffer[] = [];
  let kept = 0;
  let bytes = 0;
  stream.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    chunks.push(chunk);
    kept += chunk.length;
    while (kept > limit && chunks.length > 0) {
      const first = chunks[0]!;
      const excess = kept - limit;
      if (first.length <= excess) {
        chunks.shift();
        kept -= first.length;
      } else {
        chunks[0] = first.subarray(excess);
        kept -= excess;
      }
    }
  });
  return () => {
    let text = Buffer.concat(chunks).toString('utf8');
    // A cut through a multi-byte character leaves a replacement character at the start.
    if (bytes > kept) text = text.replace(/^�+/, '');
    return { text, bytes, truncated: bytes > kept };
  };
}

export class ProcessRunner {
  constructor(
    private readonly scopes: SystemdScopes,
    readonly unitPrefix: string,
  ) {}

  unit(operationId: string): string {
    return `${this.unitPrefix}${operationId}`;
  }

  async available(): Promise<boolean> {
    return this.scopes.available();
  }

  // Whether anything still runs in the scope.
  async alive(unit: string): Promise<boolean> {
    return (await this.scopes.members(unit).catch(() => [])).length > 0;
  }

  // Resolves once the scope is empty; throws if processes remain.
  async kill(unit: string): Promise<void> {
    await this.scopes.kill(unit);
  }

  // Stops every action scope an earlier Shift process left behind.
  async reapStale(): Promise<void> {
    if (!(await this.scopes.available())) return;
    for (const unit of await this.scopes.list(this.unitPrefix)) await this.scopes.kill(unit);
  }

  async run(request: ProcessRequest): Promise<ProcessResult> {
    if (!(await this.scopes.available()))
      throw new ShiftError(
        'ACTION_CONTAINMENT_UNAVAILABLE',
        `Commands need a systemd ${this.scopes.manager} manager, so Shift can account for every process they start.`,
        503,
      );
    const started = Date.now();
    const child = this.scopes.spawn(request.unit, request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      stdin: request.stdin !== undefined,
      resultPipe: request.maxResultBytes !== undefined,
    });
    const stdout = tail(child.stdout!, request.maxOutputBytes);
    const stderr = tail(child.stderr!, request.maxOutputBytes);
    let timedOut = false;
    let stopped = false;
    let resultTooLarge = false;
    let killing: Promise<void> | null = null;
    const kill = () => {
      killing ??= this.scopes.kill(request.unit);
      return killing;
    };
    const resultChunks: Buffer[] = [];
    let resultBytes = 0;
    const resultStream = request.maxResultBytes === undefined ? null : (child.stdio[3] as Readable);
    resultStream?.on('data', (chunk: Buffer) => {
      resultBytes += chunk.length;
      if (resultBytes > request.maxResultBytes!) {
        resultTooLarge = true;
        void kill().catch(() => undefined);
        return;
      }
      resultChunks.push(chunk);
    });
    if (request.stdin !== undefined) {
      child.stdin!.on('error', () => undefined);
      child.stdin!.end(request.stdin);
    }
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      },
    );
    if (child.pid !== undefined) request.started?.(child.pid);
    const timer = setTimeout(() => {
      timedOut = true;
      void kill().catch(() => undefined);
    }, request.timeoutMs);
    const onAbort = () => {
      stopped = true;
      void kill().catch(() => undefined);
    };
    if (request.signal.aborted) onAbort();
    else request.signal.addEventListener('abort', onAbort, { once: true });
    let outcome: { code: number | null; signal: NodeJS.Signals | null };
    try {
      outcome = await exit;
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', onAbort);
    }
    // A stop is only accounted for once the scope is empty; descendants can outlive the leader.
    if (killing || timedOut || stopped || resultTooLarge) await kill();
    else if (await this.alive(request.unit)) await kill();
    return {
      exitCode: outcome.code,
      signal: outcome.signal,
      timedOut,
      stopped,
      stdout: stdout(),
      stderr: stderr(),
      ...(resultStream ? { result: Buffer.concat(resultChunks).toString('utf8') } : {}),
      ...(resultTooLarge ? { resultTooLarge } : {}),
      durationMs: Date.now() - started,
    };
  }
}
