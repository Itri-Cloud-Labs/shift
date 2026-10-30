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
    // Only what is open now: a run that resumes and stops again needs the owner again.
    known: new Set(open.map((item) => item.id)),
    fresh: known ? open.filter((item) => !known.has(item.id)) : [],
  };
}

// Follows one profile's projection at a time. Another server's first look is a first look too:
// what is open there is not new.
export function announcer() {
  let known: Set<string> | null = null;
  let owner: string | null = null;
  return (
    profileId: string | null,
    projection: { interactions: Interaction[]; runs: { id: string; state: string }[] } | null,
  ): Announcement[] => {
    if (!projection || profileId !== owner) known = null;
    owner = profileId;
    if (!projection) return [];
    const result = announcements(known, projection.interactions, projection.runs);
    known = result.known;
    return result.fresh;
  };
}
