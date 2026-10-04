import { useEffect, useState } from 'react';
import { parseResponse, type ShellState } from '../shared/contracts.js';

const sections = ['Projects', 'Workflows', 'Runs', 'Sessions', 'Attention', 'Settings'] as const;

export function App() {
  const [section, setSection] = useState<(typeof sections)[number]>('Projects');
  const [state, setState] = useState<ShellState>();
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    if (!window.shift) {
      setError('The desktop bridge is unavailable.');
      return;
    }
    void window.shift
      .readShell()
      .then((value) => {
        if (!mounted) return;
        const response = parseResponse(value);
        if (response?.kind === 'shell') setState(response.state);
        else setError('The shell could not be loaded.');
      })
      .catch(() => {
        if (mounted) setError('The desktop bridge is unavailable.');
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      <header>
        <h1>Shift</h1>
        <p>Disconnected</p>
        {state?.samples && <p role="status">Development fixtures enabled.</p>}
        {error && <p role="alert">{error}</p>}
      </header>
      <nav aria-label="Sections">
        {sections.map((name) => (
          <button
            key={name}
            aria-current={section === name ? 'page' : undefined}
            onClick={() => setSection(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      <main>
        <h2>{section}</h2>
        <p>No server connected.</p>
      </main>
    </>
  );
}
