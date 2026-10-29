import { useEffect, useState } from 'react';

// Where the canvas is: project, workflow, run (or the draft) and the selected node. Kept in the
// URL fragment, so it survives reloads and every island links to the same place.

export interface Route {
  projectId: string | null;
  workflowId: string | null;
  // null shows the draft.
  runId: string | null;
  nodeId: string | null;
}

const empty: Route = { projectId: null, workflowId: null, runId: null, nodeId: null };
const keys = { p: 'projectId', w: 'workflowId', r: 'runId', n: 'nodeId' } as const;

export function parseRoute(hash: string): Route {
  const route: Route = { ...empty };
  const parts = hash.replace(/^#\/?/, '').split('/');
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const key = keys[parts[index] as keyof typeof keys];
    const value = decodeURIComponent(parts[index + 1]!);
    if (key && /^[A-Za-z0-9_.:-]{1,200}$/.test(value)) route[key] = value;
  }
  return route;
}

export function formatRoute(route: Route): string {
  const parts: string[] = [];
  for (const [short, key] of Object.entries(keys))
    if (route[key]) parts.push(short, encodeURIComponent(route[key]!));
  return `#/${parts.join('/')}`;
}

export function useRoute(): [Route, (next: Partial<Route>) => void] {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const update = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const navigate = (next: Partial<Route>) => {
    const target = formatRoute({ ...parseRoute(location.hash), ...next });
    if (target !== location.hash) location.hash = target;
  };
  return [route, navigate];
}
