// Node positions are editor data in the workflow document; execution ignores them. Moving nodes
// rewrites only `position` on the latest draft, so every other field the server returned is
// sent back unchanged.

export interface NodePosition {
  nodeId: string;
  x: number;
  y: number;
}

export function withPositions(draft: unknown, positions: NodePosition[]): Record<string, unknown> {
  const document = { ...(draft as Record<string, unknown>) };
  const byId = new Map(positions.map((item) => [item.nodeId, item]));
  if (!Array.isArray(document['nodes'])) return document;
  document['nodes'] = document['nodes'].map((node: unknown) => {
    const record = node as Record<string, unknown> | null;
    const moved = record && typeof record['id'] === 'string' ? byId.get(record['id']) : undefined;
    // Whole pixels keep the document small and stable.
    return moved
      ? { ...record, position: { x: Math.round(moved.x), y: Math.round(moved.y) } }
      : node;
  });
  return document;
}
