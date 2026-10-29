import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Run, Workflow } from '../protocol/generated/types.js';
import type { DesktopResponse } from '../shared/contracts.js';
import {
  ConnectionBanner,
  Hint,
  Notice,
  RunInput,
  type NoticeState,
  RunStatus,
  StatusCluster,
  Toolbar,
  health,
} from './Bars.js';
import { AttentionToast, Inbox, Resolve } from './Attention.js';
import { attentionItems, runControls, type AttentionItem } from './attention.js';
import { ask, bridge, useLive, type DesktopState } from './bridge.js';
import { followed, layout, nodeRuns, readDocument, type GraphDocument } from './graph.js';
import { LocationIsland } from './Location.js';
import { NodeCard, type CardNode } from './NodeCard.js';
import { Inspector, ListView } from './Panels.js';
import { useRoute } from './route.js';

type NodePosition = { nodeId: string; x: number; y: number };

const nodeTypes = { card: NodeCard };

interface Loaded<T> {
  value: T;
  stale: boolean;
}

// Reads a resource through the bridge, again after every change; keeps the last good copy.
function useResource<T>(
  read: (() => Promise<DesktopResponse>) | null,
  pick: (value: unknown) => T,
  key: string,
): Loaded<T> | null | undefined {
  return useLive<Loaded<T> | null>(async () => {
    if (!read) return null;
    const answer = await ask(read());
    if (answer.kind === 'resource') return { value: pick(answer.value), stale: answer.stale };
    if (answer.kind === 'error' && answer.code === 'NOT_FOUND') return null;
    return undefined;
  }, [key]);
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function Workspace({ desktop }: { desktop: DesktopState }) {
  return (
    <ReactFlowProvider>
      <Shell desktop={desktop} />
    </ReactFlowProvider>
  );
}

function Shell({ desktop }: { desktop: DesktopState }) {
  const { overview, connection, sync, interactions } = desktop;
  const [route, navigate] = useRoute();
  const live = sync.status === 'live';
  const projectId =
    overview.projects.find((item) => item.id === route.projectId)?.id ??
    overview.projects[0]?.id ??
    null;
  const workflowId =
    overview.workflows.find((item) => item.id === route.workflowId && item.projectId === projectId)
      ?.id ??
    overview.workflows.find((item) => item.projectId === projectId)?.id ??
    null;

  const workflow = useResource<Workflow>(
    workflowId ? () => bridge().data.workflow(workflowId) : null,
    (value) => (value as { workflow: Workflow }).workflow,
    `workflow:${workflowId}`,
  );
  const run = useResource<Run>(
    route.runId ? () => bridge().data.run(route.runId!) : null,
    (value) => (value as { run: Run }).run,
    `run:${route.runId}`,
  );
  const runValue = run?.value && run.value.workflowId === workflowId ? run.value : null;
  const version = useResource<unknown>(
    runValue?.workflowId && runValue.versionId
      ? () => bridge().data.version(runValue.workflowId!, runValue.versionId!)
      : null,
    (value) => (value as { version: { document: unknown } }).version.document,
    `version:${runValue?.versionId}`,
  );

  const inRun = route.runId !== null;
  const source = inRun ? version?.value : workflow?.value.draft;
  const document = useMemo<GraphDocument | null>(
    () => (source === undefined ? null : readDocument(source)),
    [source],
  );
  const runs = useMemo(() => (runValue ? nodeRuns(runValue) : null), [runValue]);
  const controls = runValue ? runControls(runValue) : null;
  const decidable =
    controls !== null &&
    (controls.retry || controls.fail || controls.complete || controls.extend !== null);
  const resultSchema =
    controls?.complete && controls.nodeId && version?.value
      ? readDocument(version.value).nodes.find((node) => node.id === controls.nodeId)?.config[
          'resultSchema'
        ]
      : undefined;
  const now = useNow(inRun && runValue !== null);

  const [listOpen, setListOpen] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [resolveFor, setResolveFor] = useState<string | null>(null);

  // What needs the owner. A toast announces an item that appears while the app is open, unless
  // its run is already on screen.
  const items = useMemo(() => attentionItems(overview, interactions), [overview, interactions]);
  const seen = useRef<Set<string> | null>(null);
  const [toast, setToast] = useState<AttentionItem | null>(null);
  // Counting starts with the first synchronized or cached state, so what was already open then
  // is not announced.
  const synchronized = sync.cached !== null;
  useEffect(() => {
    if (!synchronized) return;
    const known = seen.current;
    seen.current = new Set([...(known ?? []), ...items.map((item) => item.id)]);
    if (!known) return;
    const fresh = items.filter((item) => !known.has(item.id) && item.runId !== route.runId);
    if (fresh.length) setToast(fresh[fresh.length - 1]!);
  }, [items, synchronized]);
  useEffect(() => {
    if (toast && !items.some((item) => item.id === toast.id)) setToast(null);
  }, [items, toast]);
  const openItem = (item: AttentionItem, nodeId: string | null) => {
    setInboxOpen(false);
    setToast(null);
    navigate({
      ...(item.projectId ? { projectId: item.projectId } : {}),
      ...(item.workflowId ? { workflowId: item.workflowId } : {}),
      runId: item.runId,
      nodeId,
    });
    setResolveFor(item.kind === 'stuck' ? item.runId : null);
  };

  const select = (nodeId: string | null) => navigate({ nodeId });
  const selected = document?.nodes.some((node) => node.id === route.nodeId) ? route.nodeId : null;

  // Run starts the published version, so its trigger decides whether input is needed.
  const activeVersionId = workflow?.value.activeVersionId ?? null;
  const active = useResource<unknown>(
    workflowId && activeVersionId ? () => bridge().data.version(workflowId, activeVersionId) : null,
    (value) => (value as { version: { document: unknown } }).version.document,
    `version:${activeVersionId}`,
  );
  const trigger = active?.value
    ? readDocument(active.value).nodes.find((node) => node.type === 'manual_trigger')
    : undefined;
  const published = Boolean(workflow?.value.activeVersionId);
  const canRun = live && published;
  const runHint = !published
    ? 'Publish a version of this workflow before running it.'
    : !live
      ? 'Runs start once the server is connected.'
      : 'Start a run of the published version';

  const start = async (input: unknown) => {
    if (!workflowId) return;
    setInputOpen(false);
    setStarting(true);
    const answer = await ask(bridge().run.start(workflowId, input));
    setStarting(false);
    if (answer.kind === 'command' && answer.runId) {
      setNotice(null);
      navigate({ runId: answer.runId, nodeId: null });
    } else if (answer.kind === 'command' && answer.command.state === 'unknown') {
      setNotice({ text: 'Checking whether the run started…', tone: 'busy' });
    } else if (answer.kind === 'command' && answer.command.code === 'INVALID_INPUT') {
      setNotice(null);
      setInputOpen(true);
    } else {
      setNotice(null);
    }
  };

  // Saves node positions on the draft at the revision on screen.
  const move = async (positions: NodePosition[]): Promise<boolean> => {
    if (!workflowId || !workflow?.value) return false;
    const answer = await ask(
      bridge().workflow.move(workflowId, workflow.value.draftRevision, positions),
    );
    if (answer.kind === 'command' && answer.command.state === 'accepted') {
      setNotice(null);
      return true;
    }
    setNotice(
      answer.kind === 'command' && answer.command.state === 'unknown'
        ? { text: 'Checking whether the layout was saved…', tone: 'busy' }
        : answer.kind === 'command' && answer.command.code === 'REVISION_CONFLICT'
          ? { text: 'This draft changed elsewhere, so the move was not saved.', tone: 'problem' }
          : { text: 'The move could not be saved.', tone: 'problem' },
    );
    return false;
  };

  const latestVersion = workflow?.value.versions.at(-1);
  const publishLabel = inRun
    ? null
    : !workflow?.value
      ? null
      : latestVersion
        ? `v${latestVersion.number} published`
        : 'Not published';

  const hint = !overview.projects.length ? (
    <Hint title="Add a project to start">
      Projects are repositories on the server. Add one there with{' '}
      <code>shift project add &lt;path&gt;</code>, and it appears here.
    </Hint>
  ) : !workflowId ? (
    <Hint title="This project has no workflows">
      Create one on the server with <code>shift workflow create</code>. It opens here as soon as it
      exists.
    </Hint>
  ) : document && document.nodes.length === 0 ? (
    <Hint title="This draft is empty">
      It has no nodes yet. Save a draft with <code>shift workflow save</code> to see it here.
    </Hint>
  ) : null;

  return (
    <div className={inRun ? 'workspace in-run' : 'workspace'}>
      <div className="titlebar" />
      {document && document.nodes.length > 0 ? (
        <Canvas
          document={document}
          runs={runs}
          inRun={inRun}
          followedConnections={runValue ? followed(runValue) : null}
          needsYou={
            runValue?.wait?.['kind'] === 'human'
              ? (runValue.executions.find((item) => item.id === runValue.wait?.['executionId'])
                  ?.node ?? null)
              : decidable
                ? controls.nodeId
                : null
          }
          selected={selected}
          select={select}
          move={!inRun && live && workflow?.value && !workflow.stale ? move : null}
        />
      ) : workflowId && document === null && health(connection, sync) !== 'offline' ? (
        <Skeleton />
      ) : (
        <div className="canvas" aria-hidden="true" />
      )}
      {hint}
      <div className={`top-left${selected ? ' inspecting' : ''}`}>
        <LocationIsland
          overview={overview}
          route={route}
          projectId={projectId}
          workflowId={workflowId}
          navigate={navigate}
        />
        {inRun && runValue && (
          <RunStatus
            run={runValue}
            live={live}
            now={now}
            resolve={decidable ? () => setResolveFor(runValue.id) : null}
          />
        )}
      </div>
      <StatusCluster
        connection={connection}
        sync={sync}
        attention={items.length}
        inboxOpen={inboxOpen}
        openInbox={() => setInboxOpen(!inboxOpen)}
      />
      <ConnectionBanner connection={connection} sync={sync} />
      {document && listOpen && (
        <ListView
          document={document}
          runs={inRun ? runs : null}
          selected={selected}
          select={select}
          close={() => setListOpen(false)}
        />
      )}
      {document && selected && (
        <Inspector
          document={document}
          nodeId={selected}
          run={inRun ? (runs?.get(selected) ?? null) : undefined}
          close={() => select(null)}
          select={select}
          requests={
            inRun
              ? interactions.filter((item) => item.runId === route.runId && item.node === selected)
              : []
          }
          live={live}
          deviceId={connection.profiles.find((item) => item.active)?.deviceId ?? null}
          commands={sync.commands}
        />
      )}
      {decidable && runValue && resolveFor === runValue.id && (
        <Resolve
          key={runValue.id}
          run={runValue}
          controls={controls}
          resultSchema={resultSchema}
          live={live}
          commands={sync.commands}
          close={() => setResolveFor(null)}
        />
      )}
      {inboxOpen && <Inbox items={items} open={openItem} close={() => setInboxOpen(false)} />}
      {toast && !inboxOpen && (
        <AttentionToast
          item={toast}
          open={() => openItem(toast, toast.nodeId)}
          dismiss={() => setToast(null)}
        />
      )}
      {inputOpen && (
        <RunInput
          schema={trigger?.config['inputSchema']}
          start={(input) => void start(input)}
          close={() => setInputOpen(false)}
        />
      )}
      {notice && <Notice notice={notice} dismiss={() => setNotice(null)} />}
      {workflowId && (
        <Toolbar
          listOpen={listOpen}
          toggleList={() => setListOpen(!listOpen)}
          canRun={canRun}
          runHint={runHint}
          starting={starting}
          run={() => (trigger?.config['inputSchema'] ? setInputOpen(true) : void start({}))}
          publishLabel={publishLabel}
        />
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="skeleton" aria-label="Loading the graph" role="status">
      <div className="skeleton-row">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    </div>
  );
}

function Canvas({
  document,
  runs,
  inRun,
  followedConnections,
  needsYou,
  selected,
  select,
  move,
}: {
  document: GraphDocument;
  runs: ReturnType<typeof nodeRuns> | null;
  inRun: boolean;
  followedConnections: Set<string> | null;
  needsYou: string | null;
  selected: string | null;
  select: (nodeId: string | null) => void;
  // Present when the draft can be rearranged; resolves whether the positions were saved.
  move: ((positions: NodePosition[]) => Promise<boolean>) | null;
}) {
  const flow = useReactFlow();
  const laid = useMemo(() => layout(document), [document]);
  // Positions moved on screen and not yet in the document the server returned.
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const [saving, setSaving] = useState(false);
  const dragging = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const positions = useMemo(() => {
    const merged = new Map(laid);
    for (const [id, position] of Object.entries(moved)) merged.set(id, position);
    return merged;
  }, [laid, moved]);
  // A newer document carries the saved positions; local ones are no longer needed.
  useEffect(() => {
    if (!dragging.current && !saving) setMoved({});
  }, [document]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const latestPositions = useRef(positions);
  latestPositions.current = positions;
  const save = () => {
    if (!move) return;
    clearTimeout(timer.current);
    // Shortly after the last movement, so arrow-key nudges save once.
    timer.current = setTimeout(async () => {
      setSaving(true);
      const saved = await move(
        [...latestPositions.current].map(([nodeId, { x, y }]) => ({ nodeId, x, y })),
      );
      setSaving(false);
      if (!saved) setMoved({});
    }, 300);
  };
  const onNodesChange = (changes: NodeChange<CardNode>[]) => {
    if (!move) return;
    for (const change of changes) {
      if (change.type !== 'position' || !change.position) continue;
      const { id, position } = change;
      setMoved((current) => ({ ...current, [id]: position }));
      // Any movement postpones a pending save until the node is still again.
      clearTimeout(timer.current);
      dragging.current = change.dragging === true;
      if (!dragging.current) save();
    }
  };
  const nodes = useMemo<CardNode[]>(
    () =>
      document.nodes.map((node) => ({
        id: node.id,
        type: 'card',
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        selected: node.id === selected,
        data: {
          node,
          ...(inRun ? { run: runs?.get(node.id) ?? null } : {}),
          needsYou: node.id === needsYou,
        },
      })),
    [document, positions, runs, inRun, needsYou, selected],
  );
  const edges = useMemo<Edge[]>(
    () =>
      document.connections.map((connection) => {
        const taken = followedConnections?.has(connection.id) ?? false;
        return {
          id: connection.id,
          source: connection.fromNodeId,
          sourceHandle: connection.fromPort,
          target: connection.toNodeId,
          targetHandle: 'input',
          type: 'default',
          ...(inRun ? { className: taken ? 'followed' : 'muted' } : {}),
          focusable: false,
          selectable: false,
        };
      }),
    [document, followedConnections, inRun],
  );
  // Frame the graph whenever a different one opens.
  const shape = document.nodes.map((node) => node.id).join('|');
  useEffect(() => {
    const frame = requestAnimationFrame(
      () => void flow.fitView({ padding: 0.15, minZoom: 0.75, maxZoom: 1.1 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [shape, flow]);
  return (
    <div className="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={move !== null && !saving}
        onNodesChange={onNodesChange}
        onNodeDragStop={() => {
          dragging.current = false;
          save();
        }}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, node) => select(node.id)}
        onPaneClick={() => select(null)}
        minZoom={0.2}
        maxZoom={1.75}
        fitView
        fitViewOptions={{ padding: 0.15, minZoom: 0.75, maxZoom: 1.1 }}
        proOptions={{ hideAttribution: true }}
        colorMode="system"
        aria-label="Workflow graph"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
      </ReactFlow>
    </div>
  );
}
