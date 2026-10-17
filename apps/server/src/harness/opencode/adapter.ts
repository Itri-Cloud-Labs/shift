import { setTimeout as delay } from 'node:timers/promises';
import { ShiftError } from '../../domain/errors.js';
import type {
  CancellationObservation,
  HarnessAdapter,
  HarnessCapabilities,
  HarnessCreateRequest,
  HarnessEvent,
  HarnessInvocationRequest,
  HarnessPrompt,
  HarnessSessionHandle,
  HarnessSessionObservation,
  InvocationCorrelation,
  InvocationObservation,
  Json,
  SubmissionReceipt,
} from '../types.js';
import { classifyInvocation, type OpenCodeMessage } from './classify.js';
import type { OpenCodeClient } from './client.js';
import { compilePermissions, type PermissionRule } from './permissions.js';
import { pluginId } from './namespace.js';
import type { OpenCodeRuntime, RuntimeGeneration } from './runtime.js';

// Evidence for each value is in docs/opencode-capabilities.md. Cancellation is an acknowledged
// stop only because the runtime's systemd scope contains tool processes the server cannot.
export const openCodeCapabilities: HarnessCapabilities = {
  persistedSessionResume: true,
  structuredSchemaDialect: 'adapter-translated',
  invocationInspection: 'durable_correlated',
  cancellation: 'acknowledged_stop',
  toolPolicy: 'enforced',
};

const agent = 'build';
const compact = (id: string) => id.replaceAll('-', '');

// Harness IDs derive from Shift IDs, so repeating a create or submit after a crash addresses the
// same session or message instead of starting a second one.
export const harnessSessionId = (shiftSessionId: string) => `ses_${compact(shiftSessionId)}`;
export const providerMessageId = (invocationId: string) => `msg_${compact(invocationId)}`;

const data = <T>(body: unknown): T => (body as { data: T }).data;

export class OpenCodeAdapter implements HarnessAdapter {
  readonly id = 'opencode';

  readonly #locations = new Map<string, PermissionRule[]>();

  readonly #pageSize: number;

  constructor(
    private readonly runtime: OpenCodeRuntime,
    options: { pageSize?: number } = {},
  ) {
    this.#pageSize = options.pageSize ?? 200;
  }

  capabilities(): HarnessCapabilities {
    return openCodeCapabilities;
  }

  async createSession(request: HarnessCreateRequest): Promise<HarnessSessionHandle> {
    const runtime = await this.runtime.ensure();
    const { client } = runtime;
    const id = harnessSessionId(request.shiftSessionId);
    // Created without an artifact directory and read-only; each submission sets its own policy.
    const permissions = compilePermissions(await this.#prepareLocation(runtime, request.cwd), {
      mode: 'read_only',
    });
    const created = await client.expect([200], 'POST', '/api/session', {
      body: {
        id,
        agent,
        model: request.model,
        location: { directory: request.cwd },
        metadata: {
          shift: { sessionId: request.shiftSessionId, operationId: request.operationId },
        },
        permissions,
      },
    });
    // Creating an existing ID returns that session unchanged and without a conflict signal.
    const session = data<{
      location?: { directory?: string };
      model?: { providerID?: string; id?: string };
      metadata?: { shift?: { sessionId?: string } };
    }>(created.body);
    if (
      session.location?.directory !== request.cwd ||
      session.metadata?.shift?.sessionId !== request.shiftSessionId ||
      session.model?.providerID !== request.model.providerID ||
      session.model?.id !== request.model.id
    ) {
      throw new ShiftError(
        'HARNESS_SESSION_CONFLICT',
        'An OpenCode session with this identity exists with a different directory, model or owner.',
        409,
      );
    }
    return {
      shiftSessionId: request.shiftSessionId,
      harnessSessionId: id,
      storageNamespace: this.runtime.layout.root,
      cwd: request.cwd,
    };
  }

  async inspectSession(handle: HarnessSessionHandle): Promise<HarnessSessionObservation> {
    const { client } = await this.runtime.ensure();
    const response = await client.request('GET', `/api/session/${handle.harnessSessionId}`);
    if (response.status === 404) return { kind: 'missing' };
    if (response.status !== 200) {
      throw new ShiftError('HARNESS_REQUEST_FAILED', 'OpenCode session inspection failed.', 502);
    }
    const session = data<{ location?: { directory?: string }; metadata?: Json }>(response.body);
    return {
      kind: 'present',
      active: await this.#active(client, handle.harnessSessionId),
      cwd: session.location?.directory ?? '',
      metadata: session.metadata ?? null,
    };
  }

  // Acceptance means "in the harness inbox", never completion. Anything short of an echoed
  // acknowledgement is uncertain and must be inspected before a resubmission.
  async submit(
    handle: HarnessSessionHandle,
    request: HarnessInvocationRequest,
  ): Promise<SubmissionReceipt> {
    const correlation: InvocationCorrelation = {
      shiftInvocationId: request.invocationId,
      providerMessageId: providerMessageId(request.invocationId),
    };
    const runtime = await this.runtime.ensure();
    const { client } = runtime;
    const permissions = compilePermissions(
      await this.#prepareLocation(runtime, handle.cwd),
      request.toolPolicy,
      request.artifactDirectory,
    );
    await client.expect([200, 204], 'PATCH', `/api/session/${handle.harnessSessionId}`, {
      body: { permissions },
    });
    let ack;
    try {
      ack = await client.request('POST', `/api/session/${handle.harnessSessionId}/prompt`, {
        body: {
          id: correlation.providerMessageId,
          text: request.goal,
          metadata: { shift: { invocationId: request.invocationId } },
        },
      });
    } catch {
      return {
        kind: 'uncertain',
        correlation,
        explanation: 'The prompt was sent but no acknowledgement arrived.',
      };
    }
    if (
      ack.status === 200 &&
      data<{ id?: string }>(ack.body)?.id === correlation.providerMessageId
    ) {
      return { kind: 'accepted', correlation };
    }
    if (ack.status >= 400 && ack.status < 500) {
      throw new ShiftError(
        'HARNESS_SUBMISSION_REJECTED',
        `OpenCode rejected the prompt with HTTP ${ack.status}.`,
        409,
      );
    }
    return {
      kind: 'uncertain',
      correlation,
      explanation: `OpenCode answered the prompt with HTTP ${ack.status}.`,
    };
  }

  async inspectInvocation(
    handle: HarnessSessionHandle,
    correlation: InvocationCorrelation,
  ): Promise<InvocationObservation> {
    const { client } = await this.runtime.ensure();
    const sessionId = handle.harnessSessionId;
    const messageId = correlation.providerMessageId;
    // Read the inbox first: delivery moves an item from the inbox to the messages, so this order
    // cannot report a delivered prompt as never accepted.
    const queued = (await this.#inbox(client, sessionId)).some((item) => item.id === messageId);
    const lookup = await client.request('GET', `/api/session/${sessionId}/message/${messageId}`);
    if (lookup.status !== 200 && lookup.status !== 404) {
      throw new ShiftError('HARNESS_REQUEST_FAILED', 'OpenCode message inspection failed.', 502);
    }
    const messageFound = lookup.status === 200;
    const active = await this.#active(client, sessionId);
    const prompts = await this.#prompts(client, sessionId);
    const messages = messageFound ? await this.#messages(client, sessionId) : [];
    const index = messages.findIndex((message) => message.id === messageId);
    if (messageFound && index < 0) {
      throw new ShiftError(
        'HARNESS_REQUEST_FAILED',
        'The prompt is missing from the transcript.',
        502,
      );
    }
    const after = messages.slice(index + 1);
    const next = after.findIndex((message) => message.type === 'user');
    return classifyInvocation({
      messageFound,
      queued,
      active,
      prompts,
      turn: next < 0 ? after : after.slice(0, next),
      followedByUserMessage: next >= 0,
    });
  }

  async *observe(handle: HarnessSessionHandle, signal: AbortSignal): AsyncIterable<HarnessEvent> {
    const { client } = await this.runtime.ensure();
    for await (const event of client.events(signal)) {
      const payload = event.data ?? {};
      if (payload['sessionID'] !== handle.harnessSessionId) continue;
      const at = event.created ?? Date.now();
      const harnessSessionId = handle.harnessSessionId;
      if (event.type === 'permission.asked' || event.type === 'form.created') {
        const id = payload['id'] ?? payload['requestID'] ?? payload['formID'];
        yield {
          kind: 'prompt_requested',
          harnessSessionId,
          prompt: {
            kind: event.type === 'permission.asked' ? 'permission' : 'question',
            id: typeof id === 'string' ? id : '',
          },
          at,
        };
      } else if (/^session\.execution\.(succeeded|failed|interrupted)$/.test(event.type)) {
        yield { kind: 'turn_ended', harnessSessionId, type: event.type, at };
      } else if (event.type.startsWith('session.')) {
        yield { kind: 'activity', harnessSessionId, type: event.type, at };
      }
    }
  }

  // A stop is accounted for only when the turn is no longer running, no queued input remains, and
  // no process in the runtime scope still carries this session's ID.
  async cancel(
    handle: HarnessSessionHandle,
    correlation: InvocationCorrelation,
  ): Promise<CancellationObservation> {
    const { client } = await this.runtime.ensure();
    const sessionId = handle.harnessSessionId;
    for (const item of await this.#inbox(client, sessionId)) {
      await client.expect([200, 204, 404], 'DELETE', `/api/session/${sessionId}/inbox/${item.id}`);
    }
    for (const prompt of await this.#prompts(client, sessionId)) {
      if (prompt.kind === 'permission') {
        await client.expect(
          [200, 204, 404],
          'POST',
          `/api/session/${sessionId}/permission/${prompt.id}/reply`,
          { body: { decision: 'reject', message: 'Shift cancelled this invocation.' } },
        );
      } else {
        await client.expect(
          [200, 204, 404],
          'DELETE',
          `/api/session/${sessionId}/form/${prompt.id}`,
        );
      }
    }
    await client.expect([200], 'POST', `/api/session/${sessionId}/interrupt`);
    const deadline = Date.now() + 10_000;
    let observation = await this.inspectInvocation(handle, correlation);
    let processes = await this.runtime.sessionProcesses(sessionId);
    while (
      (observation.kind === 'running' ||
        observation.kind === 'awaiting_harness_prompt' ||
        processes.length > 0) &&
      Date.now() < deadline
    ) {
      await delay(200);
      observation = await this.inspectInvocation(handle, correlation);
      processes = await this.runtime.sessionProcesses(sessionId);
    }
    if (observation.kind === 'running' || observation.kind === 'awaiting_harness_prompt') {
      return { kind: 'unconfirmed', explanation: 'The turn did not stop.', observation };
    }
    if (processes.length > 0) {
      return {
        kind: 'unconfirmed',
        explanation: 'Tool processes of the session are still running.',
        observation,
      };
    }
    return { kind: 'stopped', observation };
  }

  // OpenCode v2 has no archive operation that keeps history, so archiving is Shift-side state.
  async archive(): Promise<void> {}

  // OpenCode loads agents and plugins lazily for each directory, so a session's agent defaults and
  // result tool exist only after its location has booted. Returns the agent's permission rules.
  async #prepareLocation(runtime: RuntimeGeneration, cwd: string): Promise<PermissionRule[]> {
    const key = `${runtime.generation}:${cwd}`;
    const cached = this.#locations.get(key);
    if (cached) return cached;
    const deadline = Date.now() + 15_000;
    for (;;) {
      const agents = await runtime.client.request('GET', '/api/agent', { location: cwd });
      if (agents.status === 404) {
        throw new ShiftError(
          'HARNESS_LOCATION_UNAVAILABLE',
          'OpenCode cannot open the session directory.',
          422,
        );
      }
      const plugins = await runtime.client.expect([200], 'GET', '/api/plugin', { location: cwd });
      const rules = data<Array<{ id: string; permissions: PermissionRule[] }>>(agents.body)?.find(
        (candidate) => candidate.id === agent,
      )?.permissions;
      const loaded = data<Array<{ id: string; state?: { status?: string } }>>(plugins.body).some(
        (plugin) => plugin.id === pluginId && plugin.state?.status === 'active',
      );
      if (agents.status === 200 && rules && loaded) {
        this.#locations.set(key, rules);
        return rules;
      }
      if (Date.now() > deadline) {
        throw new ShiftError(
          'HARNESS_LOCATION_UNAVAILABLE',
          'OpenCode did not load its agent and the Shift plugin for the session directory.',
          503,
        );
      }
      await delay(200);
    }
  }

  async #active(client: OpenCodeClient, sessionId: string): Promise<boolean> {
    const response = await client.expect([200], 'GET', '/api/session/active');
    return Boolean(data<Record<string, unknown>>(response.body)[sessionId]);
  }

  async #inbox(client: OpenCodeClient, sessionId: string): Promise<Array<{ id: string }>> {
    const response = await client.expect([200], 'GET', `/api/session/${sessionId}/inbox`);
    return data<Array<{ id: string }>>(response.body);
  }

  async #prompts(client: OpenCodeClient, sessionId: string): Promise<HarnessPrompt[]> {
    const permissions = await client.expect([200], 'GET', `/api/session/${sessionId}/permission`);
    const forms = await client.expect([200], 'GET', `/api/session/${sessionId}/form`);
    return [
      ...data<Array<{ id: string }>>(permissions.body).map(({ id }): HarnessPrompt => ({
        kind: 'permission',
        id,
      })),
      ...data<Array<{ id: string }>>(forms.body).map(({ id }): HarnessPrompt => ({
        kind: 'question',
        id,
      })),
    ];
  }

  async #messages(client: OpenCodeClient, sessionId: string): Promise<OpenCodeMessage[]> {
    const messages: OpenCodeMessage[] = [];
    let cursor: string | undefined;
    for (;;) {
      // A cursor carries its own direction; OpenCode rejects it combined with `order`.
      const query = new URLSearchParams({ limit: String(this.#pageSize) });
      if (cursor) query.set('cursor', cursor);
      else query.set('order', 'asc');
      const response = await client.expect(
        [200],
        'GET',
        `/api/session/${sessionId}/message?${query}`,
      );
      const page = response.body as { data: OpenCodeMessage[]; cursor?: { next?: string | null } };
      messages.push(...page.data);
      if (page.data.length < this.#pageSize || !page.cursor?.next) return messages;
      cursor = page.cursor.next;
    }
  }
}
