# 18. Complete Agent nodes with validated data and reports

Read [COMMON.md](COMMON.md).

Prerequisites: [17](17-opencode-supervision.md). Roadmap: M09a. Client form integration requires 14.

Read server sections 5, 6.4-6.5, 8-9 and client sections 5.3-5.6 and 6.2. Implement AgentService and registered Agent executor. Construct unattended goal/context from frozen input, profile/node configuration, selected handoff bytes/readable files, and session policy. A reused conversation still receives the current goal/input explicitly.

Wrap the author's business-data schema in Shift's completed/blocked/failed terminal union. Validate independently of the harness. Only completed data enters output.data; AgentService constructs Shift references/context. Generic Agent cannot select graph ports. Valid business review results such as changes_requested remain successful data for downstream Condition/Switch.

Collect invocation-specific `tothenextagent.md` and `toahumanreader.md` according to configured requirements. Verify paths/size/existence, ingest immutable artifacts, and choose reports from the successful terminal invocation. Keep earlier correction/manual artifacts in history. Required unsupported tool policy fails before submission; repository read-only enforcement can allow report-directory writes only when supported.

Implement bounded contract corrections as invocations inside one attempt, defaulting to the specified two corrections. Missing/invalid successful reports/data is incomplete; correction exhaustion fails. Preserve an agent's original blocker when reports are missing and route known blockers through explicit error paths without invisible harness approval waits.

Acceptance:

- A real Agent node returns schema-valid business data, immutable reports, and a handoff consumed by a subsequent agent.
- Blocked/failed terminals need no fabricated success fields; invalid results get bounded corrections without new executions.
- Report toggles/handoff exclusions work for an independent reviewer. No nonexistent artifact reference is emitted.
- Session idle and provider success without valid contract cannot complete the node; UI shows terminal status separately from business decisions.
