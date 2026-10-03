import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  Bell,
  ChevronRight,
  CircleHelp,
  Folder,
  GitBranch,
  ListChecks,
  Play,
  Plus,
  Search,
  Settings,
  SquareTerminal,
  Workflow,
  X,
} from 'lucide-react';
import { parseResponse, type ShellState } from '../shared/contracts.js';

type Page = 'Projects' | 'Workflows' | 'Runs' | 'Sessions' | 'Attention' | 'Settings';
const pages = [
  { name: 'Projects', icon: Folder },
  { name: 'Workflows', icon: Workflow },
  { name: 'Runs', icon: ListChecks },
  { name: 'Sessions', icon: SquareTerminal },
  { name: 'Attention', icon: Bell },
  { name: 'Settings', icon: Settings },
] as const;
type Detail = {
  title: string;
  description: string;
  fields: { label: string; value: string }[];
  nodes?: string[];
};

export function App() {
  const [state, setState] = useState<ShellState>();
  const [page, setPage] = useState<Page>('Workflows');
  const [projectId, setProjectId] = useState('sample-shift');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Detail>();
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    if (!window.shift) {
      setError('Open the desktop app to browse the workspace.');
      return;
    }
    void window.shift
      .readShell()
      .then((value) => {
        if (!mounted) return;
        const response = parseResponse(value);
        if (response?.kind === 'shell') setState(response.state);
        else setError('The workspace could not be loaded.');
      })
      .catch(() => {
        if (mounted) setError('The desktop bridge is unavailable.');
      });
    return () => {
      mounted = false;
    };
  }, []);
  async function toggleSamples() {
    if (!window.shift) return;
    setBusy(true);
    setError('');
    try {
      const response = parseResponse(await window.shift.setSamples(!state?.samples));
      if (response?.kind === 'shell') {
        setState(response.state);
        setProjectId(response.state.projects[0]?.id ?? '');
        setDetail(undefined);
      } else setError('Sample data could not be changed.');
    } catch {
      setError('The desktop bridge is unavailable.');
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: Page) {
    setPage(next);
    setSearch('');
    setDetail(undefined);
  }
  function selectProject(id: string) {
    setProjectId(id);
    navigate('Workflows');
  }
  const project = state?.projects.find((item) => item.id === projectId) ?? state?.projects[0];
  const activeId = project?.id;
  const matches = (value: string) => value.toLowerCase().includes(search.toLowerCase());
  const workflows =
    state?.workflows.filter((item) => item.projectId === activeId && matches(item.name)) ?? [];
  const runs =
    state?.runs.filter((item) => item.projectId === activeId && matches(item.name)) ?? [];
  const sessions =
    state?.sessions.filter((item) => item.projectId === activeId && matches(item.name)) ?? [];
  const attention = state?.attention.filter((item) => matches(item.title)) ?? [];
  const empty = (
    <div className="empty-state">
      <Folder size={28} aria-hidden="true" />
      <h2>{search ? 'No matching items' : 'No server connected'}</h2>
      <p>
        {search
          ? 'Try a different search.'
          : 'Your projects and workflow history will appear after you connect to a Shift server.'}
      </p>
      {!search && (
        <button onClick={() => navigate('Settings')}>
          Open settings <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
  return (
    <div
      className="app-shell"
      onClickCapture={(event) => {
        if (event.target instanceof Element) {
          const row = event.target.closest<HTMLButtonElement>('.resource-row');
          if (row) detailTrigger.current = row;
        }
      }}
    >
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand">
          <GitBranch size={22} strokeWidth={2.5} aria-hidden="true" />
          <span>Shift</span>
        </div>
        <nav aria-label="Resources">
          {pages.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={page === name ? 'nav-item selected' : 'nav-item'}
              aria-current={page === name ? 'page' : undefined}
              onClick={() => navigate(name)}
            >
              <Icon size={18} aria-hidden="true" />
              {name}
              {name === 'Attention' && !!state?.attention.length && (
                <span className="count">{state.attention.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="project-navigation">
          <div className="section-label">Projects</div>
          {state?.projects.map((item) => (
            <button
              key={item.id}
              className={activeId === item.id ? 'project-link active-project' : 'project-link'}
              onClick={() => selectProject(item.id)}
            >
              <Folder size={16} aria-hidden="true" />
              {item.name}
            </button>
          ))}
          {!state?.projects.length && <p className="sidebar-empty">No projects yet</p>}
        </div>
        <div className="sidebar-bottom">
          <span className="connection-label">Disconnected</span>
          <span>No server configured</span>
          <button className="text-button" onClick={() => navigate('Settings')}>
            Connection settings <ChevronRight size={14} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <div className="breadcrumb">
            <span>
              {['Projects', 'Attention', 'Settings'].includes(page)
                ? 'Workspace'
                : (project?.name ?? 'Workspace')}
            </span>
            <ChevronRight size={14} aria-hidden="true" />
            <span>{page}</span>
          </div>
          <span className="header-status">Offline</span>
        </header>
        {state?.samples && (
          <div className="sample-banner" role="status">
            <span>Sample workspace. These records are fixtures, not live server data.</span>
            <button className="text-button" disabled={busy} onClick={() => void toggleSamples()}>
              Hide samples <X size={14} />
            </button>
          </div>
        )}
        {error && (
          <div role="alert" className="error-banner">
            {error}
          </div>
        )}
        <main>
          <div className="page-heading">
            <div>
              <h1>{page}</h1>
              <p>
                {page === 'Workflows'
                  ? 'Published workflows and drafts in this project.'
                  : page === 'Projects'
                    ? 'Repositories managed by your Shift server.'
                    : page === 'Runs'
                      ? 'Recorded executions, outcomes, and waits.'
                      : page === 'Sessions'
                        ? 'Retained agent sessions and their lifetime.'
                        : page === 'Attention'
                          ? 'Decisions and failures that need your attention.'
                          : 'Desktop preferences and server connection.'}
              </p>
            </div>
            {['Projects', 'Workflows'].includes(page) && (
              <button
                className="primary-button"
                disabled
                title="Connect to a server to create resources"
              >
                <Plus size={16} />
                {page === 'Projects' ? 'Add project' : 'New workflow'}
              </button>
            )}
          </div>
          {page !== 'Settings' && (
            <div className="resource-toolbar">
              <label className="search-field">
                <Search size={16} aria-hidden="true" />
                <input
                  aria-label={`Search ${page.toLowerCase()}`}
                  placeholder={`Search ${page.toLowerCase()}…`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <span className="resource-note">
                {state?.samples ? 'Sample data · Oct 2, 2026' : 'No live connection'}
              </span>
            </div>
          )}
          {page === 'Workflows' &&
            (workflows.length ? (
              <div className="resource-table">
                <div className="table-heading workflow-columns">
                  <span>Workflow</span>
                  <span>Version</span>
                  <span>Trigger</span>
                  <span>Updated</span>
                </div>
                {workflows.map((item) => (
                  <button
                    key={item.id}
                    className="resource-row workflow-columns"
                    onClick={() =>
                      setDetail({
                        title: item.name,
                        description: item.description,
                        fields: [
                          { label: 'Version', value: item.version },
                          { label: 'Trigger', value: item.trigger },
                        ],
                        nodes: item.nodes,
                      })
                    }
                  >
                    <span className="item-title">
                      <Workflow size={20} aria-hidden="true" />
                      <span>
                        <strong>{item.name}</strong>
                        <span className="item-description">{item.description}</span>
                      </span>
                    </span>
                    <span>{item.version}</span>
                    <span>{item.trigger}</span>
                    <span className="date-cell">
                      {item.updatedAt}
                      <ChevronRight size={16} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              empty
            ))}
          {page === 'Projects' &&
            (state?.projects.filter((item) => matches(item.name)).length ? (
              <div className="resource-table">
                {state.projects
                  .filter((item) => matches(item.name))
                  .map((item) => (
                    <button
                      key={item.id}
                      className="resource-row project-columns"
                      onClick={() => selectProject(item.id)}
                    >
                      <span className="item-title">
                        <Folder size={20} />
                        <span>
                          <strong>{item.name}</strong>
                          <span className="item-description">{item.repository}</span>
                        </span>
                      </span>
                      <span>
                        <GitBranch size={14} /> {item.branch}
                      </span>
                      <span className="date-cell">
                        View workflows <ChevronRight size={16} />
                      </span>
                    </button>
                  ))}
              </div>
            ) : (
              empty
            ))}
          {page === 'Runs' &&
            (runs.length ? (
              <div className="resource-table">
                <div className="table-heading run-columns">
                  <span>Run</span>
                  <span>Status</span>
                  <span>Started</span>
                </div>
                {runs.map((item) => (
                  <button
                    key={item.id}
                    className="resource-row run-columns"
                    onClick={() =>
                      setDetail({
                        title: item.name,
                        description: item.detail,
                        fields: [
                          { label: 'Outcome', value: item.status },
                          { label: 'Frozen workflow', value: item.version },
                          { label: 'Run ID', value: item.id },
                        ],
                      })
                    }
                  >
                    <span className="item-title">
                      <Play size={18} />
                      <strong>{item.name}</strong>
                    </span>
                    <span className={item.status === 'Waiting for approval' ? 'waiting' : ''}>
                      {item.status}
                    </span>
                    <span className="date-cell">
                      {item.startedAt}
                      <ChevronRight size={16} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              empty
            ))}
          {page === 'Sessions' &&
            (sessions.length ? (
              <div className="resource-table">
                <div className="table-heading run-columns">
                  <span>Session</span>
                  <span>Status</span>
                  <span>Lifetime</span>
                </div>
                {sessions.map((item) => (
                  <button
                    key={item.id}
                    className="resource-row run-columns"
                    onClick={() =>
                      setDetail({
                        title: item.name,
                        description: item.detail,
                        fields: [
                          { label: 'Session ID', value: item.id },
                          { label: 'Status', value: item.status },
                          { label: 'Lifetime', value: item.lifetime },
                        ],
                      })
                    }
                  >
                    <span className="item-title">
                      <SquareTerminal size={18} />
                      <strong>{item.name}</strong>
                    </span>
                    <span>{item.status}</span>
                    <span className="date-cell">
                      {item.lifetime}
                      <ChevronRight size={16} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              empty
            ))}
          {page === 'Attention' &&
            (attention.length ? (
              <div className="resource-table">
                {attention.map((item) => (
                  <button
                    key={item.id}
                    className="resource-row attention-row"
                    onClick={() =>
                      setDetail({
                        title: item.title,
                        description: item.detail,
                        fields: [
                          { label: 'Run ID', value: item.runId },
                          { label: 'Response', value: 'Unavailable while disconnected' },
                        ],
                      })
                    }
                  >
                    <Bell size={20} />
                    <span>
                      <strong>{item.title}</strong>
                      <span className="item-description">{item.detail}</span>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            ) : (
              empty
            ))}
          {page === 'Settings' && (
            <div className="settings-list">
              <section>
                <h2>Server connection</h2>
                <p>
                  No server is configured. Pairing will be available when the remote connection
                  milestone is implemented.
                </p>
                <dl>
                  <div>
                    <dt>Connection</dt>
                    <dd>Disconnected</dd>
                  </div>
                  <div>
                    <dt>Server identity</dt>
                    <dd>Not configured</dd>
                  </div>
                  <div>
                    <dt>Credentials</dt>
                    <dd>None stored</dd>
                  </div>
                </dl>
                <button disabled>Connect to server</button>
              </section>
              <section>
                <h2>Sample workspace</h2>
                <p>
                  Browse example projects, workflows, and history without connecting to a server.
                </p>
                <button disabled={busy || !window.shift} onClick={() => void toggleSamples()}>
                  {state?.samples ? 'Hide sample workspace' : 'Show sample workspace'}
                </button>
              </section>
              <section>
                <h2>About Shift</h2>
                <p>Desktop foundation · 0.0.0</p>
                <button
                  disabled={!window.shift}
                  onClick={() => {
                    void window.shift
                      ?.openDocumentation()
                      .then((response) => {
                        if (response.kind === 'error') setError(response.message);
                      })
                      .catch(() => setError('Documentation could not be opened.'));
                  }}
                >
                  <CircleHelp size={16} /> Documentation
                </button>
              </section>
            </div>
          )}
          {state?.samples && page !== 'Settings' && (
            <p className="offline-note">
              Browsing sample records. Editing, starting runs, and responding to requests require a
              live server.
            </p>
          )}
        </main>
      </div>
      <Dialog.Root
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="detail-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              detailTrigger.current?.focus();
            }}
          >
            <Dialog.Title>{detail?.title ?? 'Details'}</Dialog.Title>
            <Dialog.Description>{detail?.description}</Dialog.Description>
            <Dialog.Close className="dialog-close" aria-label="Close details">
              <X size={18} />
            </Dialog.Close>
            <div className="sample-detail">Sample record · Read only</div>
            <dl>
              {detail?.fields.map((field) => (
                <div key={field.label}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
            {detail?.nodes && (
              <div className="workflow-steps">
                <h3>Workflow steps</h3>
                <ol>
                  {detail.nodes.map((node, index) => (
                    <li key={`${index}-${node}`}>
                      <span className="step-index">{index + 1}</span>
                      {node}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="dialog-actions">
              <button disabled>Open connected view</button>
              <Dialog.Close>Close</Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
