import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import type { Run, Workflow } from '../protocol/generated/types.js';
import type { DesktopResponse } from '../shared/contracts.js';
import {
  ConnectionBanner,
  Hint,
  Notice,
  RunInput,
  RunStatus,
  StatusCluster,
  Toolbar,
  health,
} from './Bars.js';
import { ask, bridge, useLive, type DesktopState } from './bridge.js';
import { followed, layout, nodeRuns, readDocument, type GraphDocument } from './graph.js';
import { LocationIsland } from './Location.js';
import { NodeCard, type CardNode } from './NodeCard.js';
import { Inspector, ListView } from './Panels.js';
import { useRoute } from './route.js';

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
  const { overview, connection, sync } = desktop;
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
  const now = useNow(inRun && runValue !== null);

  const [listOpen, setListOpen] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
      setNotice('Checking whether the run started…');
    } else if (answer.kind === 'command' && answer.command.code === 'INVALID_INPUT') {
      setNotice(null);
      setInputOpen(true);
    } else {
      setNotice(null);
    }
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
              : null
          }
          selected={selected}
          select={select}
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
        {inRun && runValue && <RunStatus run={runValue} live={live} now={now} />}
      </div>
      <StatusCluster connection={connection} sync={sync} attention={overview.attention} />
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
        />
      )}
      {inputOpen && (
        <RunInput
          schema={trigger?.config['inputSchema']}
          start={(input) => void start(input)}
          close={() => setInputOpen(false)}
        />
      )}
      {notice && <Notice text={notice} />}
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
}: {
  document: GraphDocument;
  runs: ReturnType<typeof nodeRuns> | null;
  inRun: boolean;
  followedConnections: Set<string> | null;
  needsYou: string | null;
  selected: string | null;
  select: (nodeId: string | null) => void;
}) {
  const flow = useReactFlow();
  const positions = useMemo(() => layout(document), [document]);
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
        nodesDraggable={false}
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
