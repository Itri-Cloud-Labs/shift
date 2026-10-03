# 09. Persist human forms, approvals, and timer waits

Read [COMMON.md](COMMON.md).

Prerequisites: [08](08-failure-retry-controls.md). Roadmap: M04c.

Read server sections 4.4, 6.6-6.7, 8-11; client section 5.4. Implement Human Input, Approval, and Wait with frozen resolved forms/presentation, accepted response provenance, optional deadlines, and durable wake-up jobs. Create interaction, execution wait, event, and absence of runnable successor atomically. Store waits as IDs/deadlines, never callbacks or live requests.

Responses validate against the frozen schema and expected interaction revision. First accepted response wins; response, receipt, event, state, and wake-up commit together. Return the same response for an identical command retry, conflict for another decision, and retired status after cancellation/expiry. Local CLI actors have explicit provenance. Preserve previous envelope context and use the documented human/approval data wrapper. Defaults allow indefinite waits; configured timeout follows its declared route or fails if unhandled.

Persist timer deadlines and reconstruct due work on startup with an injected clock. Held runs may accept human responses while advancement waits; disabled workflows still resolve existing interactions. Recheck state/fence during response-timeout-cancel races.

Acceptance:

- CLI starts a branching/looping graph, waits for approval, restarts, accepts a response, and resumes exactly once.
- Duplicate/conflicting responses and response/timeout/cancel races yield one recorded result and successor.
- Frozen fields remain unchanged after draft/default edits. Timer restart and already-due timers use stored UTC deadlines.
- Waits consume no active execution budget, and a held run keeps its saved response until resume.
