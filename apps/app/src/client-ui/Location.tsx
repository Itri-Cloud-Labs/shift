import { ChevronDown, ChevronRight, Folder, PenLine, Search, Workflow } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Overview } from '../shared/contracts.js';
import { runStateLabels } from './graph.js';
import { StatusIcon, runTone } from './icons.js';
import type { Route } from './route.js';
import { relativeTime } from './time.js';

type Open = 'switcher' | 'runs' | null;

// Closes a popover island on Escape or a click outside it.
function useDismiss(
  open: boolean,
  close: () => void,
  ...inside: React.RefObject<HTMLElement | null>[]
) {
  useEffect(() => {
    if (!open) return;
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const pointer = (event: PointerEvent) => {
      if (!inside.some((ref) => ref.current?.contains(event.target as Node))) close();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', pointer, true);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', pointer, true);
    };
  });
}

// Top left, always on screen: where the canvas is, and the way to anywhere else.
export function LocationIsland({
  overview,
  route,
  projectId,
  workflowId,
  navigate,
}: {
  overview: Overview;
  route: Route;
  projectId: string | null;
  workflowId: string | null;
  navigate: (next: Partial<Route>) => void;
}) {
  const [open, setOpen] = useState<Open>(null);
  const island = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  useDismiss(open !== null, () => setOpen(null), island, popover);
  const project = overview.projects.find((item) => item.id === projectId);
  const workflow = overview.workflows.find((item) => item.id === workflowId);
  const runs = overview.runs
    .filter((run) => run.workflowId === workflowId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const run = runs.find((item) => item.id === route.runId);
  const runsLeft = island.current
    ? (island.current.querySelector<HTMLElement>('[data-crumb="run"]')?.getBoundingClientRect()
        .left ?? 8)
    : 8;

  return (
    <>
      <nav className="island location" aria-label="Location" ref={island}>
        <button
          className="crumb"
          aria-expanded={open === 'switcher'}
          aria-haspopup="dialog"
          onClick={() => setOpen(open === 'switcher' ? null : 'switcher')}
        >
          <Folder aria-hidden="true" />
          <span>{project?.name ?? 'Choose a project'}</span>
        </button>
        {project && (
          <>
            <ChevronRight className="crumb-separator" aria-hidden="true" />
            <button
              className="crumb"
              aria-expanded={open === 'switcher'}
              aria-haspopup="dialog"
              onClick={() => setOpen(open === 'switcher' ? null : 'switcher')}
            >
              <Workflow aria-hidden="true" />
              <span>{workflow?.name ?? 'Choose a workflow'}</span>
            </button>
          </>
        )}
        {workflow && (
          <>
            <ChevronRight className="crumb-separator" aria-hidden="true" />
            <button
              className="crumb"
              data-crumb="run"
              aria-expanded={open === 'runs'}
              aria-haspopup="listbox"
              onClick={() => setOpen(open === 'runs' ? null : 'runs')}
            >
              {run ? (
                <span className="status" data-status={runTone(run.state)}>
                  <StatusIcon status={runTone(run.state)} />
                </span>
              ) : (
                <PenLine aria-hidden="true" />
              )}
              <span>{run ? `Run · ${relativeTime(run.createdAt)}` : 'Draft'}</span>
              <ChevronDown aria-hidden="true" />
            </button>
          </>
        )}
      </nav>
      {open === 'switcher' && (
        <Switcher
          overview={overview}
          projectId={projectId}
          workflowId={workflowId}
          popover={popover}
          choose={(next) => {
            navigate({ ...next, runId: null, nodeId: null });
            if (next.workflowId) setOpen(null);
          }}
        />
      )}
      {open === 'runs' && (
        <div
          className="popover runs-menu"
          ref={popover}
          role="listbox"
          aria-label="Runs"
          style={{ left: Math.max(8, runsLeft - 4) }}
        >
          <button
            className="option"
            role="option"
            aria-selected={!route.runId}
            onClick={() => {
              navigate({ runId: null, nodeId: null });
              setOpen(null);
            }}
          >
            <PenLine aria-hidden="true" />
            <span className="name">Draft</span>
            <span className="detail">Editable</span>
          </button>
          <div className="column-label">Runs</div>
          {runs.length === 0 && <p className="option-empty">No runs of this workflow yet.</p>}
          {runs.map((item) => (
            <button
              key={item.id}
              className="option"
              role="option"
              aria-selected={item.id === route.runId}
              onClick={() => {
                navigate({ runId: item.id, nodeId: null });
                setOpen(null);
              }}
            >
              <span className="status" data-status={runTone(item.state)}>
                <StatusIcon status={runTone(item.state)} />
              </span>
              <span className="name">{runStateLabels[item.state]}</span>
              <span className="detail">{relativeTime(item.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// One island for moving anywhere: projects on the left, their workflows on the right.
function Switcher({
  overview,
  projectId,
  workflowId,
  popover,
  choose,
}: {
  overview: Overview;
  projectId: string | null;
  workflowId: string | null;
  popover: React.RefObject<HTMLDivElement | null>;
  choose: (next: { projectId: string; workflowId?: string | null }) => void;
}) {
  const [query, setQuery] = useState('');
  const [browsing, setBrowsing] = useState(projectId);
  const [active, setActive] = useState(0);
  const needle = query.trim().toLowerCase();
  const projects = overview.projects.filter(
    (project) =>
      !needle ||
      project.name.toLowerCase().includes(needle) ||
      overview.workflows.some(
        (workflow) =>
          workflow.projectId === project.id && workflow.name.toLowerCase().includes(needle),
      ),
  );
  const shownProject = projects.find((project) => project.id === browsing) ?? projects[0];
  const workflows = useMemo(
    () =>
      overview.workflows.filter(
        (workflow) =>
          workflow.projectId === shownProject?.id &&
          (!needle ||
            workflow.name.toLowerCase().includes(needle) ||
            shownProject.name.toLowerCase().includes(needle)),
      ),
    [overview.workflows, shownProject, needle],
  );
  useEffect(() => setActive(0), [needle, shownProject?.id]);
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, workflows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && workflows[active] && shownProject) {
      choose({ projectId: shownProject.id, workflowId: workflows[active].id });
    }
  };
  return (
    <div className="popover switcher" ref={popover} role="dialog" aria-label="Switch workflow">
      <label className="switcher-search">
        <Search aria-hidden="true" />
        <span className="visually-hidden">Search projects and workflows</span>
        <input
          autoFocus
          placeholder="Search projects and workflows"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={keys}
        />
      </label>
      <div className="switcher-columns">
        <div className="switcher-column" role="listbox" aria-label="Projects">
          <div className="column-label">Projects</div>
          {projects.length === 0 && <p className="option-empty">No project matches.</p>}
          {projects.map((project) => (
            <button
              key={project.id}
              className="option"
              role="option"
              aria-selected={project.id === shownProject?.id}
              onClick={() => setBrowsing(project.id)}
              onDoubleClick={() => choose({ projectId: project.id, workflowId: null })}
            >
              <Folder aria-hidden="true" />
              <span className="name">{project.name}</span>
              {project.id === projectId && <span className="detail">Current</span>}
            </button>
          ))}
        </div>
        <div className="switcher-column" role="listbox" aria-label="Workflows">
          <div className="column-label">Workflows</div>
          {shownProject && workflows.length === 0 && (
            <p className="option-empty">
              {needle ? 'No workflow matches.' : 'This project has no workflows yet.'}
            </p>
          )}
          {workflows.map((workflow, index) => (
            <button
              key={workflow.id}
              className={`option${index === active ? ' active' : ''}`}
              role="option"
              aria-selected={workflow.id === workflowId}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose({ projectId: shownProject!.id, workflowId: workflow.id })}
            >
              <Workflow aria-hidden="true" />
              <span className="name">{workflow.name}</span>
              <span className="detail">
                {workflow.activeVersionId ? 'Published' : 'Draft only'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
