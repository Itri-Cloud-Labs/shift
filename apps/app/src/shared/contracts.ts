import * as v from 'valibot';

export const IPC_CHANNEL = 'shift:desktop:v1';
// Main tells the renderer that connection or synchronized state changed; it carries no data.
export const CHANGE_CHANNEL = 'shift:desktop:v1:changed';
export const REQUEST_LIMIT = 8 * 1024;
// Saving sends the whole draft, which the server limits to 1 MiB.
export const SAVE_LIMIT = 1024 * 1024 + 1024;
export const ANSWER_LIMIT = 64 * 1024;
export const RESPONSE_LIMIT = 256 * 1024;
// Workflow documents and runs with their executions can be larger than other answers.
export const RESOURCE_LIMIT = 8 * 1024 * 1024;
export const querySchema = v.picklist(['info', 'health', 'ready']);
export type FoundationQuery = v.InferOutput<typeof querySchema>;
const profileId = v.pipe(v.string(), v.regex(/^[0-9a-f-]{36}$/));
const actionPermission = v.picklist(['command', 'http', 'script', 'git', 'git_push', 'github']);
const privateKey = v.pipe(v.string(), v.minLength(100), v.maxLength(16384));
const webhookSecret = v.pipe(v.string(), v.minLength(16), v.maxLength(256));
const serverUrl = v.pipe(v.string(), v.minLength(1), v.maxLength(2048));
// This computer's own choices: they never reach the server.
export const preferencesSchema = v.strictObject({
  theme: v.picklist(['system', 'light', 'dark']),
  notifications: v.boolean(),
});
export type Preferences = v.InferOutput<typeof preferencesSchema>;
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
  // Agent sessions, their conversation and the reports runs produced.
  v.strictObject({ kind: v.literal('data.sessions'), projectId: profileId }),
  v.strictObject({ kind: v.literal('data.session'), sessionId: profileId }),
  v.strictObject({
    kind: v.literal('data.transcript'),
    sessionId: profileId,
    after: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  }),
  v.strictObject({ kind: v.literal('data.artifacts'), runId: profileId }),
  v.strictObject({ kind: v.literal('data.report'), artifactId: profileId }),
  // A project's credentials by name, and the actions it denies.
  v.strictObject({ kind: v.literal('data.credentials'), projectId: profileId }),
  v.strictObject({ kind: v.literal('data.permissions'), projectId: profileId }),
  // A credential value crosses IPC once, from its field to main, and is never sent back.
  v.strictObject({
    kind: v.literal('credential.put'),
    projectId: profileId,
    name: v.pipe(v.string(), v.regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)),
    value: v.pipe(v.string(), v.minLength(1), v.maxLength(16 * 1024)),
  }),
  v.strictObject({
    kind: v.literal('credential.revoke'),
    projectId: profileId,
    credentialId: profileId,
  }),
  v.strictObject({
    kind: v.literal('project.permissions'),
    projectId: profileId,
    allow: v.array(actionPermission),
    deny: v.array(actionPermission),
  }),
  // The owner's GitHub App and the project's repository binding.
  v.strictObject({ kind: v.literal('data.githubApps') }),
  v.strictObject({ kind: v.literal('data.github'), projectId: profileId }),
  // The App's key and webhook secret cross IPC once, from their fields to main, and are never
  // sent back: the server answers with configured or missing.
  v.strictObject({
    kind: v.literal('github.register'),
    appId: v.pipe(v.number(), v.integer(), v.minValue(1)),
    host: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
    privateKey,
    webhookSecret: v.optional(webhookSecret),
  }),
  v.strictObject({
    kind: v.literal('github.rotate'),
    appId: profileId,
    privateKey: v.optional(privateKey),
    webhookSecret: v.optional(webhookSecret),
  }),
  v.strictObject({ kind: v.literal('github.refresh'), appId: profileId }),
  v.strictObject({
    kind: v.literal('github.connect'),
    projectId: profileId,
    installationId: profileId,
    repositoryId: v.pipe(v.number(), v.integer(), v.minValue(1)),
  }),
  v.strictObject({ kind: v.literal('github.verify'), projectId: profileId }),
  v.strictObject({ kind: v.literal('github.disconnect'), projectId: profileId }),
  // The owner's own goal for a session, outside any run.
  v.strictObject({
    kind: v.literal('session.goal'),
    sessionId: profileId,
    goal: v.pipe(v.string(), v.minLength(1), v.maxLength(4000)),
  }),
  // The trigger input is any JSON value; the request size limit bounds it.
  v.strictObject({ kind: v.literal('run.start'), workflowId: profileId, input: v.unknown() }),
  v.strictObject({ kind: v.literal('run.cancel'), runId: profileId }),
  // The owner's decision for a run that needs them. The server checks that it applies.
  v.strictObject({
    kind: v.literal('run.control'),
    runId: profileId,
    control: v.variant('kind', [
      v.strictObject({ kind: v.literal('retry') }),
      v.strictObject({
        kind: v.literal('fail'),
        reason: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(1000))),
      }),
      v.strictObject({ kind: v.literal('complete'), data: v.unknown() }),
      v.strictObject({
        kind: v.literal('extend'),
        executions: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000))),
        activeMs: v.optional(
          v.pipe(v.number(), v.integer(), v.minValue(1000), v.maxValue(30 * 24 * 3_600_000)),
        ),
      }),
    ]),
  }),
  v.strictObject({ kind: v.literal('data.interactions') }),
  // An answer to a human request, at the revision the form showed.
  v.strictObject({
    kind: v.literal('interaction.respond'),
    interactionId: profileId,
    revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
    decision: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
    response: v.record(v.string(), v.unknown()),
  }),
  // The server validates the draft's shape; a draft may be invalid until it is published.
  v.strictObject({
    kind: v.literal('workflow.save'),
    workflowId: profileId,
    revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
    draft: v.record(v.string(), v.unknown()),
  }),
  v.strictObject({
    kind: v.literal('workflow.publish'),
    workflowId: profileId,
    revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
  }),
  // A project is a repository on the server, so its path means nothing on this computer.
  v.strictObject({
    kind: v.literal('project.create'),
    path: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)),
  }),
  v.strictObject({
    kind: v.literal('workflow.create'),
    projectId: profileId,
    name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  }),
  // Unsaved edits kept on this computer for the connected server; they never leave main.
  v.strictObject({ kind: v.literal('recovery.list') }),
  v.strictObject({
    kind: v.literal('recovery.keep'),
    workflowId: profileId,
    revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
    draft: v.record(v.string(), v.unknown()),
  }),
  v.strictObject({ kind: v.literal('recovery.forget'), workflowId: profileId }),
  v.strictObject({ kind: v.literal('data.devices') }),
  v.strictObject({ kind: v.literal('device.revoke'), deviceId: profileId }),
  v.strictObject({ kind: v.literal('preferences.read') }),
  v.strictObject({ kind: v.literal('preferences.set'), preferences: preferencesSchema }),
  v.strictObject({ kind: v.literal('desktop.openDocumentation') }),
]);
export type DesktopRequest = v.InferOutput<typeof requestSchema>;
export type RunControl = Extract<DesktopRequest, { kind: 'run.control' }>['control'];
export type Answer = Pick<
  Extract<DesktopRequest, { kind: 'interaction.respond' }>,
  'revision' | 'decision' | 'response'
>;
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
export const resourceKindSchema = v.picklist([
  'workflow',
  'version',
  'run',
  'sessions',
  'session',
  'transcript',
  'artifacts',
  'credentials',
  'permissions',
  'github',
  'githubApps',
]);
export type ResourceKind = v.InferOutput<typeof resourceKindSchema>;
export const commandViewSchema = v.strictObject({
  commandId: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{8,100}$/)),
  method: v.picklist(['POST', 'PUT']),
  path: v.pipe(v.string(), v.maxLength(2048)),
  state: v.picklist(['sending', 'unknown', 'accepted', 'rejected', 'not_applied']),
  code: v.nullable(v.pipe(v.string(), v.maxLength(100))),
  createdAt: v.number(),
  resendable: v.boolean(),
  // The server's explanation of a rejected command, while this session still holds it.
  message: v.nullable(v.pipe(v.string(), v.maxLength(2000))),
  // The rejected fields, as JSON pointers with what is wrong. In memory only, like `message`.
  diagnostics: v.pipe(
    v.array(
      v.strictObject({
        field: v.pipe(v.string(), v.maxLength(500)),
        message: v.pipe(v.string(), v.maxLength(500)),
      }),
    ),
    v.maxLength(32),
  ),
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
  // Pending human requests and the settled ones seen since the snapshot, checked by the
  // generated interaction list validator.
  v.strictObject({ kind: v.literal('interactions'), value: v.unknown() }),
  v.strictObject({
    kind: v.literal('command'),
    command: commandViewSchema,
    runId: v.nullable(uuid),
    // What a create command made, when its answer has arrived.
    createdId: v.optional(uuid),
  }),
  // Checked by the generated protocol validator before this crosses IPC.
  v.strictObject({ kind: v.literal('devices'), value: v.unknown() }),
  // A report's metadata, checked by the protocol validator, and its text, at most 1 MiB.
  v.strictObject({
    kind: v.literal('report'),
    artifact: v.unknown(),
    text: v.pipe(v.string(), v.maxLength(1024 * 1024)),
  }),
  v.strictObject({ kind: v.literal('preferences'), preferences: preferencesSchema }),
  v.strictObject({
    kind: v.literal('recovery'),
    drafts: v.pipe(
      v.array(
        v.strictObject({
          workflowId: uuid,
          revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
          draft: v.record(v.string(), v.unknown()),
          keptAt: v.number(),
        }),
      ),
      v.maxLength(20),
    ),
  }),
  v.strictObject({ kind: v.literal('kept') }),
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
    devices(): Promise<DesktopResponse>;
    sessions(projectId: string): Promise<DesktopResponse>;
    session(sessionId: string): Promise<DesktopResponse>;
    transcript(sessionId: string, after?: number): Promise<DesktopResponse>;
    artifacts(runId: string): Promise<DesktopResponse>;
    report(artifactId: string): Promise<DesktopResponse>;
    credentials(projectId: string): Promise<DesktopResponse>;
    permissions(projectId: string): Promise<DesktopResponse>;
    github(projectId: string): Promise<DesktopResponse>;
    githubApps(): Promise<DesktopResponse>;
  };
  github: {
    // The key and secret are sent once and never read back.
    register(input: {
      appId: number;
      host?: string;
      privateKey: string;
      webhookSecret?: string;
    }): Promise<DesktopResponse>;
    rotate(
      appId: string,
      input: { privateKey?: string; webhookSecret?: string },
    ): Promise<DesktopResponse>;
    refresh(appId: string): Promise<DesktopResponse>;
    connect(
      projectId: string,
      installationId: string,
      repositoryId: number,
    ): Promise<DesktopResponse>;
    verify(projectId: string): Promise<DesktopResponse>;
    disconnect(projectId: string): Promise<DesktopResponse>;
  };
  credential: {
    // Creates the named credential or replaces its value. The value is never read back.
    put(projectId: string, name: string, value: string): Promise<DesktopResponse>;
    revoke(projectId: string, credentialId: string): Promise<DesktopResponse>;
  };
  session: {
    // Sends the owner's own goal to a session outside any run.
    goal(sessionId: string, goal: string): Promise<DesktopResponse>;
  };
  run: {
    start(workflowId: string, input: unknown): Promise<DesktopResponse>;
    cancel(runId: string): Promise<DesktopResponse>;
    control(runId: string, control: RunControl): Promise<DesktopResponse>;
  };
  interaction: {
    list(): Promise<DesktopResponse>;
    respond(interactionId: string, answer: Answer): Promise<DesktopResponse>;
  };
  workflow: {
    // Replaces the draft at `revision`; refused if the draft moved on.
    save(
      workflowId: string,
      revision: number,
      draft: Record<string, unknown>,
    ): Promise<DesktopResponse>;
    // Publishes exactly the draft at `revision`.
    publish(workflowId: string, revision: number): Promise<DesktopResponse>;
    create(projectId: string, name: string): Promise<DesktopResponse>;
  };
  project: {
    create(path: string): Promise<DesktopResponse>;
    permissions(projectId: string, allow: string[], deny: string[]): Promise<DesktopResponse>;
  };
  recovery: {
    list(): Promise<DesktopResponse>;
    keep(
      workflowId: string,
      revision: number,
      draft: Record<string, unknown>,
    ): Promise<DesktopResponse>;
    forget(workflowId: string): Promise<DesktopResponse>;
  };
  device: {
    revoke(deviceId: string): Promise<DesktopResponse>;
  };
  preferences: {
    read(): Promise<DesktopResponse>;
    set(preferences: Preferences): Promise<DesktopResponse>;
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
  const kind =
    typeof value === 'object' && value !== null ? (value as { kind?: unknown }).kind : undefined;
  const limit =
    kind === 'workflow.save' || kind === 'recovery.keep'
      ? SAVE_LIMIT
      : kind === 'interaction.respond' ||
          kind === 'run.control' ||
          kind === 'session.goal' ||
          kind === 'credential.put' ||
          kind === 'github.register' ||
          kind === 'github.rotate'
        ? ANSWER_LIMIT
        : REQUEST_LIMIT;
  // A draft may nest 32 levels below its envelope.
  if (!withinLimit(value, limit, kind === 'workflow.save' || kind === 'recovery.keep' ? 48 : 16))
    return undefined;
  const result = v.safeParse(requestSchema, value);
  return result.success ? result.output : undefined;
}
export function parseResponse(value: unknown): DesktopResponse | undefined {
  // Resources carry workflow documents, which may nest 32 levels below their envelope, and
  // requests carry their frozen forms.
  const kind =
    typeof value === 'object' && value !== null ? (value as { kind?: unknown }).kind : undefined;
  const resource =
    kind === 'resource' || kind === 'interactions' || kind === 'recovery' || kind === 'report';
  if (!withinLimit(value, resource ? RESOURCE_LIMIT : RESPONSE_LIMIT, resource ? 48 : 16))
    return undefined;
  const result = v.safeParse(responseSchema, value);
  return result.success ? result.output : undefined;
}
