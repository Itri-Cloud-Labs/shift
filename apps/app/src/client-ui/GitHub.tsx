import { CircleAlert, Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { DesktopResponse } from '../shared/contracts.js';
import { ask, bridge, useLive } from './bridge.js';
import { relativeTime } from './time.js';

interface App {
  id: string;
  appId: number;
  host: string;
  name: string | null;
  webhookSecret: 'configured' | 'missing';
  webhookPath: string;
  verifiedAt: number | null;
  installations: Array<{
    id: string;
    account: string;
    state: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
    repositories: Array<{ id: number; owner: string; name: string }>;
  }>;
}
interface Connection {
  installationId: string;
  repository: { id: number; owner: string; name: string; defaultBranch: string };
  verifiedAt: number | null;
  diagnostics: Array<{ node: string; missing: Record<string, string> }>;
}

export const githubNodeLabels: Record<string, string> = {
  github_get_pr: 'Get pull request',
  github_create_pr: 'Create pull request',
  github_update_pr: 'Update pull request',
  github_verify_checks: 'Verify checks',
  github_wait_checks: 'Wait for checks',
  github_merge: 'Merge',
  git_push: 'Push with the App',
};

const permissionLabels: Record<string, string> = {
  metadata: 'metadata',
  contents: 'contents',
  pull_requests: 'pull requests',
  checks: 'checks',
  statuses: 'commit statuses',
};

export const describePermissions = (permissions: Record<string, string>) =>
  Object.entries(permissions)
    .map(([name, level]) => `${permissionLabels[name] ?? name}: ${level}`)
    .join(', ');

// The project's GitHub repository through the owner's own App. The App is registered once for the
// server; its key and webhook secret are sent once and never shown again.
export function GitHubSettings({
  project,
  live,
  settled,
  serverUrl,
  send,
}: {
  project: string;
  live: boolean;
  settled: string | null;
  serverUrl: string | null;
  send: (call: Promise<DesktopResponse>) => Promise<boolean>;
}) {
  const apps = useLive(async () => {
    const answer = await ask(bridge().data.githubApps());
    return answer.kind === 'resource' ? (answer.value as { apps: App[] }).apps : null;
  }, [settled]);
  const connection = useLive(async () => {
    const answer = await ask(bridge().data.github(project));
    return answer.kind === 'resource'
      ? { value: (answer.value as { connection: Connection | null }).connection }
      : null;
  }, [project, settled]);
  if (apps === null || connection === null)
    return (
      <p className="settings-unavailable" role="status">
        <CircleAlert aria-hidden="true" />
        GitHub can be set up once the server is connected.
      </p>
    );
  if (apps === undefined || connection === undefined) return null;
  const app = apps[0];
  return (
    <>
      {app ? (
        <AppCard app={app} live={live} serverUrl={serverUrl} send={send} />
      ) : (
        <RegisterApp live={live} send={send} />
      )}
      {app &&
        (connection.value ? (
          <Bound
            connection={connection.value}
            apps={apps}
            live={live}
            project={project}
            send={send}
          />
        ) : (
          <Bind apps={apps} live={live} project={project} send={send} />
        ))}
    </>
  );
}

function RegisterApp({
  live,
  send,
}: {
  live: boolean;
  send: (call: Promise<DesktopResponse>) => Promise<boolean>;
}) {
  const [appId, setAppId] = useState('');
  const [host, setHost] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [secret, setSecret] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // The secret fields are cleared as soon as the values have left for main.
    const input = {
      appId: Number(appId),
      privateKey,
      ...(host.trim() ? { host: host.trim() } : {}),
      ...(secret ? { webhookSecret: secret } : {}),
    };
    setPrivateKey('');
    setSecret('');
    if (await send(bridge().github.register(input))) setAppId('');
  };
  const ready = /^[1-9]\d{0,11}$/.test(appId) && privateKey.includes('PRIVATE KEY');
  return (
    <form className="github-form" onSubmit={(event) => void submit(event)}>
      <ol className="github-steps">
        <li>
          On GitHub, create a GitHub App under Settings › Developer settings. Give it the
          permissions your workflows need, listed below once a repository is connected.
        </li>
        <li>Install it on the repositories Shift may work on.</li>
        <li>Generate a private key and paste it here with the App ID.</li>
      </ol>
      <div className="field">
        <label htmlFor="github-app-id">App ID</label>
        <input
          id="github-app-id"
          inputMode="numeric"
          value={appId}
          autoComplete="off"
          onChange={(event) => setAppId(event.target.value.trim())}
        />
      </div>
      <div className="field">
        <label htmlFor="github-key">Private key</label>
        <textarea
          id="github-key"
          className="secret-text"
          rows={4}
          value={privateKey}
          spellCheck={false}
          autoComplete="off"
          placeholder="-----BEGIN RSA PRIVATE KEY-----"
          onChange={(event) => setPrivateKey(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="github-secret">Webhook secret (optional)</label>
        <input
          id="github-secret"
          type="password"
          value={secret}
          autoComplete="new-password"
          onChange={(event) => setSecret(event.target.value)}
        />
      </div>
      <details className="github-host">
        <summary>GitHub Enterprise Server</summary>
        <div className="field">
          <label htmlFor="github-host">Address</label>
          <input
            id="github-host"
            value={host}
            placeholder="https://github.example.com"
            spellCheck={false}
            onChange={(event) => setHost(event.target.value)}
          />
        </div>
      </details>
      <button className="button" type="submit" disabled={!live || !ready}>
        Register App
      </button>
    </form>
  );
}

function AppCard({
  app,
  live,
  serverUrl,
  send,
}: {
  app: App;
  live: boolean;
  serverUrl: string | null;
  send: (call: Promise<DesktopResponse>) => Promise<boolean>;
}) {
  const [rotating, setRotating] = useState(false);
  const [privateKey, setPrivateKey] = useState('');
  const [secret, setSecret] = useState('');
  const webhook = serverUrl ? new URL(app.webhookPath, serverUrl).toString() : app.webhookPath;
  const rotate = async (event: FormEvent) => {
    event.preventDefault();
    const input = {
      ...(privateKey ? { privateKey } : {}),
      ...(secret ? { webhookSecret: secret } : {}),
    };
    setPrivateKey('');
    setSecret('');
    if (await send(bridge().github.rotate(app.id, input))) setRotating(false);
  };
  return (
    <div className="github-app">
      <div className="settings-device">
        <span className="inbox-text">
          <strong>{app.name ?? `App ${app.appId}`}</strong>
          <span>
            App {app.appId}
            {app.host !== 'https://github.com' && ` on ${new URL(app.host).host}`} ·{' '}
            {app.verifiedAt === null
              ? 'key not verified'
              : `verified ${relativeTime(app.verifiedAt)}`}
          </span>
        </span>
        <button
          className="button"
          disabled={!live}
          onClick={() => void send(bridge().github.refresh(app.id))}
        >
          Check again
        </button>
      </div>
      <dl className="github-facts">
        <dt>Private key</dt>
        <dd>Configured</dd>
        <dt>Webhook secret</dt>
        <dd>{app.webhookSecret === 'configured' ? 'Configured' : 'Missing'}</dd>
        <dt>Webhook URL</dt>
        <dd className="github-webhook">
          <code>{webhook}</code>
          <button
            className="button quiet icon"
            aria-label="Copy webhook URL"
            title="Copy webhook URL"
            onClick={() => void navigator.clipboard?.writeText(webhook)}
          >
            <Copy aria-hidden="true" />
          </button>
        </dd>
      </dl>
      <p className="note">Every project that uses this App shares the one webhook URL.</p>
      {rotating ? (
        <form className="github-form" onSubmit={(event) => void rotate(event)}>
          <div className="field">
            <label htmlFor="github-rotate-key">New private key</label>
            <textarea
              id="github-rotate-key"
              className="secret-text"
              rows={4}
              value={privateKey}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setPrivateKey(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="github-rotate-secret">New webhook secret</label>
            <input
              id="github-rotate-secret"
              type="password"
              value={secret}
              autoComplete="new-password"
              onChange={(event) => setSecret(event.target.value)}
            />
          </div>
          <p className="note">
            A new key is checked with GitHub before it replaces the old one. Workflows need no
            changes.
          </p>
          <div className="github-actions">
            <button
              className="button"
              type="submit"
              disabled={!live || (!privateKey.includes('PRIVATE KEY') && secret.length < 16)}
            >
              Replace
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                // Nothing pasted outlives the form.
                setPrivateKey('');
                setSecret('');
                setRotating(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="button" disabled={!live} onClick={() => setRotating(true)}>
          Replace key or secret
        </button>
      )}
    </div>
  );
}

function Bind({
  apps,
  live,
  project,
  send,
}: {
  apps: App[];
  live: boolean;
  project: string;
  send: (call: Promise<DesktopResponse>) => Promise<boolean>;
}) {
  const choices = apps.flatMap((app) =>
    app.installations
      .filter((installation) => installation.state === 'ACTIVE')
      .flatMap((installation) =>
        installation.repositories.map((repository) => ({
          key: `${installation.id}:${repository.id}`,
          installationId: installation.id,
          repositoryId: repository.id,
          label: `${repository.owner}/${repository.name}`,
        })),
      ),
  );
  const [choice, setChoice] = useState('');
  const picked = choices.find((item) => item.key === choice) ?? choices[0];
  if (choices.length === 0)
    return (
      <p className="note">
        The App is not installed on any repository yet. Install it on GitHub, then choose Check
        again.
      </p>
    );
  return (
    <form
      className="github-bind"
      onSubmit={(event) => {
        event.preventDefault();
        if (picked)
          void send(bridge().github.connect(project, picked.installationId, picked.repositoryId));
      }}
    >
      <div className="field">
        <label htmlFor="github-repository">Repository</label>
        <select
          id="github-repository"
          value={picked?.key ?? ''}
          onChange={(event) => setChoice(event.target.value)}
        >
          {choices.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <button className="button" type="submit" disabled={!live || !picked}>
        Connect
      </button>
    </form>
  );
}

function Bound({
  connection,
  apps,
  live,
  project,
  send,
}: {
  connection: Connection;
  apps: App[];
  live: boolean;
  project: string;
  send: (call: Promise<DesktopResponse>) => Promise<boolean>;
}) {
  const installation = apps
    .flatMap((app) => app.installations)
    .find((item) => item.id === connection.installationId);
  return (
    <div className="github-bound">
      <div className="settings-device">
        <span className="inbox-text">
          <strong>
            {connection.repository.owner}/{connection.repository.name}
          </strong>
          <span>
            {connection.verifiedAt === null
              ? 'Not verified'
              : `Verified ${relativeTime(connection.verifiedAt)}`}
            {installation && ` · installed on ${installation.account}`} · default branch{' '}
            {connection.repository.defaultBranch}
          </span>
        </span>
        <span className="github-actions">
          <button
            className="button"
            disabled={!live}
            onClick={() => void send(bridge().github.verify(project))}
          >
            Verify
          </button>
          <button
            className="button"
            disabled={!live}
            onClick={() => void send(bridge().github.disconnect(project))}
          >
            Disconnect
          </button>
        </span>
      </div>
      {connection.diagnostics.length === 0 ? (
        <p className="note">The installation grants what every GitHub node needs.</p>
      ) : (
        <>
          <p className="note">
            The installation lacks permissions some nodes need. Workflows that use them will not
            start until you grant them on GitHub and verify again:
          </p>
          <ul className="github-diagnostics">
            {connection.diagnostics.map((item) => (
              <li key={item.node}>
                <strong>{githubNodeLabels[item.node] ?? item.node}</strong> needs{' '}
                {describePermissions(item.missing)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
