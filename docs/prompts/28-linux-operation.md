# 28. Install and administer the headless Linux service

Read [COMMON.md](COMMON.md).

Prerequisites: [23](23-checks-merge.md), [24](24-github-event-triggers.md), [26](26-generic-webhooks.md), [27](27-intervention-inspection.md). Roadmap: M14.

Read server sections 11.3, 13.1, 14-16; client sections 5.1 and 8. Build the Bash installer, matched Node/native runtime distribution for glibc Linux x64/arm64, local CLI administration, systemd service files, and doctor checks. Evaluate existing packaging/install utilities before creating custom machinery. Verify release integrity and architecture/runtime compatibility. Install into explicit/XDG paths under a defined service account without modifying registered repos.

Local administration uses the protected Unix socket and same application services. Implement service install/start/stop/status, first-start pairing, readiness/identity/address output, and authenticated remote-access guidance. The default command prints service/enrollment status rather than opening a web app. Harness credentials and repository access belong to the service environment and are checked explicitly.

Graceful shutdown stops admission, records active work, and attempts accounted cleanup within a bounded window. Restart follows recovery rather than replay. Disk-full/unavailable persistence fails readiness and stops new effect submission before acknowledging decisions. Upgrades remain operator-controlled with migration/adapter compatibility checks.

Document HTTPS/reverse-proxy setup, SSE buffering/idle requirements, management listener binding, file permissions, external prerequisites, and diagnostic redaction. Client settings show service/diagnostic status and CLI guidance without silently administering/upgrading the server.

Acceptance:

- Clean disposable Linux environments install/start/authenticate a headless service without Electron, on supported architectures where runners exist.
- Installer integrity/architecture failures stop safely. Socket/master-key/state permissions and nonsecret doctor output are verified.
- systemd shutdown/restart during work preserves recorded accounting and resumes/reconciles correctly.
- Inject storage failure and prove no uncommitted approval is acknowledged or new external effect submitted.
