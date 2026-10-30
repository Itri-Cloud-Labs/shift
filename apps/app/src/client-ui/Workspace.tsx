import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
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
import { attentionItems, runControls, type AttentionItem } from './owner.js';
import { ask, bridge, useLive, type DesktopState } from './bridge.js';
import { finished, followed, layout, nodeRuns, readDocument, type GraphDocument } from './graph.js';
import { LocationIsland } from './Location.js';
import { NodeCard, type CardNode } from './NodeCard.js';
import { Inspector, ListView } from './Panels.js';
import {
  addNode,
  commit,
  connect,
  deleteConnection,
  deleteNode,
  diagnose,
  duplicateNode,
  isDirty,
  keepMine,
  reconnect,
  receive,
  redo,
  renameNode,
  sameDraft,
  saved,
  serverProblems,
  setConfig,
  startLocal,
  takeTheirs,
  undo,
  withLayout,
  withPositions,
  type Draft,
  type DraftProblem,
  type EditResult,
  type LocalDraft,
  type NodePosition,
} from './draft.js';
import { ConflictIsland, NodeEditor, NodePicker, ProblemsPanel } from './Editor.js';
import { Palette } from './Palette.js';
import { paletteEntries, type PaletteAction, type PaletteEntry } from './commands.js';
import { useRoute } from './route.js';
import { Settings, type SettingsSection } from './Settings.js';

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
  const { overview, connection, sync, interactions, preferences } = desktop;
  const flow = useReactFlow();
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

  // Local edits, per workflow, so switching away keeps them. They stay apart from the server's
  // revisions until the owner saves.
  const [locals, setLocals] = useState<Record<string, LocalDraft>>({});
  // Text typed into a field and not committed yet counts as a local edit.
  const [typing, setTyping] = useState(false);
  const [pendingSave, setPendingSave] = useState<{
    workflowId: string;
    commandId: string | null;
    revision: number;
    sent: Draft;
  } | null>(null);
  const local = workflowId ? locals[workflowId] : undefined;
  const updateLocal = (change: (current: LocalDraft) => LocalDraft) => {
    if (!workflowId) return;
    setLocals((all) => {
      const current = all[workflowId];
      return current ? { ...all, [workflowId]: change(current) } : all;
    });
  };
  // A save's own new revision must not look like someone else's, so reads wait for its outcome.
  const serverDraft = workflow?.value.draft as Draft | undefined;
  const serverRevision = workflow?.value.draftRevision;
  useEffect(() => {
    if (!workflowId || !serverDraft || serverRevision === undefined || pendingSave || typing)
      return;
    setLocals((all) => {
      const current = all[workflowId];
      const next = current
        ? receive(current, serverRevision, serverDraft)
        : startLocal(serverRevision, serverDraft);
      return next === current ? all : { ...all, [workflowId]: next };
    });
  }, [workflowId, serverDraft, serverRevision, pendingSave, typing]);
  const dirty = local ? isDirty(local) : false;
  const present = local?.history.present;

  const source = inRun ? version?.value : (present ?? workflow?.value.draft);
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
  const [cancelling, setCancelling] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  useEffect(() => setCancelling(false), [route.runId]);

  // ⌘K (Ctrl+K elsewhere) from anywhere but Settings, which is a modal of its own; ⌘, opens it.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key === 'k' && settings === null) {
        event.preventDefault();
        setInboxOpen(false);
        setPaletteOpen((open) => !open);
      } else if (event.key === ',') {
        event.preventDefault();
        setPaletteOpen(false);
        setInboxOpen(false);
        setSettings((open) => open ?? 'connection');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [settings]);

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
    // Only what is open now: a run that resumes and stops again needs the owner again.
    seen.current = new Set(items.map((item) => item.id));
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

  // ---------- Editing ----------

  const editable = !inRun && workflowId !== null && present !== undefined;
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [picker, setPicker] = useState<{
    position: { x: number; y: number };
    from: { nodeId: string; port: string } | null;
  } | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [publishProblems, setPublishProblems] = useState<DraftProblem[]>([]);
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const [pendingPublish, setPendingPublish] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const problems = useMemo(
    () => (present && !inRun ? [...diagnose(present), ...publishProblems] : []),
    [present, inRun, publishProblems],
  );
  const problemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const problem of problems)
      if (problem.nodeId && problem.severity === 'error')
        counts[problem.nodeId] = (counts[problem.nodeId] ?? 0) + 1;
    return counts;
  }, [problems]);

  // Every edit is one undo step, on top of the layout the owner is looking at.
  const edit = (change: (draft: Draft) => Draft) => {
    setPublishProblems([]);
    updateLocal((current) => {
      const next = change(withLayout(current.history.present));
      return { ...current, history: commit(current.history, next) };
    });
  };
  const apply = (result: EditResult) => {
    if ('problem' in result) {
      setNotice({ text: result.problem, tone: 'problem' });
      return null;
    }
    setNotice(null);
    return result.draft;
  };
  const tryEdit = (change: (draft: Draft) => EditResult): string | null => {
    if (!present) return null;
    const result = change(withLayout(present));
    const next = apply(result);
    if (next) edit(() => next);
    return 'problem' in result ? result.problem : null;
  };
  const clearSelection = (nodeId: string) => {
    if (route.nodeId === nodeId) navigate({ nodeId: null });
  };
  const add = (type: string) => {
    if (!picker || !present) return;
    const { position, from } = picker;
    setPicker(null);
    const added = addNode(withLayout(present), type, position);
    const linked = from ? connect(added.draft, from.nodeId, from.port, added.nodeId) : null;
    edit(() => (linked && 'draft' in linked ? linked.draft : added.draft));
    if (linked && 'problem' in linked) setNotice({ text: linked.problem, tone: 'problem' });
    setFocusNode(added.nodeId);
    navigate({ nodeId: added.nodeId });
  };
  const removeNode = (nodeId: string) => {
    edit((draft) => deleteNode(draft, nodeId));
    clearSelection(nodeId);
  };
  const duplicate = (nodeId: string) => {
    if (!present) return;
    const copy = duplicateNode(withLayout(present), nodeId);
    edit(() => copy.draft);
    setFocusNode(copy.nodeId);
    navigate({ nodeId: copy.nodeId });
  };
  const openPicker = () => {
    const centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setPicker({ position: flow.screenToFlowPosition(centre), from: null });
  };
  const moveNodes = (positions: NodePosition[]) => edit((draft) => withPositions(draft, positions));
  const connectPort = (nodeId: string, port: string, target: string | null) => {
    const existing = document?.connections.find(
      (item) => item.fromNodeId === nodeId && item.fromPort === port,
    );
    if (target === null) {
      if (existing) edit((draft) => deleteConnection(draft, existing.id));
    } else if (existing) {
      tryEdit((draft) => reconnect(draft, existing.id, nodeId, port, target));
    } else {
      tryEdit((draft) => connect(draft, nodeId, port, target));
    }
  };

  const commandById = (id: string | null | undefined) =>
    id ? sync.commands.find((item) => item.commandId === id) : undefined;
  const save = async () => {
    if (!workflowId || !local || !present) return;
    const sent = present;
    const revision = local.revision;
    setPendingSave({ workflowId, commandId: null, revision, sent });
    const answer = await ask(bridge().workflow.save(workflowId, revision, sent));
    if (answer.kind === 'command')
      setPendingSave({ workflowId, commandId: answer.command.commandId, revision, sent });
    else {
      setPendingSave(null);
      setNotice({
        text: 'The draft could not be saved. Your edits are still here.',
        tone: 'problem',
      });
    }
  };
  const saveCommand = commandById(pendingSave?.commandId);
  useEffect(() => {
    if (!pendingSave || !saveCommand) return;
    const { workflowId: id, revision, sent } = pendingSave;
    if (saveCommand.state === 'accepted') {
      setLocals((all) => {
        const current = all[id];
        return current ? { ...all, [id]: saved(current, revision + 1, sent) } : all;
      });
      setNotice(null);
      setPendingSave(null);
    } else if (saveCommand.state === 'unknown') {
      setNotice({ text: 'Checking whether the draft was saved…', tone: 'busy' });
    } else if (saveCommand.state === 'rejected' || saveCommand.state === 'not_applied') {
      setNotice({
        text:
          saveCommand.state === 'not_applied'
            ? 'The save did not reach the server. Your edits are still here; save again.'
            : saveCommand.code === 'REVISION_CONFLICT'
              ? 'This draft changed elsewhere, so nothing was overwritten.'
              : `The draft was not saved: ${saveCommand.message ?? 'the server refused it.'}`,
        tone: 'problem',
      });
      setPendingSave(null);
    }
  }, [saveCommand?.state]);
  const publish = async () => {
    if (!workflowId || !local) return;
    setPublishing(true);
    setPublishProblems([]);
    const answer = await ask(bridge().workflow.publish(workflowId, local.revision));
    setPublishing(false);
    if (answer.kind === 'command') setPendingPublish(answer.command.commandId);
    else setNotice({ text: 'The draft could not be published.', tone: 'problem' });
  };
  const publishCommand = commandById(pendingPublish);
  useEffect(() => {
    if (!publishCommand) return;
    if (publishCommand.state === 'accepted') {
      setNotice(null);
      setPendingPublish(null);
    } else if (publishCommand.state === 'unknown') {
      setNotice({ text: 'Checking whether the draft was published…', tone: 'busy' });
    } else if (publishCommand.state === 'rejected' || publishCommand.state === 'not_applied') {
      if (publishCommand.code === 'INVALID_WORKFLOW' && present) {
        setPublishProblems(serverProblems(present, publishCommand.diagnostics));
        setProblemsOpen(true);
        setNotice({
          text: 'The server found problems, so nothing was published.',
          tone: 'problem',
        });
      } else {
        setNotice({
          text:
            publishCommand.code === 'REVISION_CONFLICT'
              ? 'This draft changed elsewhere, so nothing was published.'
              : (publishCommand.message ?? 'The draft could not be published.'),
          tone: 'problem',
        });
      }
      setPendingPublish(null);
    }
  }, [publishCommand?.state]);
  const busy = pendingSave !== null || publishing || pendingPublish !== null;
  const canUndo = editable && (local?.history.past.length ?? 0) > 0;
  const canRedo = editable && (local?.history.future.length ?? 0) > 0;
  const stepBack = () => updateLocal((current) => ({ ...current, history: undo(current.history) }));
  const stepForward = () =>
    updateLocal((current) => ({ ...current, history: redo(current.history) }));

  // Editing shortcuts. In a field the keys belong to the field.
  const shortcuts = useRef<(event: KeyboardEvent) => void>(() => undefined);
  shortcuts.current = (event) => {
    // A dialog owns the keyboard; nothing behind it changes.
    if (
      !editable ||
      settings !== null ||
      paletteOpen ||
      inboxOpen ||
      picker !== null ||
      inputOpen ||
      resolveFor !== null ||
      local?.theirs
    )
      return;
    const target = event.target as HTMLElement | null;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable === true;
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (command && key === 's') {
      event.preventDefault();
      // A field being typed in commits when it loses focus.
      target?.blur?.();
      if (live && !busy) setTimeout(() => void saveRef.current(), 0);
      return;
    }
    if (typing) return;
    if (command && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) stepForward();
      else stepBack();
    } else if (command && key === 'y') {
      event.preventDefault();
      stepForward();
    } else if (command && key === 'd' && selected) {
      event.preventDefault();
      duplicate(selected);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !command) {
      if (selectedEdge) {
        event.preventDefault();
        edit((draft) => deleteConnection(draft, selectedEdge));
        setSelectedEdge(null);
      } else if (selected) {
        event.preventDefault();
        removeNode(selected);
      }
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const key = (event: KeyboardEvent) => shortcuts.current(event);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    setSelectedEdge(null);
    setPicker(null);
    setPublishProblems([]);
  }, [workflowId, inRun]);

  const latestVersion = workflow?.value.versions.at(-1);
  const publishLabel = inRun
    ? null
    : !workflow?.value
      ? null
      : latestVersion
        ? `v${latestVersion.number} published`
        : 'Not published';

  // Only what applies right now; a disabled action is not offered.
  const cancellable =
    runValue !== null && live && !finished(runValue.state) && runValue.state !== 'CANCEL_REQUESTED';
  const actions: PaletteAction[] = paletteOpen
    ? [
        ...(canRun && !starting && workflowId
          ? [
              {
                id: 'run',
                label: 'Start a run',
                run: () => (trigger?.config['inputSchema'] ? setInputOpen(true) : void start({})),
              },
            ]
          : []),
        ...(cancellable
          ? [{ id: 'cancel', label: 'Cancel this run…', run: () => setCancelling(true) }]
          : []),
        ...(decidable && runValue
          ? [
              {
                id: 'decide',
                label: 'Decide how this run continues…',
                run: () => setResolveFor(runValue.id),
              },
            ]
          : []),
        ...(inRun
          ? [
              {
                id: 'draft',
                label: 'Open the draft',
                run: () => navigate({ runId: null, nodeId: null }),
              },
            ]
          : []),
        ...(health(connection, sync) === 'offline' && connection.profileId
          ? [
              {
                id: 'reconnect',
                label: 'Reconnect to the server',
                run: () => void ask(bridge().connection.connect(connection.profileId!)),
              },
            ]
          : []),
        ...(editable
          ? [
              { id: 'add', label: 'Add a node', run: openPicker },
              ...(canUndo ? [{ id: 'undo', label: 'Undo', run: stepBack }] : []),
              ...(canRedo ? [{ id: 'redo', label: 'Redo', run: stepForward }] : []),
              ...(dirty && live && !busy
                ? [{ id: 'save', label: 'Save the draft', run: () => void save() }]
                : []),
              ...(!dirty && live && !busy
                ? [{ id: 'publish', label: 'Publish the draft', run: () => void publish() }]
                : []),
            ]
          : []),
        { id: 'inbox', label: 'Open the inbox', run: () => setInboxOpen(true) },
        ...(document
          ? [
              {
                id: 'fit',
                label: 'Fit the graph',
                run: () => void flow.fitView({ padding: 0.2, duration: 200 }),
              },
              {
                id: 'list',
                label: listOpen ? 'Hide the node list' : 'Show the node list',
                run: () => setListOpen(!listOpen),
              },
            ]
          : []),
        { id: 'settings', label: 'Open settings', run: () => setSettings('connection') },
        { id: 'devices', label: 'Manage devices', run: () => setSettings('devices') },
        ...(['system', 'light', 'dark'] as const)
          .filter((theme) => theme !== preferences.theme)
          .map((theme) => ({
            id: `theme-${theme}`,
            label: `Use the ${theme === 'system' ? 'system' : theme} theme`,
            run: () => void ask(bridge().preferences.set({ ...preferences, theme })),
          })),
      ]
    : [];
  const entries = paletteOpen ? paletteEntries(overview, items, actions, document, Date.now()) : [];
  const choose = (entry: PaletteEntry) => {
    setPaletteOpen(false);
    const { target } = entry;
    if (target.kind === 'attention') openItem(target.item, target.item.nodeId);
    else if (target.kind === 'action') target.run();
    else if (target.kind === 'node') select(target.nodeId);
    else if (target.kind === 'project')
      navigate({ projectId: target.projectId, workflowId: null, runId: null, nodeId: null });
    else if (target.kind === 'workflow')
      navigate({
        projectId: target.projectId,
        workflowId: target.workflowId,
        runId: null,
        nodeId: null,
      });
    else
      navigate({
        ...(target.projectId ? { projectId: target.projectId } : {}),
        ...(target.workflowId ? { workflowId: target.workflowId } : {}),
        runId: target.runId,
        nodeId: null,
      });
  };

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
      {inRun ? 'It has no nodes.' : 'Add a manual trigger with the + in the toolbar to begin.'}
    </Hint>
  ) : null;

  return (
    <div className={inRun ? 'workspace in-run' : 'workspace'}>
      <div className="titlebar" />
      {document ? (
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
          problems={problemCounts}
          editing={
            editable
              ? {
                  move: moveNodes,
                  connect: (connection) =>
                    tryEdit((draft) =>
                      connect(
                        draft,
                        connection.source,
                        connection.sourceHandle ?? '',
                        connection.target,
                      ),
                    ),
                  reconnect: (id, connection) =>
                    tryEdit((draft) =>
                      reconnect(
                        draft,
                        id,
                        connection.source,
                        connection.sourceHandle ?? '',
                        connection.target,
                      ),
                    ),
                  dropOnCanvas: (position, from) => setPicker({ position, from }),
                  selectedEdge,
                  selectEdge: setSelectedEdge,
                }
              : null
          }
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
          badge={
            inRun || !present
              ? null
              : dirty
                ? 'Draft · unsaved changes'
                : !sameDraft(present, active?.value)
                  ? 'Draft · unpublished changes'
                  : null
          }
        />
        {inRun && runValue && (
          <RunStatus
            run={runValue}
            live={live}
            now={now}
            resolve={decidable ? () => setResolveFor(runValue.id) : null}
            confirming={cancelling}
            setConfirming={setCancelling}
          />
        )}
      </div>
      <StatusCluster
        connection={connection}
        sync={sync}
        attention={items.length}
        inboxOpen={inboxOpen}
        openInbox={() => setInboxOpen(!inboxOpen)}
        openPalette={() => setPaletteOpen(true)}
        openSettings={() => setSettings('connection')}
      />
      <ConnectionBanner connection={connection} sync={sync} />
      {document && listOpen && (
        <ListView
          document={document}
          runs={inRun ? runs : null}
          selected={selected}
          select={select}
          close={() => setListOpen(false)}
          removeConnection={editable ? (id) => edit((draft) => deleteConnection(draft, id)) : null}
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
          editor={
            editable ? (
              <NodeEditor
                key={selected}
                document={document}
                node={document.nodes.find((node) => node.id === selected)!}
                problems={problems}
                focus={focusNode === selected}
                editing={{
                  rename: (next) => {
                    const problem = tryEdit((draft) => renameNode(draft, selected, next));
                    if (!problem) {
                      setFocusNode(null);
                      navigate({ nodeId: next });
                    }
                    return problem;
                  },
                  set: (key, value) => edit((draft) => setConfig(draft, selected, key, value)),
                  connectPort: (port, target) => connectPort(selected, port, target),
                  typing: setTyping,
                  duplicate: () => duplicate(selected),
                  remove: () => removeNode(selected),
                }}
              />
            ) : null
          }
        />
      )}
      {editable && picker && (
        <NodePicker
          hasTrigger={document?.nodes.some((node) => node.type === 'manual_trigger') ?? false}
          choose={add}
          close={() => setPicker(null)}
        />
      )}
      {editable && problemsOpen && (
        <ProblemsPanel
          problems={problems}
          select={(nodeId) => navigate({ nodeId })}
          close={() => setProblemsOpen(false)}
        />
      )}
      {editable && local?.theirs && document && (
        <ConflictIsland
          revision={local.theirs.revision}
          mine={document}
          theirs={readDocument(local.theirs.draft)}
          keepMine={() => updateLocal(keepMine)}
          takeTheirs={() => {
            updateLocal(takeTheirs);
            setNotice(null);
          }}
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
      {settings && (
        <Settings
          connection={connection}
          sync={sync}
          preferences={preferences}
          section={settings}
          setSection={setSettings}
          close={() => setSettings(null)}
        />
      )}
      {paletteOpen && (
        <Palette entries={entries} choose={choose} close={() => setPaletteOpen(false)} />
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
          editor={
            editable
              ? {
                  add: openPicker,
                  undo: canUndo ? stepBack : null,
                  redo: canRedo ? stepForward : null,
                  dirty,
                  busy,
                  live,
                  save: () => void save(),
                  publish: () => void publish(),
                  problems: problems.length,
                  problemsOpen,
                  toggleProblems: () => setProblemsOpen(!problemsOpen),
                }
              : null
          }
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
  problems,
  editing,
}: {
  document: GraphDocument;
  runs: ReturnType<typeof nodeRuns> | null;
  inRun: boolean;
  followedConnections: Set<string> | null;
  needsYou: string | null;
  selected: string | null;
  select: (nodeId: string | null) => void;
  problems: Record<string, number>;
  // Present on an editable draft. Positions and connections go to local edits; only Save sends.
  editing: {
    move: (positions: NodePosition[]) => void;
    connect: (connection: Connection) => unknown;
    reconnect: (id: string, connection: Connection) => unknown;
    dropOnCanvas: (
      position: { x: number; y: number },
      from: { nodeId: string; port: string },
    ) => void;
    selectedEdge: string | null;
    selectEdge: (id: string | null) => void;
  } | null;
}) {
  const flow = useReactFlow();
  const laid = useMemo(() => layout(document), [document]);
  // Positions moved on screen and not yet in the document the server returned.
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const dragging = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const positions = useMemo(() => {
    const merged = new Map(laid);
    for (const [id, position] of Object.entries(moved)) merged.set(id, position);
    return merged;
  }, [laid, moved]);
  // A newer document carries the saved positions; local ones are no longer needed.
  useEffect(() => {
    if (!dragging.current) setMoved({});
  }, [document]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const latestPositions = useRef(positions);
  latestPositions.current = positions;
  const save = () => {
    if (!editing) return;
    clearTimeout(timer.current);
    // Shortly after the last movement, so arrow-key nudges make one undo step.
    timer.current = setTimeout(() => {
      editing.move([...latestPositions.current].map(([nodeId, { x, y }]) => ({ nodeId, x, y })));
    }, 300);
  };
  const onNodesChange = (changes: NodeChange<CardNode>[]) => {
    if (!editing) return;
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
          editable: editing !== null,
          problems: problems[node.id] ?? 0,
        },
      })),
    [document, positions, runs, inRun, needsYou, selected, editing !== null, problems],
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
          // A connection going back to an earlier node is drawn differently; it is a loop.
          className: [
            inRun ? (taken ? 'followed' : 'muted') : '',
            (positions.get(connection.toNodeId)?.x ?? 0) <=
            (positions.get(connection.fromNodeId)?.x ?? 0)
              ? 'backward'
              : '',
          ].join(' '),
          focusable: false,
          selectable: editing !== null,
          reconnectable: editing !== null,
          selected: editing?.selectedEdge === connection.id,
        };
      }),
    [document, followedConnections, inRun, positions, editing !== null, editing?.selectedEdge],
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
        nodesDraggable={editing !== null}
        onNodesChange={onNodesChange}
        onNodeDragStop={() => {
          dragging.current = false;
          save();
        }}
        nodesConnectable={editing !== null}
        elementsSelectable
        deleteKeyCode={null}
        onNodeClick={(_, node) => {
          editing?.selectEdge(null);
          select(node.id);
        }}
        onEdgeClick={(_, edge) => {
          select(null);
          editing?.selectEdge(edge.id);
        }}
        onPaneClick={() => {
          editing?.selectEdge(null);
          select(null);
        }}
        onConnect={(connection) => editing?.connect(connection)}
        onReconnect={(old, connection) => editing?.reconnect(old.id, connection)}
        onConnectEnd={(event, state: FinalConnectionState) => {
          if (!editing || state.isValid || !state.fromHandle?.id || !state.fromNode) return;
          // Dropped on empty canvas: choose what comes next, joined to this port.
          const point = 'changedTouches' in event ? event.changedTouches[0]! : event;
          editing.dropOnCanvas(flow.screenToFlowPosition({ x: point.clientX, y: point.clientY }), {
            nodeId: state.fromNode.id,
            port: state.fromHandle.id,
          });
        }}
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
