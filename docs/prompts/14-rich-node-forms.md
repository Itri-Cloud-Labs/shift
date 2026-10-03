# 14. Add reference pickers, schema builders, and draft recovery

Read [COMMON.md](COMMON.md).

Prerequisites: [13](13-visual-workflow-editor.md). Roadmap: M07a.

Read client sections 4.2, 6, and 9; server sections 5, 6.3-6.5, and 8. Evaluate maintained schema form/validation components before extending forms. Implement normal authoring widgets for nested objects/arrays, scalar types, enum/required/description, retry/limits, typed comparisons and AND/OR groups, ordered Switch cases, human forms, manual inputs, run variables, and prompts.

Build result/input-schema editors within supported server limits. Reference pickers cover current input, trigger, frozen project defaults, variables, earlier successful node results, and typed session/artifact/workspace metadata. Show producing sequence/revision where known, explicitly optional missing-value fallbacks, and unavailable type information. Prompt reference tokens serialize unambiguously rather than relying on prose substitution.

Expose catalog-supported agent profiles/model/harness, session strategy/lifetime, handoff selection, report toggles, and schema controls with capability diagnostics. Use fixtures for not-yet-installed agent capabilities; the app must not advertise them as runnable. Ephemeral choices must meet server constraints.

Add bounded local draft recovery keyed to server/resource identity, marked unsaved and compared with server revision on recovery. Ordinary form edits preserve supported advanced-only portions. Save/Publish remain explicit.

Acceptance:

- Author a finite variable loop and nested human form without JSON entry, then run/resolve them against the server.
- Schema/reference round-trips preserve types, fallbacks, resource references, and unsupported-but-valid portions.
- Crash/reopen restores an unsaved draft without publishing or overwriting another device's save.
- Depth/size/schema/capability errors match server diagnostics. Unknown fields remain visible as advanced-only rather than disappearing.
