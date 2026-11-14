import { ChevronRight, Download, File, Folder, Link2, X } from 'lucide-react';
import { useState } from 'react';
import { ask, bridge, useLive } from './bridge.js';
import { useEscape } from './Attention.js';

// A run's workspace as it is now (client specification 5.6): read-only, live, and scoped by the
// server to that workspace. It is not a recorded result: a step's diff or report is an artifact on
// the run. Large and binary files are offered as downloads, never rendered.

interface Entry {
  name: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
  size: number | null;
}
interface Listing {
  path: string;
  entries: Entry[];
  truncated: boolean;
}
interface FileView {
  path: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  text: string | null;
}
interface Status {
  head: string;
  branch: string | null;
  baseCommit: string;
  clean: boolean;
  entries: Array<{ path: string; index: string; worktree: string }>;
  entryCount: number;
}

const bytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 ** 2
      ? `${(size / 1024).toFixed(1)} KiB`
      : `${(size / 1024 ** 2).toFixed(1)} MiB`;

export function WorkspaceFiles({ workspaceId, close }: { workspaceId: string; close: () => void }) {
  useEscape(close);
  const [tab, setTab] = useState<'files' | 'changes'>('files');
  const [directory, setDirectory] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const listing = useLive(async () => {
    const answer = await ask(bridge().workspace.files(workspaceId, directory));
    return answer.kind === 'resource'
      ? { value: (answer.value as { listing: Listing }).listing, error: null }
      : { value: null, error: answer.kind === 'error' ? answer.message : 'Unavailable.' };
  }, [workspaceId, directory]);
  const file = useLive(async () => {
    if (!open) return null;
    const answer = await ask(bridge().workspace.file(workspaceId, open));
    return answer.kind === 'resource'
      ? { value: (answer.value as { file: FileView }).file, error: null }
      : { value: null, error: answer.kind === 'error' ? answer.message : 'Unavailable.' };
  }, [workspaceId, open]);
  const status = useLive(async () => {
    if (tab !== 'changes') return null;
    const answer = await ask(bridge().workspace.status(workspaceId));
    return answer.kind === 'resource' ? (answer.value as { status: Status }).status : null;
  }, [workspaceId, tab]);
  const diff = useLive(async () => {
    if (tab !== 'changes') return null;
    const answer = await ask(bridge().workspace.diff(workspaceId, 'base', diffPath ?? undefined));
    return answer.kind === 'resource'
      ? (answer.value as { diff: { diff: string; truncated: boolean } }).diff
      : null;
  }, [workspaceId, tab, diffPath]);
  const download = async (path: string) => {
    setNotice(null);
    const answer = await ask(bridge().workspace.download(workspaceId, path));
    setNotice(
      answer.kind === 'saved'
        ? answer.saved
          ? `Saved ${bytes(answer.bytes)}.`
          : null
        : answer.kind === 'error'
          ? answer.message
          : null,
    );
  };
  const crumbs = directory ? directory.split('/') : [];
  return (
    <section className="island workspace-files" aria-label="Workspace files">
      <header className="intervention-head">
        <h2>Workspace</h2>
        <button className="button quiet icon" aria-label="Close" onClick={close}>
          <X />
        </button>
      </header>
      <p className="note">Live and read-only: the workspace as it is now, not a recorded result.</p>
      <div className="tabs" role="tablist">
        {(['files', 'changes'] as const).map((name) => (
          <button
            key={name}
            role="tab"
            className="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
          >
            {name === 'files' ? 'Files' : 'Changes'}
          </button>
        ))}
      </div>
      {tab === 'files' ? (
        <div className="files-body">
          <nav className="crumbs" aria-label="Folder">
            <button className="link" onClick={() => setDirectory('')}>
              workspace
            </button>
            {crumbs.map((part, index) => (
              <span key={index}>
                <ChevronRight aria-hidden="true" />
                <button
                  className="link"
                  onClick={() => setDirectory(crumbs.slice(0, index + 1).join('/'))}
                >
                  {part}
                </button>
              </span>
            ))}
          </nav>
          {listing?.error && <p className="field-error">{listing.error}</p>}
          <ul className="file-list">
            {listing?.value?.entries.map((entry) => {
              const path = directory ? `${directory}/${entry.name}` : entry.name;
              return (
                <li key={entry.name}>
                  <button
                    className="option"
                    aria-current={open === path}
                    onClick={() =>
                      entry.kind === 'directory' ? setDirectory(path) : setOpen(path)
                    }
                  >
                    {entry.kind === 'directory' ? (
                      <Folder aria-hidden="true" />
                    ) : entry.kind === 'symlink' ? (
                      <Link2 aria-hidden="true" />
                    ) : (
                      <File aria-hidden="true" />
                    )}
                    <span className="name">{entry.name}</span>
                    {entry.size !== null && <span className="detail">{bytes(entry.size)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {listing?.value?.truncated && (
            <p className="note">Only the first 1,000 entries are shown.</p>
          )}
          {open && (
            <div className="file-view">
              <div className="copy-row">
                <code className="mono">{open}</code>
                <button
                  className="button quiet icon"
                  aria-label="Download"
                  title="Download"
                  onClick={() => void download(open)}
                >
                  <Download />
                </button>
              </div>
              {file?.error && <p className="field-error">{file.error}</p>}
              {file?.value &&
                (file.value.binary ? (
                  <p className="note">
                    A binary file of {bytes(file.value.size)}: download it to look inside.
                  </p>
                ) : (
                  <>
                    <pre className="mono file-text">{file.value.text}</pre>
                    {file.value.truncated && (
                      <p className="note">
                        The first 512 KiB of {bytes(file.value.size)}; download it for the rest.
                      </p>
                    )}
                  </>
                ))}
            </div>
          )}
        </div>
      ) : (
        <div className="files-body">
          {status && (
            <p className="note">
              {status.branch ? `On ${status.branch}` : 'Detached'} at{' '}
              <span className="mono">{status.head.slice(0, 10)}</span>, from{' '}
              <span className="mono">{status.baseCommit.slice(0, 10)}</span>.{' '}
              {status.clean ? 'No changes.' : `${status.entryCount} changed.`}
            </p>
          )}
          <ul className="file-list">
            {status?.entries.map((entry) => (
              <li key={entry.path}>
                <button
                  className="option"
                  aria-current={diffPath === entry.path}
                  onClick={() => {
                    // A new file has no diff yet: show what it holds instead.
                    if (entry.index === '?') {
                      setOpen(entry.path);
                      setTab('files');
                    } else setDiffPath(diffPath === entry.path ? null : entry.path);
                  }}
                >
                  <span className="mono status-code">
                    {entry.index}
                    {entry.worktree}
                  </span>
                  <span className="name">{entry.path}</span>
                </button>
              </li>
            ))}
          </ul>
          {diff && (
            <>
              {diff.diff && (
                <pre className="mono diff-text">
                  {diff.diff.split('\n').map((line, index) => (
                    <span
                      key={index}
                      className={
                        line.startsWith('+') && !line.startsWith('+++')
                          ? 'added'
                          : line.startsWith('-') && !line.startsWith('---')
                            ? 'removed'
                            : undefined
                      }
                    >
                      {line}
                      {'\n'}
                    </span>
                  ))}
                </pre>
              )}
              {diff.truncated && <p className="note">The diff is longer than 1 MiB; it is cut.</p>}
              {!diff.diff && (
                <p className="note">
                  No changes to tracked files against the base. New files are listed above; open one
                  to see it.
                </p>
              )}
            </>
          )}
        </div>
      )}
      {notice && (
        <p className="note" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
