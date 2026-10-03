# 12. Connect the desktop views to server state

Read [COMMON.md](COMMON.md).

Prerequisites: [10](10-server-remote-protocol.md), [11](11-client-connection-runtime.md). Roadmap: M06.

Read client sections 4-5 and 7-9. Implement connect/pair onboarding and project/workflow/run/session navigation, attention inbox, settings, and stateful offline/revoked/incompatible presentation. Session/report views consume fixtures until their server capabilities exist and clearly report unavailable capabilities. Replace development fixtures with real services wherever implemented.

Project setup accepts server repository paths and surfaces canonical validation. Add project/profile/default/permission forms, workflow list/publication/version inspection, Pause, and run controls supported by the server. Historical run views use their frozen version. Distinguish runs, executions, attempts, waits, holds, cancellation intent, and session observations.

Render frozen human forms and revisions with one mutation ID per submission. Pending acknowledgement shows receipt checking; another device's accepted response replaces a stale form. Retired requests become read-only, and held runs display deferred advancement. Attention is a server projection, not local notification state.

Render reports/artifacts through scoped authenticated operations when available, using raw-HTML-disabled Markdown and sanitized links. Secret settings remain write-only. Cache updates respect connection generations and revisions. Mutations require a live synchronized connection; offline views show last-updated data without an offline write queue.

Acceptance:

- Two clients pair, navigate the same resources, and race an approval without overwriting the accepted response.
- Disconnect immediately after submission and reconnect to the confirmed server decision; no duplicate mutation is created.
- Old run/version inspection survives publication of a replacement. Pause wording accurately describes existing runs.
- Malicious report/link content cannot gain renderer privileges. Closing the app leaves a waiting/running server workflow intact.
