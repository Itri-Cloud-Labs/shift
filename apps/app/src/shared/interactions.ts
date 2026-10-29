import { validateInteractionList } from '../protocol/generated/validators.js';

// The interactions main sends the renderer come from the synchronized projection, not from one
// server answer, so they carry no envelope. Each is checked as the server's own list would be.
export function validInteractions(value: unknown): boolean {
  const interactions = (value as { interactions?: unknown } | null)?.interactions;
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).length === 1 &&
    validateInteractionList({
      schemaVersion: 1,
      requestId: '00000000-0000-4000-8000-000000000000',
      interactions,
    })
  );
}
