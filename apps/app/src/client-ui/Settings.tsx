import { CircleAlert, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { DeviceList, ServerInfo } from '../protocol/generated/types.js';
import type { ConnectionView, Preferences, SyncView } from '../shared/contracts.js';
import { health, healthLabels } from './Bars.js';
import { ask, bridge, useLive } from './bridge.js';
import { problems } from './Pairing.js';
import { relativeTime } from './time.js';

export type SettingsSection = 'connection' | 'devices' | 'appearance';

const sections: { id: SettingsSection; label: string }[] = [
  { id: 'connection', label: 'Connection' },
  { id: 'devices', label: 'Devices' },
  { id: 'appearance', label: 'Appearance' },
];

const readiness: Record<ServerInfo['readiness']['phase'], string> = {
  starting: 'Starting',
  ready: 'Ready',
  stopping: 'Stopping',
  failed: 'Not ready: its storage is unavailable',
};

const date = (at: number) => new Date(at).toLocaleDateString(undefined, { dateStyle: 'medium' });

// The one modal over the canvas. Everything here is about this computer and its server.
export function Settings({
  connection,
  sync,
  preferences,
  section,
  setSection,
  close,
}: {
  connection: ConnectionView;
  sync: SyncView;
  preferences: Preferences;
  section: SettingsSection;
  setSection: (section: SettingsSection) => void;
  close: () => void;
}) {
  // Caught first, so an island open beneath the modal stays open.
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => before?.focus();
  }, []);
  // Keeps Tab inside the modal.
  const trap = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !dialog.current) return;
    const focusable = [
      ...dialog.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), a[href]',
      ),
    ].filter((element) => element.tabIndex >= 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  const moveTab = (event: KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : sections.length - 1;
    const next = sections[(index + step) % sections.length]!;
    setSection(next.id);
    dialog.current?.querySelector<HTMLElement>(`#settings-tab-${next.id}`)?.focus();
  };
  return (
    <>
      <div className="scrim" onPointerDown={close} />
      <section
        ref={dialog}
        className="island settings"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onKeyDown={trap}
      >
        <nav className="settings-nav" role="tablist" aria-orientation="vertical">
          <h2>Settings</h2>
          {sections.map((item, index) => (
            <button
              key={item.id}
              id={`settings-tab-${item.id}`}
              role="tab"
              aria-selected={section === item.id}
              aria-controls="settings-panel"
              tabIndex={section === item.id ? 0 : -1}
              onClick={() => setSection(item.id)}
              onKeyDown={(event) => moveTab(event, index)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div
          id="settings-panel"
          className="settings-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${section}`}
        >
          <button className="button quiet icon settings-close" aria-label="Close" onClick={close}>
            <X />
          </button>
          {section === 'connection' && <ConnectionSection connection={connection} sync={sync} />}
          {section === 'devices' && <DevicesSection sync={sync} />}
          {section === 'appearance' && <AppearanceSection preferences={preferences} />}
        </div>
      </section>
    </>
  );
}

function ConnectionSection({ connection, sync }: { connection: ConnectionView; sync: SyncView }) {
  const profile = connection.profiles.find((item) => item.active);
  const state = health(connection, sync);
  const live = state === 'live';
  const info = useLive<ServerInfo | null>(async () => {
    const answer = await ask(bridge().queryServer('info'));
    return answer.kind === 'server' ? (answer.value as ServerInfo) : null;
  }, []);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(profile?.url ?? '');
  const [changing, setChanging] = useState(false);
  const [tried, setTried] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  if (!profile) return null;
  const problem = tried && connection.problem ? problems[connection.problem] : null;

  const change = async (event: FormEvent) => {
    event.preventDefault();
    setChanging(true);
    const answer = await ask(bridge().connection.changeAddress(profile.localId, address));
    setChanging(false);
    setTried(true);
    if (answer.kind === 'connection' && !answer.connection.problem) setEditing(false);
  };

  return (
    <>
      <h3>Connection</h3>
      <dl className="settings-facts">
        <dt>Status</dt>
        <dd>
          {healthLabels[state]}
          {!live && sync.updatedAt ? `, showing data from ${relativeTime(sync.updatedAt)}` : ''}
        </dd>
        <dt>Address</dt>
        <dd className="mono">{profile.url}</dd>
        <dt>Server</dt>
        <dd>
          {info
            ? `Shift ${info.serverVersion}, ${readiness[info.readiness.phase]}`
            : 'Not known while disconnected'}
        </dd>
        <dt>Server ID</dt>
        <dd className="mono">{profile.serverId}</dd>
        <dt>This device</dt>
        <dd>
          {profile.deviceName}, paired {date(profile.pairedAt)}
        </dd>
        <dt>Device key</dt>
        <dd>
          {connection.credentialStorage === 'persistent'
            ? 'Kept in the system keychain'
            : 'Kept until you quit. This computer has no secure keychain, so you pair again after each restart. Installing a secret service such as GNOME Keyring lets Shift keep it.'}
        </dd>
      </dl>
      <div className="settings-actions">
        {state === 'offline' && (
          <button
            className="button"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              await ask(bridge().connection.connect(profile.localId));
              setRetrying(false);
            }}
          >
            <RefreshCw className={retrying ? 'spin' : undefined} aria-hidden="true" />
            Reconnect
          </button>
        )}
        {!editing && (
          <button
            className="button"
            onClick={() => {
              setEditing(true);
              setTried(false);
              setAddress(profile.url);
            }}
          >
            Change address…
          </button>
        )}
        {!forgetting && (
          <button className="button" onClick={() => setForgetting(true)}>
            Forget this server…
          </button>
        )}
      </div>
      {editing && (
        <form className="settings-form" onSubmit={change}>
          <div className="field">
            <label htmlFor="settings-address">Server address</label>
            <input
              id="settings-address"
              className="mono"
              type="url"
              autoFocus
              spellCheck={false}
              maxLength={2048}
              value={address}
              aria-invalid={problem ? true : undefined}
              onChange={(event) => setAddress(event.target.value)}
            />
            <p className="note">
              The server must prove it is the same one, or this device stays on the old address.
            </p>
          </div>
          {problem && (
            <p className="field-error" role="alert">
              {problem.title}. {problem.body}
            </p>
          )}
          <div className="actions">
            <button type="button" className="button quiet" onClick={() => setEditing(false)}>
              Keep this address
            </button>
            <button type="submit" className="button primary" disabled={changing || !address}>
              {changing && <LoaderCircle className="spin" aria-hidden="true" />}
              Change address
            </button>
          </div>
        </form>
      )}
      {forgetting && (
        <div className="settings-confirm" role="alert">
          <p>
            This computer loses its device key and cached data, and returns to pairing. Runs on the
            server keep going, and the device stays listed there until it is revoked.
          </p>
          <div className="actions">
            <button className="button quiet" onClick={() => setForgetting(false)} autoFocus>
              Keep this server
            </button>
            <button
              className="button danger"
              onClick={() => void ask(bridge().connection.clear(profile.localId))}
            >
              Forget server
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function DevicesSection({ sync }: { sync: SyncView }) {
  const [sent, setSent] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const command = sync.commands.find((item) => item.commandId === sent);
  const list = useLive<DeviceList | null>(async () => {
    const answer = await ask(bridge().data.devices());
    return answer.kind === 'devices' ? (answer.value as DeviceList) : null;
  }, [command?.state === 'accepted' ? sent : null]);
  useEffect(() => {
    if (command?.state === 'accepted') setRevoking(null);
  }, [command?.state]);
  const checking = sending || command?.state === 'sending' || command?.state === 'unknown';

  const revoke = async (deviceId: string) => {
    setFailed(false);
    setSending(true);
    const answer = await ask(bridge().device.revoke(deviceId));
    setSending(false);
    if (answer.kind === 'command') setSent(answer.command.commandId);
    else setFailed(true);
  };

  const devices = [...(list?.devices ?? [])].sort(
    (a, b) =>
      Number(a.revokedAt !== null) - Number(b.revokedAt !== null) || a.createdAt - b.createdAt,
  );

  return (
    <>
      <h3>Devices</h3>
      <p className="note">
        Every paired device has the same authority. To pair another one, run{' '}
        <code>shift device pair</code> on the server.
      </p>
      {list === null && (
        <p className="settings-unavailable" role="status">
          <CircleAlert aria-hidden="true" />
          Devices can be listed once the server is connected.
        </p>
      )}
      <ul className="settings-devices">
        {devices.map((device) => {
          const current = device.id === list?.currentDeviceId;
          const revoked = device.revokedAt !== null;
          return (
            <li key={device.id} className={revoked ? 'revoked' : undefined}>
              <div className="settings-device">
                <span className="inbox-text">
                  <strong>
                    {device.name}
                    {current && <span className="badge">This device</span>}
                  </strong>
                  <span>
                    Paired {date(device.createdAt)}
                    {revoked
                      ? ` · Revoked ${date(device.revokedAt!)}`
                      : device.lastSeenAt
                        ? ` · Last seen ${relativeTime(device.lastSeenAt)}`
                        : ' · Not seen yet'}
                  </span>
                </span>
                {!revoked && revoking !== device.id && (
                  <button
                    className="button"
                    disabled={sync.status !== 'live'}
                    onClick={() => {
                      setRevoking(device.id);
                      setSent(null);
                      setFailed(false);
                    }}
                  >
                    Revoke…
                  </button>
                )}
              </div>
              {revoking === device.id && (
                <div className="settings-confirm" role="alert">
                  <p>
                    {current
                      ? 'This computer is cut off at once and returns to pairing.'
                      : `${device.name} is cut off at once and has to be paired again.`}{' '}
                    Runs it started keep going.
                  </p>
                  {command?.state === 'rejected' && (
                    <p className="field-error">
                      {command.message ?? 'The server did not accept this.'}
                    </p>
                  )}
                  {command?.state === 'not_applied' && (
                    <p className="field-error">
                      The request did not reach the server. Send it again.
                    </p>
                  )}
                  {failed && <p className="field-error">The request could not be sent.</p>}
                  <div className="actions">
                    <button className="button quiet" onClick={() => setRevoking(null)} autoFocus>
                      Keep device
                    </button>
                    <button
                      className="button danger"
                      disabled={checking || sync.status !== 'live'}
                      onClick={() => void revoke(device.id)}
                    >
                      {checking && <LoaderCircle className="spin" aria-hidden="true" />}
                      {checking ? 'Checking…' : 'Revoke device'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

const themes: { id: Preferences['theme']; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

function AppearanceSection({ preferences }: { preferences: Preferences }) {
  const set = (next: Partial<Preferences>) =>
    void ask(bridge().preferences.set({ ...preferences, ...next }));
  return (
    <>
      <h3>Appearance</h3>
      <div className="field">
        <span id="settings-theme">Theme</span>
        <div className="segmented" role="radiogroup" aria-labelledby="settings-theme">
          {themes.map((theme) => (
            <button
              key={theme.id}
              role="radio"
              aria-checked={preferences.theme === theme.id}
              onClick={() => set({ theme: theme.id })}
            >
              {theme.label}
            </button>
          ))}
        </div>
      </div>
      <h3>Notifications</h3>
      <div className="field">
        <label className="field-check">
          <input
            type="checkbox"
            checked={preferences.notifications}
            aria-describedby="settings-notifications-help"
            onChange={(event) => set({ notifications: event.target.checked })}
          />
          Notify me when something needs me and Shift is not in front
        </label>
        <p id="settings-notifications-help" className="note">
          The system shows the request's title, including on a lock screen. While Shift is in front,
          a toast appears instead.
        </p>
      </div>
    </>
  );
}
