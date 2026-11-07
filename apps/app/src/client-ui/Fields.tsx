import { createContext, useContext, useEffect, useState } from 'react';

// Tells the workspace a field holds text that is not committed yet, so a server revision waits.
export const Typing = createContext<(typing: boolean) => void>(() => undefined);

// A text field that commits when it loses focus or on Enter, so one edit is one undo step. An
// undo elsewhere replaces what it shows.
export function TextField({
  id,
  label,
  value,
  multiline,
  placeholder,
  note,
  problem,
  numeric,
  autoFocus,
  commit,
}: {
  id: string;
  label: string;
  value: string;
  multiline?: boolean;
  placeholder?: string;
  note?: string | undefined;
  problem?: string | undefined;
  numeric?: boolean;
  autoFocus?: boolean;
  commit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const typing = useContext(Typing);
  // From the first keystroke until the field loses focus, when it commits or shows its problem.
  const [typed, setTyped] = useState(false);
  useEffect(() => {
    typing(typed && text !== value);
    return () => typing(false);
  }, [typed, text, value]);
  const props = {
    id,
    value: text,
    placeholder,
    autoFocus,
    spellCheck: false,
    'aria-invalid': problem ? true : undefined,
    onChange: (event: { target: { value: string } }) => {
      setText(event.target.value);
      setTyped(true);
    },
    onBlur: () => {
      setTyped(false);
      if (text !== value) commit(text);
    },
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...props} rows={5} />
      ) : (
        <input
          {...props}
          type={numeric ? 'number' : 'text'}
          min={numeric ? 0 : undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && text !== value) commit(text);
          }}
        />
      )}
      {note && <p className="note">{note}</p>}
      {problem && <p className="field-error">{problem}</p>}
    </div>
  );
}
