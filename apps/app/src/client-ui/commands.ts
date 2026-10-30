import type { Overview } from '../shared/contracts.js';
import { runStateLabels, summary, typeLabels, type GraphDocument } from './graph.js';
import type { AttentionItem } from './owner.js';
import { relativeTime } from './time.js';

// What ⌘K offers (agreed 2026-10-29, actions first). With no query: what needs the owner, the
// actions that apply on screen, then recent workflows and runs. A query searches all of it, and
// the nodes of the open graph and projects too. Pure, so it is tested without a renderer.

export type PaletteGroup = 'Needs you' | 'Actions' | 'Workflows' | 'Runs' | 'Nodes' | 'Projects';

export type PaletteTarget =
  | { kind: 'attention'; item: AttentionItem }
  | { kind: 'action'; run: () => void }
  | { kind: 'project'; projectId: string }
  | { kind: 'workflow'; projectId: string; workflowId: string }
  | { kind: 'run'; projectId: string | null; workflowId: string | null; runId: string }
  | { kind: 'node'; nodeId: string };

export interface PaletteEntry {
  id: string;
  group: PaletteGroup;
  label: string;
  detail: string;
  // Also searched, not shown.
  keywords: string;
  target: PaletteTarget;
}

export interface PaletteAction {
  id: string;
  label: string;
  run: () => void;
}

const groupOrder: PaletteGroup[] = [
  'Needs you',
  'Actions',
  'Workflows',
  'Runs',
  'Nodes',
  'Projects',
];
const recentLimit = 5;
const resultLimit = 50;

export function paletteEntries(
  overview: Overview,
  items: AttentionItem[],
  actions: PaletteAction[],
  document: GraphDocument | null,
  now: number,
): PaletteEntry[] {
  const workflows = new Map(overview.workflows.map((workflow) => [workflow.id, workflow]));
  const projects = new Map(overview.projects.map((project) => [project.id, project]));
  return [
    ...items.map<PaletteEntry>((item) => ({
      id: `attention:${item.id}`,
      group: 'Needs you',
      label: item.title,
      detail: item.workflowName,
      keywords: '',
      target: { kind: 'attention', item },
    })),
    ...actions.map<PaletteEntry>((action) => ({
      id: `action:${action.id}`,
      group: 'Actions',
      label: action.label,
      detail: '',
      keywords: '',
      target: { kind: 'action', run: action.run },
    })),
    ...overview.workflows.map<PaletteEntry>((workflow) => ({
      id: `workflow:${workflow.id}`,
      group: 'Workflows',
      label: workflow.name,
      detail: projects.get(workflow.projectId)?.name ?? '',
      keywords: '',
      target: { kind: 'workflow', projectId: workflow.projectId, workflowId: workflow.id },
    })),
    ...[...overview.runs]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map<PaletteEntry>((run) => {
        const workflow = workflows.get(run.workflowId ?? '');
        return {
          id: `run:${run.id}`,
          group: 'Runs',
          label: `${workflow?.name ?? 'A workflow'} · ${runStateLabels[run.state]}`,
          detail: relativeTime(run.createdAt, now),
          keywords: run.id,
          target: {
            kind: 'run',
            projectId: workflow?.projectId ?? null,
            workflowId: workflow?.id ?? null,
            runId: run.id,
          },
        };
      }),
    ...(document?.nodes ?? []).map<PaletteEntry>((node) => ({
      id: `node:${node.id}`,
      group: 'Nodes',
      label: node.id,
      detail: typeLabels[node.type] ?? node.type,
      keywords: summary(node),
      target: { kind: 'node', nodeId: node.id },
    })),
    ...overview.projects.map<PaletteEntry>((project) => ({
      id: `project:${project.id}`,
      group: 'Projects',
      label: project.name,
      detail: '',
      keywords: '',
      target: { kind: 'project', projectId: project.id },
    })),
  ];
}

// The workflows that ran most recently, then the newest runs. Entries arrive with runs newest
// first, so a workflow's first run decides its place.
function recent(entries: PaletteEntry[]): PaletteEntry[] {
  const runs = entries.filter((entry) => entry.group === 'Runs');
  const order = [
    ...new Set(runs.map((entry) => (entry.target.kind === 'run' ? entry.target.workflowId : null))),
  ];
  const rank = (entry: PaletteEntry) => {
    const index = order.indexOf(entry.target.kind === 'workflow' ? entry.target.workflowId : null);
    return index === -1 ? order.length : index;
  };
  const workflows = entries
    .filter((entry) => entry.group === 'Workflows')
    .map((entry) => ({ entry, rank: rank(entry) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ entry }) => entry);
  return [...workflows.slice(0, recentLimit), ...runs.slice(0, recentLimit)];
}

// 0 when a word of the query is missing; higher is a better match of the label.
function score(entry: PaletteEntry, words: string[], query: string): number {
  const label = entry.label.toLowerCase();
  const text = `${label} ${entry.detail} ${entry.keywords}`.toLowerCase();
  if (!words.every((word) => text.includes(word))) return 0;
  if (label === query) return 4;
  if (label.startsWith(query)) return 3;
  if (label.split(/[\s·_-]+/).some((word) => word.startsWith(words[0]!))) return 2;
  return 1;
}

export function paletteView(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized)
    return [
      ...entries.filter((entry) => entry.group === 'Needs you' || entry.group === 'Actions'),
      ...recent(entries),
    ];
  const words = normalized.split(/\s+/);
  return entries
    .map((entry, index) => ({ entry, index, score: score(entry, words, normalized) }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        groupOrder.indexOf(a.entry.group) - groupOrder.indexOf(b.entry.group) ||
        a.index - b.index,
    )
    .slice(0, resultLimit)
    .map((item) => item.entry);
}
