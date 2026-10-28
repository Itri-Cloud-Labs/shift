import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Execution } from '../protocol/generated/types.js';
import {
  outputPorts,
  statusLabels,
  typeLabels,
  type DocumentConnection,
  type GraphDocument,
  type NodeRun,
} from './graph.js';
import { StatusLabel, TypeIcon } from './icons.js';

const json = (value: unknown) => JSON.stringify(value, null, 2);

// The right-edge island for the selected node: what it is, and in a run what it did.
export function Inspector({
  document,
  nodeId,
  run,
  close,
  select,
}: {
  document: GraphDocument;
  nodeId: string;
  // undefined on the draft, null when the run never reached the node.
  run: NodeRun | null | undefined;
  close: () => void;
  select: (nodeId: string) => void;
}) {
  const node = document.nodes.find((item) => item.id === nodeId);
  const inRun = run !== undefined;
  const [tab, setTab] = useState<'overview' | 'output' | 'config'>(inRun ? 'output' : 'overview');
  const passes = run?.executions ?? [];
  const [pass, setPass] = useState(passes.length - 1);
  useEffect(() => setPass(passes.length - 1), [nodeId, passes.length]);
  useEffect(() => {
    if (!inRun && tab === 'output') setTab('overview');
  }, [inRun, tab]);
  if (!node) return null;
  const incoming = document.connections.filter((item) => item.toNodeId === node.id);
  const outgoing = document.connections.filter((item) => item.fromNodeId === node.id);
  const execution = passes[pass];
  const tabs = [
    ...(inRun ? [['output', 'Output'] as const] : []),
    ['overview', 'Overview'] as const,
    ['config', 'Configuration'] as const,
  ];
  return (
    <aside className="island inspector" aria-label={`Inspector: ${node.id}`}>
      <header className="inspector-header">
        <span className="node-icon">
          <TypeIcon type={node.type} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{node.id}</h2>
          <p>{typeLabels[node.type] ?? node.type}</p>
        </div>
        <button className="button quiet icon" aria-label="Close inspector" onClick={close}>
          <X />
        </button>
      </header>
      <div className="tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className="tab"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="inspector-body" role="tabpanel">
        {tab === 'output' && (
          <RunOutput passes={passes} pass={pass} setPass={setPass} execution={execution} />
        )}
        {tab === 'overview' && (
          <>
            <dl className="fields">
              <dt>Type</dt>
              <dd>{typeLabels[node.type] ?? node.type}</dd>
              <dt>Outputs</dt>
              <dd>{outputPorts(node).join(', ') || 'None, it ends the run'}</dd>
              {inRun && (
                <>
                  <dt>In this run</dt>
                  <dd>
                    <StatusLabel status={run?.status ?? 'not_reached'} />
                  </dd>
                </>
              )}
            </dl>
            <h3 className="section-title">Connections</h3>
            {incoming.length + outgoing.length === 0 && (
              <p className="note">Nothing is connected to this node.</p>
            )}
            <ul className="attempts">
              {incoming.map((item) => (
                <ConnectionRow key={item.id} connection={item} from select={select} />
              ))}
              {outgoing.map((item) => (
                <ConnectionRow key={item.id} connection={item} select={select} />
              ))}
            </ul>
          </>
        )}
        {tab === 'config' && (
          <>
            {Object.keys(node.config).length === 0 ? (
              <p className="note">This node uses its defaults.</p>
            ) : (
              <pre className="code">{json(node.config)}</pre>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function ConnectionRow({
  connection,
  from,
  select,
}: {
  connection: DocumentConnection;
  from?: boolean;
  select: (nodeId: string) => void;
}) {
  const other = from ? connection.fromNodeId : connection.toNodeId;
  return (
    <li>
      <span className="note">
        {from ? `From ${connection.fromPort} of` : `${connection.fromPort} to`}
      </span>
      <button className="button quiet" onClick={() => select(other)}>
        {other}
      </button>
    </li>
  );
}

function RunOutput({
  passes,
  pass,
  setPass,
  execution,
}: {
  passes: Execution[];
  pass: number;
  setPass: (index: number) => void;
  execution: Execution | undefined;
}) {
  if (!execution) return <p className="note">The run has not reached this node.</p>;
  return (
    <>
      {passes.length > 1 && (
        <>
          <h3 className="section-title">Pass</h3>
          <div className="passes" role="group" aria-label="Choose a pass">
            {passes.map((item, index) => (
              <button
                key={item.id}
                className="pass"
                aria-pressed={index === pass}
                aria-label={`Pass ${index + 1}, ${statusLabels[stateOf(item)]}`}
                onClick={() => setPass(index)}
              >
                {index + 1}
              </button>
            ))}
          </div>
        </>
      )}
      <dl className="fields">
        <dt>State</dt>
        <dd>
          <StatusLabel status={stateOf(execution)} />
        </dd>
        {execution.port && (
          <>
            <dt>Took</dt>
            <dd>{execution.port}</dd>
          </>
        )}
        <dt>Execution</dt>
        <dd className="mono">#{execution.sequence}</dd>
      </dl>
      {execution.error !== null && execution.error !== undefined && (
        <>
          <h3 className="section-title">Error</h3>
          <pre className="code">{json(execution.error)}</pre>
        </>
      )}
      {execution.output !== null && execution.output !== undefined && (
        <>
          <h3 className="section-title">Output</h3>
          <pre className="code">{json(execution.output)}</pre>
        </>
      )}
      {execution.attempts.length > 0 && (
        <>
          <h3 className="section-title">Attempts</h3>
          <ul className="attempts">
            {execution.attempts.map((attempt) => (
              <li key={attempt.number}>
                <span>Attempt {attempt.number}</span>
                <span className="note">{attempt.state.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function stateOf(execution: Execution) {
  return (
    {
      PENDING: 'pending',
      RUNNING: 'running',
      WAITING: 'waiting',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
    } as const
  )[execution.state];
}

// The graph as lists, for keyboard and screen-reader use. Selecting here selects on the canvas.
export function ListView({
  document,
  runs,
  selected,
  select,
  close,
}: {
  document: GraphDocument;
  runs: Map<string, NodeRun> | null;
  selected: string | null;
  select: (nodeId: string) => void;
  close: () => void;
}) {
  return (
    <aside className="island list-view" aria-label="Nodes and connections">
      <header>
        <h2>Nodes and connections</h2>
        <button className="button quiet icon" aria-label="Close list" onClick={close}>
          <X />
        </button>
      </header>
      <div className="scroll">
        <div className="column-label">Nodes</div>
        <ul>
          {document.nodes.map((node) => (
            <li key={node.id}>
              <button
                className="option"
                aria-current={node.id === selected ? 'true' : undefined}
                aria-selected={node.id === selected}
                onClick={() => select(node.id)}
              >
                <TypeIcon type={node.type} />
                <span className="name">{node.id}</span>
                {runs && <StatusLabel status={runs.get(node.id)?.status ?? 'not_reached'} />}
              </button>
            </li>
          ))}
        </ul>
        <div className="column-label">Connections</div>
        {document.connections.length === 0 && <p className="option-empty">No connections.</p>}
        <ul>
          {document.connections.map((connection) => (
            <li key={connection.id} className="option">
              <span className="name">
                {connection.fromNodeId} <span className="note">{connection.fromPort} →</span>{' '}
                {connection.toNodeId}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
