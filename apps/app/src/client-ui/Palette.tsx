import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { paletteView, type PaletteEntry } from './commands.js';

// ⌘K: the fast path to everything an island offers. Focus stays in the input; the arrow keys
// move through the results.
export function Palette({
  entries,
  choose,
  close,
}: {
  entries: PaletteEntry[];
  choose: (entry: PaletteEntry) => void;
  close: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const results = useMemo(() => paletteView(entries, query), [entries, query]);
  const index = Math.min(active, results.length - 1);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, results]);

  // Read during the first render, before the input takes focus. Focus goes back there, unless
  // what was chosen took it elsewhere.
  const [before] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(
    () => () => {
      if (document.activeElement === document.body || !document.activeElement) before?.focus();
    },
    [],
  );

  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      // Only the palette closes, not an island open beneath it.
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!results.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index + step + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = results[index];
      if (entry) choose(entry);
    } else if (event.key === 'Tab') event.preventDefault();
  };

  return (
    <>
      <div className="scrim" onPointerDown={close} />
      <div className="island palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <label className="palette-search">
          <Search aria-hidden="true" />
          <span className="visually-hidden">Search actions, workflows, runs and nodes</span>
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[index] ? `palette-${index}` : undefined}
            placeholder="Search actions, workflows, runs and nodes"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={key}
          />
        </label>
        {results.length === 0 ? (
          <p className="palette-empty" role="status">
            Nothing matches “{query.trim()}”.
          </p>
        ) : (
          <ul id="palette-results" ref={list} role="listbox" aria-label="Results">
            {results.map((entry, position) => {
              const heading =
                !query.trim() && (position === 0 || results[position - 1]!.group !== entry.group);
              return (
                <li key={entry.id} role="presentation">
                  {heading && (
                    <div className="palette-group" role="presentation">
                      {entry.group}
                    </div>
                  )}
                  <div
                    id={`palette-${position}`}
                    className="palette-item"
                    role="option"
                    aria-selected={position === index}
                    onPointerMove={() => setActive(position)}
                    onClick={() => choose(entry)}
                  >
                    <span className="palette-label">{entry.label}</span>
                    {entry.detail && <span className="palette-detail">{entry.detail}</span>}
                    {query.trim() && <span className="badge">{entry.group}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
