import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Real OpenCode and paid model calls: opt in with SHIFT_TEST_OPENCODE=1. By default the tests run
// against the owner's own OpenCode install and its credentials, as `shift serve` does.
// SHIFT_TEST_OPENCODE_ENVIRONMENT=isolated uses a private namespace instead; its key comes from
// SHIFT_TEST_OPENCODE_KEY or an API-key entry in the OpenCode auth file. OAuth entries are never
// copied into a namespace, so a test cannot rotate the owner's refresh token.
export const environment =
  process.env['SHIFT_TEST_OPENCODE_ENVIRONMENT'] === 'isolated' ? 'isolated' : 'host';
export const model = process.env['SHIFT_TEST_OPENCODE_MODEL'] ?? 'openai/gpt-6-luna';
export const [providerID = '', modelID = ''] = model.split(/\/(.*)/);

async function credentialKey(): Promise<string | undefined> {
  if (process.env['SHIFT_TEST_OPENCODE_KEY']) return process.env['SHIFT_TEST_OPENCODE_KEY'];
  try {
    const auth = JSON.parse(
      await readFile(join(homedir(), '.local/share/opencode/auth.json'), 'utf8'),
    ) as Record<string, { type?: string; key?: string }>;
    const entry = auth[providerID];
    return entry?.type === 'api' ? entry.key : undefined;
  } catch {
    return undefined;
  }
}

const enabled = process.env['SHIFT_TEST_OPENCODE'] === '1';
export const key = enabled && environment === 'isolated' ? await credentialKey() : undefined;
export const skip = !enabled
  ? 'set SHIFT_TEST_OPENCODE=1 to run real OpenCode model calls'
  : environment === 'isolated' && key === undefined && `no API-key credential for ${providerID}`;
