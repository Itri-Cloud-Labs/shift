import type { Json } from '../harness/types.js';
import type { ExecutionError } from '../runs/repository.js';

// What one run of an action established. `uncertain` means it may have had an effect Shift cannot
// confirm; `stopped` means Shift stopped it because the attempt was aborted.
export type Outcome =
  | { kind: 'succeeded'; data: Json; record?: Record<string, Json> }
  | { kind: 'failed'; error: ExecutionError; record?: Record<string, Json> }
  | { kind: 'uncertain'; explanation: string; evidence?: Record<string, Json> }
  | { kind: 'stopped' };

// Best-effort removal of credential values from captured text. It cannot catch a value the
// process transformed, so it does not replace trusting the code the owner runs.
export function redact(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets)
    if (secret.length >= 4) result = result.split(secret).join('[redacted]');
  return result;
}
