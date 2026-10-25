import * as v from 'valibot';

export const IPC_CHANNEL = 'shift:desktop:v1';
export const REQUEST_LIMIT = 8 * 1024;
export const RESPONSE_LIMIT = 256 * 1024;
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
  v.strictObject({ kind: v.literal('connection'), connection: connectionViewSchema }),
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
