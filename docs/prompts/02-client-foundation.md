# 02. Build the Electron client foundation

Read [COMMON.md](COMMON.md).

Prerequisites: [00](00-preflight.md). Roadmap: client half of M01. Can run with 01.

Read client sections 1-3, 7-9; server section 15. Build the React/Vite/TypeScript Electron app with internal main, preload, client-core, and client-ui boundaries. Use the protocol consumption strategy selected in 00. Establish runtime-validated narrow IPC and injected transport/credential interfaces so client-core tests run without Electron.

Serve bundled UI through a controlled custom scheme. Enable context isolation, sandboxing, CSP, and web security; disable renderer Node integration. Validate IPC sender/frame, discriminants, allowlisted operations, and payload limits. Reject unexpected navigation/window creation and validate external-link schemes. Renderer code must receive no bearer secrets or arbitrary filesystem/network bridge.

Create a usable disconnected shell for Projects, Workflows, Runs, Sessions, Attention, and Settings. Use deterministic catalog/state fixtures, with visible fixture status during development. The shell must never start a local server/harness. Keep native SQLite and backend implementation out of the app bundle. Inspect existing UI/dependency options before building reusable components; apply the repository's frontend design guidance.

Configure build and packaged smoke jobs for Windows, macOS, and Linux with runner availability explicit. Coordinate root lockfile/scripts/CI edits with 01. Signing remains a later release prerequisite.

Acceptance:

- The app opens its disconnected shell without starting a server or agent process.
- Boundary tests reject invalid IPC/navigation, credentials are absent from renderer payloads, and bundle checks exclude backend/native modules.
- Client-core can run against an injected fake transport independently of Electron.
- Local build/typecheck/smoke checks pass; platform CI jobs are configured and unavailable runner results are reported honestly.
