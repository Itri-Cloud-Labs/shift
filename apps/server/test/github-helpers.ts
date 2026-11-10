import { local, setup, type Env } from './action-helpers.js';
import { FakeGitHub } from './github-fake.js';

export type AppBody = {
  app: {
    id: string;
    webhookPath: string;
    privateKey: string;
    webhookSecret: string;
    installations: Array<{
      id: string;
      installationId: number;
      repositories: Array<{ id: number }>;
    }>;
  };
};

export const webhookSecret = 'whsec-0123456789abcdef';

// A project bound to the fake's acme/widgets (repository 9001) through its one installation.
export async function connected(
  options: { fake?: FakeGitHub; env?: Env } = {},
): Promise<{ env: Env; fake: FakeGitHub; appRowId: string; close(): Promise<void> }> {
  const env = options.env ?? (await setup());
  const fake = options.fake ?? new FakeGitHub(env.clock);
  if (!options.fake) await fake.start();
  const registered = (
    await env.github.register(
      { appId: fake.appId, host: fake.origin, privateKey: fake.privateKey, webhookSecret },
      local,
    )
  ).body as AppBody;
  const installation = registered.app.installations[0]!;
  await env.github.connect(
    env.projectId,
    { installationId: installation.id, repositoryId: 9001 },
    local,
  );
  return {
    env,
    fake,
    appRowId: registered.app.id,
    async close() {
      try {
        await env.close();
      } finally {
        await fake.stop();
      }
    },
  };
}
