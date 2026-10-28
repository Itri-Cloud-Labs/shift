import {
  Ban,
  Bot,
  Braces,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Flag,
  GitBranch,
  LoaderCircle,
  Play,
  ShieldCheck,
  Split,
  TextCursorInput,
  Timer,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { statusLabels, type NodeStatus, type RunState } from './graph.js';

export const typeIcons: Record<string, LucideIcon> = {
  manual_trigger: Play,
  transform: Braces,
  agent: Bot,
  condition: Split,
  switch: GitBranch,
  wait: Timer,
  human_input: TextCursorInput,
  approval: ShieldCheck,
  end: Flag,
};

export function TypeIcon({ type }: { type: string }) {
  const Icon = typeIcons[type] ?? Waypoints;
  return <Icon aria-hidden="true" />;
}

// Every state has its own shape as well as its color, so it reads without color.
const statusIcons: Record<NodeStatus | 'attention', LucideIcon> = {
  not_reached: CircleDashed,
  pending: Clock,
  running: LoaderCircle,
  waiting: Clock,
  attention: CircleAlert,
  completed: CircleCheck,
  failed: CircleX,
  cancelled: Ban,
};

export type StatusTone = NodeStatus | 'attention';

export function StatusIcon({ status }: { status: StatusTone }) {
  const Icon = statusIcons[status];
  return <Icon aria-hidden="true" className={status === 'running' ? 'spin' : undefined} />;
}

export function StatusLabel({ status, label }: { status: StatusTone; label?: string }) {
  return (
    <span className="status" data-status={status}>
      <StatusIcon status={status} />
      {label ?? (status === 'attention' ? 'Needs you' : statusLabels[status])}
    </span>
  );
}

export function runTone(state: RunState): StatusTone {
  switch (state) {
    case 'QUEUED':
      return 'pending';
    case 'RUNNING':
    case 'CANCEL_REQUESTED':
      return 'running';
    case 'WAITING':
    case 'HELD':
      return 'waiting';
    case 'NEEDS_HUMAN':
      return 'attention';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    case 'COMPLETED':
      return 'completed';
  }
}
