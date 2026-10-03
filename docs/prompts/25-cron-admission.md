# 25. Schedule cron and interval occurrences durably

Read [COMMON.md](COMMON.md).

Prerequisites: [09](09-human-timer-waits.md), [10](10-server-remote-protocol.md). Roadmap: M12. Can run with 15-24 if trigger/admission ownership is coordinated. Client controls also require 14.

Read server sections 10-12.2 and client sections 5.1 and 6.2. Reuse a maintained parser/matcher selected through current-source review, with an explicit compatibility wrapper for Shift's policy. Support five-field cron, named IANA timezone, second-zero normalization, and UTC-duration intervals. Preview uses the same actual parser/policy as execution.

Persist next cursor/previous UTC instant and unique trigger/instant occurrence identity. Skip nonexistent spring-forward wall times; run repeated fall-back wall time once at its first UTC instant. Prove the wrapper's behavior rather than relying on parser defaults.

On downtime, default to latest eligible missed occurrence with skipped interval/count recorded. Support configured skip and bounded replay up to the specified cap. Pause discards scheduled starts during the disabled interval; unpause starts from current time. Commit enablement and schedule cursor together. Reuse shared workflow-scoped skip/queue/allow admission with captured input/version. Occurrences queued before Pause stay queued; admitted runs recover normally.

Add schedule/timezone/preview/overlap/misfire controls, occurrence history, and status. Settings never compute independent client schedule semantics.

Acceptance:

- Injected-clock tests cover normal dates, spring/fall DST, UTC intervals, downtime, replay overflow, disabled intervals, and publication changes.
- Scheduler crashes at occurrence/admission boundaries cannot create duplicate runs.
- Queued occurrences preserve their captured version and obey enablement before admission.
- UI preview matches server-produced UTC instants and policy, with no raw JSON needed.
