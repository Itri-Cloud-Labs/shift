import type { Interaction } from '../protocol/generated/types.js';

// Which attention items are new since the last look, for OS notifications. What counts is the
// server's projection; what was already open at the first look is not announced.

export interface Announcement {
  id: string;
  body: string;
}

export function announcements(
  known: Set<string> | null,
  interactions: Interaction[],
  runs: { id: string; state: string }[],
): { known: Set<string>; fresh: Announcement[] } {
  const open: Announcement[] = [
    ...interactions
      .filter((item) => item.state === 'PENDING')
      .map((item) => ({ id: item.id, body: item.title })),
    ...runs
      .filter((run) => run.state === 'NEEDS_HUMAN')
      .map((run) => ({ id: run.id, body: 'A run needs your decision' })),
  ];
  return {
    known: new Set([...(known ?? []), ...open.map((item) => item.id)]),
    fresh: known ? open.filter((item) => !known.has(item.id)) : [],
  };
}
