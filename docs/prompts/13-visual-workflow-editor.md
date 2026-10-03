# 13. Author and publish graphs visually

Read [COMMON.md](COMMON.md).

Prerequisites: [12](12-connected-client.md). Roadmap: M07.

Read client sections 5.2, 6, and 9; server sections 5-6 and 8. Use React Flow for canvas interaction while preserving the domain graph as authoritative. Implement add/delete/duplicate/configure nodes, named ports, connect/reconnect, pan/zoom/fit, and a side inspector. Inspect existing history/state libraries before adding undo/redo. Presentation coordinates cannot affect routing or execution identity.

Support backward edges and convergence. Reject a second outgoing edge from one port with actionable text. Trigger nodes have no incoming execution edges and represent separate starts. Draw run snapshots read-only. Provide basic catalog-driven field controls for currently shipped nodes, graph diagnostics, explicit Save/Publish, draft revisions, conflict handling, version selection, and manual trigger/input selection.

Keep local edits separate from server revisions and published versions. Another device's save requires explicit conflict resolution. Connect nodes with automatic predecessor-envelope flow; simple sequential graphs require no mappings. Preserve unsupported catalog fields for later forms instead of erasing them.

Provide keyboard controls and a node/edge list for operations otherwise requiring drag. Use text/icons alongside color. Choose representative graph sizes, record editor interaction/render budgets, and measure them.

Acceptance:

- Author, publish, and execute a simple branch graph entirely through the UI without JSON entry.
- Valid loops/convergence save; fan-out and missing required config yield node/field/port diagnostics.
- Undo/redo preserves domain IDs and edge validity; draft conflicts retain both versions and do not overwrite automatically.
- Keyboard users can add/configure/connect/delete named nodes and ports. Live events do not change a historical graph or steal focus.
