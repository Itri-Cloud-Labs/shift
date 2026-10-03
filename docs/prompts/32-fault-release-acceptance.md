# 32. Verify end-to-end durability and prepare release evidence

Read [COMMON.md](COMMON.md).

Prerequisites: [23](23-checks-merge.md), [24](24-github-event-triggers.md), [26](26-generic-webhooks.md), [29](29-backup-restore.md), [30](30-optional-hostname.md), [31](31-desktop-distribution.md), plus every applicable acceptance case in this pack. Roadmap: M15.

Read server section 16 and client section 9 in full. Audit the progress record against both specs. Complete missing cases instead of treating passing unit tests as release acceptance. Create a coverage matrix with scenario, automated/demo evidence, exact environment/version, result, and unresolved prerequisite.

Run subprocess crash matrices at intent/submission/result/transition boundaries for harness, commands/HTTP, Git/PR/merge, human forms, triggers, and resource claims. Include lost SSE/replay/snapshot races, slow streams/proxies, stale queries/revisions, duplicate commands/deliveries, revoked devices, cancellation/hold/abort races, missing sessions, restored epoch, disk-full readiness, schema limits, and unsupported versions/capabilities. Unknown external outcomes must remain visibly uncertain rather than create duplicate effects.

Demonstrate visual maintenance flow with explicit approval, implementation, independent review/fix loop, checks, PR, and author-configured merge in an authorized disposable project. Restart at human wait and during invocation; observe recovery or honest reconciliation. Also demonstrate an unrelated general graph, such as webhook -> HTTP -> Condition -> Human Input -> Command -> Agent report, without maintenance-specific engine logic. All normal authoring uses forms/pickers.

Verify packaged client closure/reconnect, historical graph/session/report inspection, manual intervention, cross-device approval, accessible keyboard authoring, representative graph/history performance, platform storage, Linux installation, backups, and hostname fixture/direct access. Real GitHub/provider/DNS/signing checks require actual prerequisites.

Acceptance:

- Every required scenario has reproducible passing evidence or an explicitly unresolved prerequisite; release readiness is false while required checks remain missing.
- Operational/recovery instructions explain retention, uncertainty repair, upgrades, backups, and first-run prerequisites accurately.
- Produce `docs/release-readiness.md` with candidate artifacts and remaining blockers. Prepare reviewable release inputs; actual publication/deployment requires the owner's separate instruction.
