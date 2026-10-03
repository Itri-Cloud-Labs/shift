# 27. Finish intervention, histories, inspection, and attention

Read [COMMON.md](COMMON.md).

Prerequisites: [12](12-connected-client.md), [14](14-rich-node-forms.md), [19](19-harness-recovery.md), [21](21-git-actions.md). Roadmap: M13.

Read server sections 6.4-6.7, 7, 11, 13; client sections 5-9. Implement server hold/finish-or-accounted-abort/manual-message/resume services and connected UI. Hold persists before manual intent; composer enables only after resource ownership is granted. Manual entries never directly commit graph output. Resume returns to the original node contract with attempt/continuation accounting. Standalone continuation claims the retained workspace/session; archived ephemeral sessions remain read-only. Disconnect leaves the explicit hold intact.

Finish paginated execution/attempt/invocation/session/event histories and provenance selectors for loop passes. Present queues, limits, uncertain effects, evidence-based repairs, and immutable report/artifact histories. Implement capped read-only workspace file/diff/status endpoints with canonical path/symlink containment and scoped downloads. Distinguish live inspection from recorded artifacts and handle binary/large data safely.

Implement Advanced whole-node config parse/validate/preview/Apply. Identity/position/edges stay editor-owned; invalid config leaves current node intact. Supported Advanced-only fields survive later ordinary form edits. Publishing is separate.

Finish server-projected durable attention and main-owned desktop notifications with resource deep links, preferences, dedup, and disconnected recovery. Delivery success/failure never resolves a request.

Acceptance:

- Race hold/abort/manual/resume with active work, approval, cancellation, and disconnect; no session has two owners or unaccounted delayed abort.
- Reopen Electron after every client closes and inspect continuing runs, retained holds, and outstanding attention.
- Traversal/symlink/malicious Markdown/link tests preserve boundaries; historical reports remain selectable.
- Advanced config round-trips without hidden graph changes. Notification failures do not remove durable inbox items.
