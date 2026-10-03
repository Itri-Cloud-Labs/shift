# 31. Package and verify desktop clients on supported platforms

Read [COMMON.md](COMMON.md).

Prerequisites: [27](27-intervention-inspection.md), [28](28-linux-operation.md). Roadmap: M14c. Can run with 29 and 30; include their settings/status when integrated.

Read client sections 8-9 and server sections 14-16. Pin an actively maintained Electron release verified against the approved platform baseline and current security requirements. Use maintained packaging/signing tooling on matching Windows/macOS/Linux CI runners. Produce the approved architecture formats, Linux packages/AppImage as selected, integrity metadata, and installation instructions.

Set up Windows signing and macOS signing/notarization through protected CI inputs. Missing identities/runners are explicit release prerequisites; an unsigned development artifact is not a completed signed distribution. Inspect packaged contents for accidental server/native SQLite/executor modules, secrets, development endpoints, or loose navigation policy.

Smoke actual packaged apps against a Linux service for pairing, secure credential persistence, reconnect, report sanitization, graph authoring, notifications, and run continuation after quit. Verify macOS/Windows storage and Linux secure-service/session-only behavior. Include accessibility/font/zoom/reduced-motion checks. Use product-native browser automation where available and Electron-specific tooling only where required.

Implement explicit download/install update notifications. Compatibility negotiation is independent of matching release numbers. Unsupported mutations are disabled with actionable text; unknown events resnapshot. Desktop replacement never updates the server/harness or interrupts runs.

Acceptance:

- Packaged smoke evidence exists for each supported OS family, with tested architecture coverage recorded.
- Signed Windows and notarized macOS artifacts verify when credentials are available; missing release checks remain partial.
- Credential/bundle/security checks hold in production builds, and clients pair/reconnect with the installed Linux service.
- Manual client update and incompatible-protocol behavior leave server execution intact. Prepare artifacts without public publication.
