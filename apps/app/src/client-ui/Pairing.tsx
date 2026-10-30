import { CircleAlert, Hexagon, LoaderCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { ConnectionView } from '../shared/contracts.js';
import { ask, bridge } from './bridge.js';

type Problem = NonNullable<ConnectionView['problem']>;

// What went wrong, and what to do about it.
export const problems: Record<
  Problem,
  { title: string; body: string; tone: 'failed' | 'waiting' }
> = {
  INVALID_URL: {
    title: 'That address is not a URL',
    body: 'Enter the server address, for example https://shift.example.com.',
    tone: 'failed',
  },
  INSECURE_URL: {
    title: 'Use an https:// address',
    body: 'Plain http only works for this computer, and only in development builds.',
    tone: 'failed',
  },
  UNREACHABLE: {
    title: 'The server did not answer',
    body: 'Check the address, and that shift serve is running and reachable from this computer.',
    tone: 'failed',
  },
  INVALID_RESPONSE: {
    title: 'That is not a Shift server',
    body: 'Something answered at that address, but not the way a Shift server does.',
    tone: 'failed',
  },
  PROTOCOL_UNSUPPORTED: {
    title: 'This server runs another Shift version',
    body: 'Update this app or the server so they share a protocol version.',
    tone: 'failed',
  },
  PAIRING_UNAVAILABLE: {
    title: 'This server does not accept pairing',
    body: 'Pairing is turned off on this server.',
    tone: 'failed',
  },
  PAIRING_REJECTED: {
    title: 'The phrase was not accepted',
    body: 'A phrase works once and expires after 10 minutes. Issue a new one with shift device pair.',
    tone: 'failed',
  },
  PAIRING_RATE_LIMITED: {
    title: 'Too many attempts',
    body: 'Wait a minute, then pair again with the same phrase.',
    tone: 'waiting',
  },
  PAIRING_UNCONFIRMED: {
    title: 'The answer was lost on the way back',
    body: 'Pair again with the same phrase. The server recognizes the retry, so it creates no second device.',
    tone: 'waiting',
  },
  IDENTITY_MISMATCH: {
    title: 'A different server answered',
    body: 'The server at this address is not the one this pairing started with.',
    tone: 'failed',
  },
  CREDENTIAL_MISSING: {
    title: 'Pair this computer again',
    body: 'Its device key was kept for one session only, because no secure keychain is available.',
    tone: 'waiting',
  },
  DEVICE_REVOKED: {
    title: 'This device was removed',
    body: 'The server revoked this device. Pair it again with a new phrase.',
    tone: 'failed',
  },
};

function defaultDeviceName(): string {
  const platform = navigator.userAgent;
  if (platform.includes('Mac')) return 'Mac';
  if (platform.includes('Windows')) return 'Windows PC';
  return 'Linux desktop';
}

// The one full-screen step: pairing this computer with a server.
export function Pairing({ connection }: { connection: ConnectionView }) {
  const saved = connection.profiles.find((profile) => profile.active) ?? connection.profiles[0];
  const [url, setUrl] = useState(saved?.url ?? '');
  const [phrase, setPhrase] = useState('');
  const [deviceName, setDeviceName] = useState(saved?.deviceName ?? defaultDeviceName());
  const [busy, setBusy] = useState(false);
  const problem = connection.problem ? problems[connection.problem] : null;
  const words = phrase
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean).length;
  const ready = url.trim() !== '' && words === 8 && deviceName.trim() !== '' && !busy;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    await ask(bridge().connection.pair({ url, phrase, deviceName }));
    setBusy(false);
  };

  return (
    <main className="pairing">
      <div className="titlebar" />
      <form className="pairing-panel" onSubmit={submit} noValidate>
        <div className="brand">
          <span className="brand-mark">
            <Hexagon aria-hidden="true" />
          </span>
          Shift
        </div>
        <h1>Pair this computer with your server</h1>
        <p className="lede">
          On the server, run <code>shift device pair</code>. It prints an eight-word phrase that
          works once, for ten minutes.
        </p>
        {problem && (
          <div className="alert" data-status={problem.tone} role="alert">
            <CircleAlert aria-hidden="true" />
            <p>
              <strong>{problem.title}</strong>
              {problem.body}
            </p>
          </div>
        )}
        <div className="field">
          <label htmlFor="server-url">Server address</label>
          <input
            id="server-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://shift.example.com"
            value={url}
            aria-invalid={
              connection.problem === 'INVALID_URL' || connection.problem === 'INSECURE_URL'
            }
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pairing-phrase">Pairing phrase</label>
          <input
            id="pairing-phrase"
            className="mono"
            autoComplete="off"
            spellCheck={false}
            placeholder="eight words separated by spaces"
            value={phrase}
            aria-describedby="phrase-help"
            aria-invalid={connection.problem === 'PAIRING_REJECTED'}
            onChange={(event) => setPhrase(event.target.value)}
          />
          <p className="help" id="phrase-help">
            {words === 0 ? 'Only this pairing uses it. It is never saved.' : `${words} of 8 words`}
          </p>
        </div>
        <div className="field">
          <label htmlFor="device-name">Name this computer</label>
          <input
            id="device-name"
            maxLength={100}
            value={deviceName}
            aria-describedby="device-help"
            onChange={(event) => setDeviceName(event.target.value)}
          />
          <p className="help" id="device-help">
            Shown in the server's device list, where it can be revoked.
          </p>
        </div>
        <button className="button primary" type="submit" disabled={!ready}>
          {busy && <LoaderCircle className="spin" aria-hidden="true" />}
          {busy ? 'Pairing…' : connection.pairingPending ? 'Pair again' : 'Pair computer'}
        </button>
        {connection.pairingPending && !busy && (
          <div className="pairing-footer">
            <span className="note">The same phrase is retried safely.</span>
            <button
              type="button"
              className="button quiet"
              onClick={() => void ask(bridge().connection.abandonPairing())}
            >
              Use another phrase
            </button>
          </div>
        )}
      </form>
    </main>
  );
}
