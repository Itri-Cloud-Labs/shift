import { useEffect } from 'react';
import { useDesktop } from './bridge.js';
import { Pairing } from './Pairing.js';
import { Workspace } from './Workspace.js';

// The canvas is the app; pairing is the one full-screen step before it.
export function App() {
  const desktop = useDesktop();
  useEffect(() => {
    const platform = navigator.userAgent.includes('Mac')
      ? 'darwin'
      : navigator.userAgent.includes('Windows')
        ? 'win32'
        : 'linux';
    document.documentElement.classList.add(`platform-${platform}`);
  }, []);
  if (!window.shift)
    return (
      <main className="pairing">
        <p role="alert" className="pairing-panel">
          The desktop bridge is unavailable.
        </p>
      </main>
    );
  if (!desktop) return <div className="canvas" aria-busy="true" />;
  const { connection } = desktop;
  const paired =
    connection.profileId !== null &&
    (connection.status === 'online' ||
      connection.status === 'offline' ||
      connection.status === 'connecting' ||
      connection.status === 'incompatible');
  return paired ? <Workspace desktop={desktop} /> : <Pairing connection={connection} />;
}
