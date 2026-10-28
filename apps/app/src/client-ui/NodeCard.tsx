import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import {
  outputPorts,
  hasInput,
  portOffset,
  statusLabels,
  summary,
  typeLabels,
  type DocumentNode,
  type NodeRun,
} from './graph.js';
import { StatusIcon, TypeIcon } from './icons.js';

export type CardData = {
  node: DocumentNode;
  // Present in run mode.
  run?: NodeRun | null;
  // A request in this node is waiting for the owner.
  needsYou?: boolean;
};

export type CardNode = Node<CardData, 'card'>;

// An n8n-style node card: type icon, name, one line of configuration and its named ports. In a
// run it also shows its state in words and, after a loop, how many times it ran.
export const NodeCard = memo(function NodeCard({ data }: NodeProps<CardNode>) {
  const { node, run } = data;
  const ports = outputPorts(node);
  const latest = run?.executions.at(-1);
  const status = data.needsYou ? 'attention' : (run?.status ?? null);
  const inRun = run !== undefined;
  const passes = run?.executions.length ?? 0;
  const label = data.needsYou
    ? 'Needs you'
    : status
      ? statusLabels[status as keyof typeof statusLabels]
      : '';
  return (
    <div
      className={`node${inRun && !run ? ' dim' : ''}`}
      data-status={status ?? undefined}
      aria-label={`${node.id}, ${typeLabels[node.type] ?? node.type}${status ? `, ${label}` : ''}`}
    >
      {hasInput(node) && (
        <Handle type="target" position={Position.Left} id="input" isConnectable={false} />
      )}
      {status && status !== 'not_reached' && (
        <span className="node-state" data-status={status}>
          <StatusIcon status={status} />
          {label}
          {passes > 1 && <span className="node-loop">×{passes}</span>}
        </span>
      )}
      <div className="node-header">
        <span className="node-icon">
          <TypeIcon type={node.type} />
        </span>
        <span className="node-title">
          <strong>{node.id}</strong>
          <span>{typeLabels[node.type] ?? node.type}</span>
        </span>
      </div>
      <div className="node-body">
        <span className="node-summary">{summary(node)}</span>
        {ports.length > 0 && (
          <span className="node-ports">
            {ports.map((port) => (
              <span key={port} className={`node-port${latest?.port === port ? ' taken' : ''}`}>
                {port}
              </span>
            ))}
          </span>
        )}
      </div>
      {ports.map((port, index) => (
        <Handle
          key={port}
          type="source"
          id={port}
          position={Position.Right}
          isConnectable={false}
          style={{ top: portOffset(index) }}
        />
      ))}
    </div>
  );
});
