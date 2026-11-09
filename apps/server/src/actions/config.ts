import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import { renderTemplate, renderText } from '../runs/bindings.js';

// Action configurations as frozen when their execution is prepared (specification 6.1): bindings
// are applied once, so a retry or a recovery repeats exactly the recorded request. Credentials stay
// names; their values are read only when the action runs and never enter this record.

export interface CommandConfig {
  action: 'command';
  mode: 'exec' | 'shell';
  executable: string;
  args: string[];
  // The workspace-relative directory, and the workspace it is in.
  cwd: string;
  workspaceId: string;
  env: Record<string, string>;
  credentials: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  parseJson: boolean;
  safeToRetry: boolean;
}

export interface HttpConfig {
  action: 'http';
  method: string;
  url: string;
  headers: Record<string, string>;
  credentialHeaders: Record<string, { credential: string; prefix: string }>;
  body: { kind: 'json'; value: Json } | { kind: 'text'; text: string; contentType: string } | null;
  timeoutMs: number;
  maxResponseBytes: number;
  responseSchema: Json | null;
  followRedirects: boolean;
  safeToRetry: boolean;
}

export interface ScriptConfig {
  action: 'script';
  source: string;
  input: Json;
  bindings: Record<string, Json>;
  timeoutMs: number;
  resultSchema: Json | null;
  safeToRetry: boolean;
}

export type ActionConfig = CommandConfig | HttpConfig | ScriptConfig;

export const actionTypes = new Set(['command', 'http', 'script']);

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

// Whether repeating the action cannot change anything: a read, or what the author declared safe.
export function safeToRepeat(config: ActionConfig): boolean {
  return config.safeToRetry || (config.action === 'http' && safeMethods.has(config.method));
}

function checkUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ShiftError('INVALID_REQUEST_URL', 'The request URL is not an absolute URL.', 422);
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new ShiftError('INVALID_REQUEST_URL', 'Only http and https URLs are supported.', 422);
  if (parsed.username || parsed.password)
    throw new ShiftError(
      'INVALID_REQUEST_URL',
      'The request URL carries credentials; use a credential header.',
      422,
    );
}

const lineBreak = /[\r\n\0]/;

export function freezeAction(
  type: string,
  authored: Record<string, Json>,
  bindings: Record<string, Json>,
  input: Json,
  workspaceId: string | undefined,
): ActionConfig {
  if (type === 'command') {
    if (!workspaceId)
      throw new ShiftError('WORKSPACE_UNAVAILABLE', 'This run has no workspace for commands.', 422);
    const shell = authored['mode'] === 'shell';
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries((authored['env'] ?? {}) as Record<string, string>)) {
      const rendered = renderText(value, bindings);
      if (rendered.includes('\0'))
        throw new ShiftError('INVALID_ARGUMENT', `Environment value ${name} contains NUL.`, 422);
      env[name] = rendered;
    }
    const args = ((authored['args'] ?? []) as string[]).map((arg) => renderText(arg, bindings));
    if (args.some((arg) => arg.includes('\0')))
      throw new ShiftError('INVALID_ARGUMENT', 'A command argument contains NUL.', 422);
    return {
      action: 'command',
      mode: shell ? 'shell' : 'exec',
      executable: shell ? '/bin/sh' : (authored['executable'] as string),
      args: shell ? ['-c', authored['script'] as string] : args,
      cwd: (authored['cwd'] as string | undefined) ?? '.',
      workspaceId,
      env,
      credentials: (authored['credentials'] ?? {}) as Record<string, string>,
      timeoutMs: (authored['timeoutMs'] as number | undefined) ?? 10 * 60 * 1000,
      maxOutputBytes: (authored['maxOutputBytes'] as number | undefined) ?? 64 * 1024,
      parseJson: authored['parseJson'] === true,
      safeToRetry: authored['safeToRetry'] === true,
    };
  }
  if (type === 'http') {
    const url = renderText(authored['url'] as string, bindings);
    checkUrl(url);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(
      (authored['headers'] ?? {}) as Record<string, string>,
    )) {
      const rendered = renderText(value, bindings);
      if (lineBreak.test(rendered))
        throw new ShiftError('INVALID_ARGUMENT', `Header ${name} contains a line break.`, 422);
      headers[name] = rendered;
    }
    const body = authored['body'] as
      | { kind: 'json'; value: Json }
      | { kind: 'text'; text: string; contentType?: string }
      | undefined;
    const credentialHeaders: HttpConfig['credentialHeaders'] = {};
    for (const [name, ref] of Object.entries(
      (authored['credentialHeaders'] ?? {}) as Record<
        string,
        { credential: string; prefix?: string }
      >,
    ))
      credentialHeaders[name] = { credential: ref.credential, prefix: ref.prefix ?? '' };
    return {
      action: 'http',
      method: (authored['method'] as string | undefined) ?? 'GET',
      url,
      headers,
      credentialHeaders,
      body: !body
        ? null
        : body.kind === 'json'
          ? { kind: 'json', value: renderTemplate(body.value, bindings) }
          : {
              kind: 'text',
              text: renderText(body.text, bindings),
              contentType: body.contentType ?? 'text/plain; charset=utf-8',
            },
      timeoutMs: (authored['timeoutMs'] as number | undefined) ?? 30_000,
      maxResponseBytes: (authored['maxResponseBytes'] as number | undefined) ?? 1024 * 1024,
      responseSchema: (authored['responseSchema'] as Json | undefined) ?? null,
      followRedirects: authored['followRedirects'] === true,
      safeToRetry: authored['safeToRetry'] === true,
    };
  }
  if (type === 'script') {
    return {
      action: 'script',
      source: authored['source'] as string,
      input,
      bindings,
      timeoutMs: (authored['timeoutMs'] as number | undefined) ?? 10_000,
      resultSchema: (authored['resultSchema'] as Json | undefined) ?? null,
      safeToRetry: authored['safeToRetry'] === true,
    };
  }
  throw new ShiftError('UNSUPPORTED_NODE', `${type} is not an action.`, 422);
}
