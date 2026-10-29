import * as v from 'valibot';

export const IPC_CHANNEL = 'shift:desktop:v1';
// Main tells the renderer that connection or synchronized state changed; it carries no data.
export const CHANGE_CHANNEL = 'shift:desktop:v1:changed';
export const REQUEST_LIMIT = 8 * 1024;
// Moving nodes sends every node's position at once.
export const MOVE_LIMIT = 64 * 1024;
export const RESPONSE_LIMIT = 256 * 1024;
// Workflow documents and runs with their executions can be larger than other answers.
export const RESOURCE_LIMIT = 8 * 1024 * 1024;
export const querySchema = v.picklist(['info', 'health', 'ready']);
export type FoundationQuery = v.InferOutput<typeof querySchema>;
const profileId = v.pipe(v.string(), v.regex(/^[0-9a-f-]{36}$/));
const serverUrl = v.pipe(v.string(), v.minLength(1), v.maxLength(2048));
export const requestSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('shell.read') }),
  v.strictObject({ kind: v.literal('connection.read') }),
  // The phrase crosses IPC once, from the pairing form to main, and is never sent back.
  v.strictObject({
    kind: v.literal('connection.pair'),
    url: serverUrl,
    phrase: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
    deviceName: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  }),
  v.strictObject({ kind: v.literal('connection.abandonPairing') }),
  v.strictObject({ kind: v.literal('connection.connect'), profileId }),
  v.strictObject({ kind: v.literal('connection.changeAddress'), profileId, url: serverUrl }),
  v.strictObject({ kind: v.literal('connection.clear'), profileId }),
  v.strictObject({ kind: v.literal('samples.set'), enabled: v.boolean() }),
  v.strictObject({ kind: v.literal('server.query'), operation: querySchema }),
  v.strictObject({ kind: v.literal('sync.read') }),
  v.strictObject({ kind: v.literal('data.overview') }),
  v.strictObject({ kind: v.literal('data.workflow'), workflowId: profileId }),
  v.strictObject({ kind: v.literal('data.version'), workflowId: profileId, versionId: profileId }),
  v.strictObject({ kind: v.literal('data.run'), runId: profileId }),
  // The trigger input is any JSON value; the request size limit bounds it.
  v.strictObject({ kind: v.literal('run.start'), workflowId: profileId, input: v.unknown() }),
  v.strictObject({ kind: v.literal('run.cancel'), runId: profileId }),
  v.strictObject({
    kind: v.literal('workflow.move'),
    workflowId: profileId,
    revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
    positions: v.pipe(
      v.array(
        v.strictObject({
          nodeId: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
          x: v.pipe(v.number(), v.minValue(-1e6), v.maxValue(1e6)),
          y: v.pipe(v.number(), v.minValue(-1e6), v.maxValue(1e6)),
        }),
      ),
      v.minLength(1),
      v.maxLength(500),
    ),
  }),
  v.strictObject({ kind: v.literal('desktop.openDocumentation') }),
]);
export type DesktopRequest = v.InferOutput<typeof requestSchema>;
export const shellSchema = v.strictObject({
  connection: v.literal('unconfigured'),
  samples: v.boolean(),
});
export type ShellState = v.InferOutput<typeof shellSchema>;
export const connectionStatusSchema = v.picklist([
  'unconfigured',
  'connecting',
  'pairing',
  'online',
  'offline',
  'revoked',
  'incompatible',
]);
export const connectionProblemSchema = v.picklist([
  'INVALID_URL',
  'INSECURE_URL',
  'UNREACHABLE',
  'INVALID_RESPONSE',
  'PROTOCOL_UNSUPPORTED',
  'PAIRING_UNAVAILABLE',
  'PAIRING_REJECTED',
  'PAIRING_RATE_LIMITED',
  'PAIRING_UNCONFIRMED',
  'IDENTITY_MISMATCH',
  'CREDENTIAL_MISSING',
  'DEVICE_REVOKED',
]);
const uuid = v.pipe(v.string(), v.regex(/^[0-9a-f-]{36}$/));
// What the renderer may know about a connection: addresses and identities, never a token or
// credential handle.
export const connectionViewSchema = v.strictObject({
  status: connectionStatusSchema,
  profileId: v.nullable(uuid),
  problem: v.nullable(connectionProblemSchema),
  pairingPending: v.boolean(),
  credentialStorage: v.picklist(['persistent', 'session']),
  profiles: v.pipe(
    v.array(
      v.strictObject({
        localId: uuid,
        url: serverUrl,
        serverId: uuid,
        deviceId: uuid,
        deviceName: v.pipe(v.string(), v.maxLength(100)),
        pairedAt: v.number(),
        active: v.boolean(),
        credential: v.picklist(['saved', 'session', 'missing']),
      }),
    ),
    v.maxLength(20),
  ),
});
export type ConnectionView = v.InferOutput<typeof connectionViewSchema>;
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
// What the renderer may know about synchronization: its state, the size of the cache and the
// commands still being confirmed. Command bodies stay in main.
const runState = v.picklist([
  'QUEUED',
  'RUNNING',
  'WAITING',
  'HELD',
  'NEEDS_HUMAN',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'COMPLETED',
]);
const name = v.pipe(v.string(), v.maxLength(200));
// The synchronized summaries the shell navigates by.
export const overviewSchema = v.strictObject({
  projects: v.pipe(v.array(v.strictObject({ id: uuid, name })), v.maxLength(10000)),
  workflows: v.pipe(
    v.array(v.strictObject({ id: uuid, projectId: uuid, name, activeVersionId: v.nullable(uuid) })),
    v.maxLength(10000),
  ),
  runs: v.pipe(
    v.array(
      v.strictObject({
        id: uuid,
        state: runState,
        workflowId: v.nullable(uuid),
        createdAt: v.number(),
        finishedAt: v.nullable(v.number()),
      }),
    ),
    v.maxLength(10000),
  ),
  // Pending human requests and runs that need the owner.
  attention: count,
});
export type Overview = v.InferOutput<typeof overviewSchema>;
export const resourceKindSchema = v.picklist(['workflow', 'version', 'run']);
export type ResourceKind = v.InferOutput<typeof resourceKindSchema>;
export const commandViewSchema = v.strictObject({
  commandId: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{8,100}$/)),
  method: v.picklist(['POST', 'PUT']),
  path: v.pipe(v.string(), v.maxLength(2048)),
  state: v.picklist(['sending', 'unknown', 'accepted', 'rejected', 'not_applied']),
  code: v.nullable(v.pipe(v.string(), v.maxLength(100))),
  createdAt: v.number(),
  resendable: v.boolean(),
});
export const syncViewSchema = v.strictObject({
  status: v.picklist(['stopped', 'syncing', 'live', 'reconnecting']),
  problem: v.nullable(
    v.picklist([
      'UNREACHABLE',
      'INVALID_RESPONSE',
      'KEEPALIVE_TIMEOUT',
      'RESYNC_REQUIRED',
      'DEVICE_UNAUTHORIZED',
    ]),
  ),
  updatedAt: v.nullable(v.number()),
  cached: v.nullable(
    v.strictObject({ projects: count, workflows: count, runs: count, interactions: count }),
  ),
  commands: v.pipe(v.array(commandViewSchema), v.maxLength(100)),
});
export type SyncView = v.InferOutput<typeof syncViewSchema>;
export const errorSchema = v.strictObject({
  kind: v.literal('error'),
  code: v.picklist([
    'INVALID_REQUEST',
    'FORBIDDEN',
    'DISCONNECTED',
    'INVALID_RESPONSE',
    'NOT_FOUND',
    'UNAVAILABLE',
  ]),
  message: v.picklist([
    'The resource was not found.',
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
  v.strictObject({ kind: v.literal('connection'), connection: connectionViewSchema }),
  v.strictObject({ kind: v.literal('sync'), sync: syncViewSchema }),
  v.strictObject({ kind: v.literal('overview'), overview: overviewSchema }),
  // A server resource, checked by the generated protocol validator for its kind. `stale` marks
  // the last copy read while the connection is not live.
  v.strictObject({
    kind: v.literal('resource'),
    resource: resourceKindSchema,
    value: v.unknown(),
    stale: v.boolean(),
    fetchedAt: v.number(),
  }),
  v.strictObject({
    kind: v.literal('command'),
    command: commandViewSchema,
    runId: v.nullable(uuid),
  }),
  v.strictObject({ kind: v.literal('opened') }),
  // Generated protocol validators validate the value before this crosses IPC.
  v.strictObject({ kind: v.literal('server'), operation: querySchema, value: v.unknown() }),
  errorSchema,
]);
export type DesktopResponse = v.InferOutput<typeof responseSchema>;
export interface DesktopBridge {
  readShell(): Promise<DesktopResponse>;
  connection: {
    read(): Promise<DesktopResponse>;
    pair(form: { url: string; phrase: string; deviceName: string }): Promise<DesktopResponse>;
    abandonPairing(): Promise<DesktopResponse>;
    connect(profileId: string): Promise<DesktopResponse>;
    changeAddress(profileId: string, url: string): Promise<DesktopResponse>;
    clear(profileId: string): Promise<DesktopResponse>;
  };
  sync: {
    read(): Promise<DesktopResponse>;
  };
  data: {
    overview(): Promise<DesktopResponse>;
    workflow(workflowId: string): Promise<DesktopResponse>;
    version(workflowId: string, versionId: string): Promise<DesktopResponse>;
    run(runId: string): Promise<DesktopResponse>;
  };
  run: {
    start(workflowId: string, input: unknown): Promise<DesktopResponse>;
    cancel(runId: string): Promise<DesktopResponse>;
  };
  workflow: {
    // Saves node positions on the draft at `revision`; refused if the draft moved on.
    move(
      workflowId: string,
      revision: number,
      positions: { nodeId: string; x: number; y: number }[],
    ): Promise<DesktopResponse>;
  };
  // Calls the listener whenever connection or synchronized state may have changed.
  onChange(listener: () => void): () => void;
  setSamples(enabled: boolean): Promise<DesktopResponse>;
  queryServer(operation: FoundationQuery): Promise<DesktopResponse>;
  openDocumentation(): Promise<DesktopResponse>;
}

export function withinLimit(value: unknown, limit: number, maxDepth = 16): boolean {
  // IPC already clones the value. Reject non-JSON values and deep structures before parsing.
  let budget = limit;
  const seen = new Set<object>();
  function visit(item: unknown, depth: number): boolean {
    if (--budget < 0 || depth > maxDepth) return false;
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
  const move =
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'workflow.move';
  if (!withinLimit(value, move ? MOVE_LIMIT : REQUEST_LIMIT)) return undefined;
  const result = v.safeParse(requestSchema, value);
  return result.success ? result.output : undefined;
}
export function parseResponse(value: unknown): DesktopResponse | undefined {
  // Resources carry workflow documents, which may nest 32 levels below their envelope.
  const resource =
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'resource';
  if (!withinLimit(value, resource ? RESOURCE_LIMIT : RESPONSE_LIMIT, resource ? 48 : 16))
    return undefined;
  const result = v.safeParse(responseSchema, value);
  return result.success ? result.output : undefined;
}
