import * as v from 'valibot';

export const IPC_CHANNEL = 'shift:desktop:v1';
export const REQUEST_LIMIT = 8 * 1024;
export const RESPONSE_LIMIT = 256 * 1024;
const text = v.pipe(v.string(), v.maxLength(500));
const id = v.pipe(v.string(), v.minLength(1), v.maxLength(100));
export const querySchema = v.picklist(['info', 'health', 'ready']);
export type FoundationQuery = v.InferOutput<typeof querySchema>;
export const requestSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('shell.read') }),
  v.strictObject({ kind: v.literal('samples.set'), enabled: v.boolean() }),
  v.strictObject({ kind: v.literal('server.query'), operation: querySchema }),
  v.strictObject({ kind: v.literal('desktop.openDocumentation') }),
]);
export type DesktopRequest = v.InferOutput<typeof requestSchema>;
const projectSchema = v.strictObject({ id, name: text, repository: text, branch: text });
const workflowSchema = v.strictObject({
  id,
  projectId: id,
  name: text,
  description: text,
  version: text,
  trigger: text,
  updatedAt: text,
  nodes: v.pipe(v.array(text), v.maxLength(30)),
});
const runSchema = v.strictObject({
  id,
  projectId: id,
  workflowId: id,
  name: text,
  version: text,
  status: v.picklist(['Waiting for approval', 'Completed', 'Failed']),
  startedAt: text,
  detail: text,
});
const sessionSchema = v.strictObject({
  id,
  projectId: id,
  name: text,
  status: v.picklist(['Idle', 'Archived']),
  lifetime: text,
  detail: text,
});
const attentionSchema = v.strictObject({
  id,
  projectId: id,
  runId: id,
  title: text,
  detail: text,
});
export const shellSchema = v.strictObject({
  connection: v.literal('unconfigured'),
  samples: v.boolean(),
  capturedAt: v.literal('2026-10-02T15:40:00.000Z'),
  projects: v.pipe(v.array(projectSchema), v.maxLength(20)),
  workflows: v.pipe(v.array(workflowSchema), v.maxLength(100)),
  runs: v.pipe(v.array(runSchema), v.maxLength(100)),
  sessions: v.pipe(v.array(sessionSchema), v.maxLength(100)),
  attention: v.pipe(v.array(attentionSchema), v.maxLength(100)),
  catalog: v.pipe(v.array(v.strictObject({ type: id, label: text })), v.maxLength(30)),
});
export type ShellState = v.InferOutput<typeof shellSchema>;
export const errorSchema = v.strictObject({
  kind: v.literal('error'),
  code: v.picklist([
    'INVALID_REQUEST',
    'FORBIDDEN',
    'DISCONNECTED',
    'INVALID_RESPONSE',
    'UNAVAILABLE',
  ]),
  message: v.picklist([
    'The desktop request is invalid.',
    'This frame cannot use the desktop bridge.',
    'Connect to a server before querying it.',
    'The server response is invalid.',
    'The desktop operation is unavailable.',
  ]),
});
export type DesktopError = v.InferOutput<typeof errorSchema>;
export const responseSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('shell'), state: shellSchema }),
  v.strictObject({ kind: v.literal('opened') }),
  // Generated protocol validators validate the value before this crosses IPC.
  v.strictObject({ kind: v.literal('server'), operation: querySchema, value: v.unknown() }),
  errorSchema,
]);
export type DesktopResponse = v.InferOutput<typeof responseSchema>;
export interface DesktopBridge {
  readShell(): Promise<DesktopResponse>;
  setSamples(enabled: boolean): Promise<DesktopResponse>;
  queryServer(operation: FoundationQuery): Promise<DesktopResponse>;
  openDocumentation(): Promise<DesktopResponse>;
}

export function withinLimit(value: unknown, limit: number): boolean {
  // IPC already clones the value. Reject non-JSON values and deep structures before parsing.
  let budget = limit;
  const seen = new Set<object>();
  function visit(item: unknown, depth: number): boolean {
    if (--budget < 0 || depth > 16) return false;
    if (item === null || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item === 'string') {
      budget -= item.length;
      return budget >= 0;
    }
    if (typeof item !== 'object' || seen.has(item)) return false;
    seen.add(item);
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) return false;
    return Object.entries(item).every(([key, child]) => {
      budget -= key.length;
      return budget >= 0 && visit(child, depth + 1);
    });
  }
  if (!visit(value, 0)) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= limit;
  } catch {
    return false;
  }
}
export function parseRequest(value: unknown): DesktopRequest | undefined {
  if (!withinLimit(value, REQUEST_LIMIT)) return undefined;
  const result = v.safeParse(requestSchema, value);
  return result.success ? result.output : undefined;
}
export function parseResponse(value: unknown): DesktopResponse | undefined {
  if (!withinLimit(value, RESPONSE_LIMIT)) return undefined;
  const result = v.safeParse(responseSchema, value);
  return result.success ? result.output : undefined;
}
