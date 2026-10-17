import { createHash } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// `host` runs OpenCode as the owner's own install: their config, credentials, plugins, skills and
// session store. `isolated` gives each Shift server a private namespace, for tests and CI. A
// private HOME is required there as well as XDG paths: OpenCode otherwise loads skills from the
// host account's home directory.
export type HarnessEnvironment = 'host' | 'isolated';

export interface NamespaceLayout {
  root: string;
  home: string;
  config: string;
  data: string;
  state: string;
  cache: string;
  tmp: string;
  plugin: string;
}

export function namespaceLayout(stateDirectory: string): NamespaceLayout {
  const root = join(stateDirectory, 'harness', 'opencode');
  return {
    root,
    home: join(root, 'home'),
    config: join(root, 'config'),
    data: join(root, 'data'),
    state: join(root, 'state'),
    cache: join(root, 'cache'),
    tmp: join(root, 'tmp'),
    plugin: join(root, 'plugin'),
  };
}

// Scope names carry this so stale runtimes of this namespace, and only this one, can be found.
export function namespaceId(layout: NamespaceLayout): string {
  return createHash('sha256').update(layout.root).digest('hex').slice(0, 12);
}

// Nothing else is inherited: provider keys, bus addresses and the server password stay out of the
// harness and therefore out of every tool shell it starts.
export function namespaceEnvironment(
  layout: NamespaceLayout,
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return {
    PATH: inherited['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    HOME: layout.home,
    XDG_CONFIG_HOME: layout.config,
    XDG_DATA_HOME: layout.data,
    XDG_STATE_HOME: layout.state,
    XDG_CACHE_HOME: layout.cache,
    TMPDIR: layout.tmp,
  };
}

// Variables that are Shift's own, or that would replace the password OpenCode prints at startup.
const withheld = (key: string) =>
  key.startsWith('SHIFT_') || key === 'OPENCODE_SERVER_PASSWORD' || key === 'OPENCODE_PASSWORD';

// The owner's environment, with the Shift plugin added to any inline config already present.
// OpenCode merges `OPENCODE_CONFIG_CONTENT` over the global config, so the owner's plugins stay.
export function hostEnvironment(
  layout: NamespaceLayout,
  endpoint: { url: string; token: string },
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined && !withheld(key)) env[key] = value;
  }
  let inline: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(env['OPENCODE_CONFIG_CONTENT'] ?? '{}');
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      inline = parsed as Record<string, unknown>;
    }
  } catch {
    // An unreadable inline config would fail OpenCode's own startup; Shift's replaces it.
  }
  const plugins = Array.isArray(inline['plugins']) ? inline['plugins'] : [];
  env['OPENCODE_CONFIG_CONTENT'] = JSON.stringify({
    ...inline,
    plugins: [...plugins, pluginEntry(layout, endpoint)],
  });
  return env;
}

// Where the owner's OpenCode keeps its session store, which identifies the namespace.
export function hostStorageNamespace(inherited: NodeJS.ProcessEnv = process.env): string {
  return join(inherited['XDG_DATA_HOME'] || join(homedir(), '.local', 'share'), 'opencode');
}

const pluginEntry = (layout: NamespaceLayout, endpoint: { url: string; token: string }) => ({
  package: layout.plugin,
  options: endpoint,
});

async function writePrivate(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function prepareNamespace(
  layout: NamespaceLayout,
  endpoint: { url: string; token: string },
  environment: HarnessEnvironment = 'isolated',
): Promise<void> {
  const isolatedDirectories =
    environment === 'isolated'
      ? [
          layout.home,
          join(layout.config, 'opencode'),
          layout.data,
          layout.state,
          layout.cache,
          layout.tmp,
        ]
      : [];
  for (const directory of [layout.root, ...isolatedDirectories, layout.plugin]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  await writePrivate(join(layout.plugin, 'index.mjs'), pluginSource);
  await writePrivate(
    join(layout.plugin, 'package.json'),
    `${JSON.stringify({ name: 'shift-opencode-plugin', private: true, type: 'module', exports: './index.mjs' }, null, 2)}\n`,
  );
  // Rewritten for every runtime generation because the endpoint port and token change. In host
  // mode the same entry travels in the environment instead.
  if (environment === 'isolated') {
    await writePrivate(
      join(layout.config, 'opencode', 'opencode.jsonc'),
      `${JSON.stringify({ plugins: [pluginEntry(layout, endpoint)] }, null, 2)}\n`,
    );
  }
}

export const pluginId = 'shift';
export const resultToolName = 'shift_submit_result';

// A direct (non-code-mode) tool, so each call is recorded in the transcript with its structured
// input. Shift decides validity; a rejection is thrown so the agent sees it as a tool error.
const pluginSource = `export default {
  id: ${JSON.stringify(pluginId)},
  async setup(ctx) {
    const { url, token } = ctx.options;
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: 'shift', description: 'Shift workflow integration' });
      editor.add({
        name: 'submit_result',
        description:
          'Submit the terminal result of the current Shift task. Call it when the task is completed, blocked or failed. If Shift rejects the result, correct it and call again.',
        input: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['completed', 'blocked', 'failed'] },
            // Any JSON value: arrays and scalars are valid business data. Shift validates it.
            data: {},
            blocker: {
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
              required: ['code', 'message'],
            },
            error: {
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
              required: ['code', 'message'],
            },
          },
          required: ['status'],
          additionalProperties: false,
        },
        options: { namespace: 'shift', codemode: false },
        execute: async (input, context) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
            body: JSON.stringify({
              sessionID: context.sessionID,
              messageID: context.messageID,
              callID: context.id,
              input,
            }),
            signal: context.signal,
          });
          if (!response.ok) throw new Error('Shift could not record the result. Try again.');
          const verdict = await response.json();
          if (!verdict.accepted) {
            throw new Error('Shift rejected the result: ' + verdict.reason + '. Correct it and call again.');
          }
          return { content: 'Shift accepted the result. End your turn now.' };
        },
      });
    });
  },
};
`;
