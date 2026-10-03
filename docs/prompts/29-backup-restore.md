# 29. Back up and restore the complete durable server state

Read [COMMON.md](COMMON.md).

Prerequisites: [28](28-linux-operation.md). Roadmap: M14a. Can run with 30 and 31.

Read server sections 10-11.3 and 16; client sections 4.3 and 9. Implement CLI backup/restore with consistent SQLite backup API or controlled shutdown, referenced artifact bytes, harness session storage, workspace/repository recovery requirements, and protected encryption key material. Inspect maintained archive/backup tools and document exact consistency guarantees. A live .db copy alone is insufficient under WAL.

Coordinate external-state capture so a backup does not imply a recoverable conversation/workspace that its files cannot restore. Include format/schema/adapter/runtime versions, hashes, permissions, and validation manifest. Secrets/keys require protected access and stay outside logs. Preserve retained workspace/session mappings or identify a blocker when external repos/paths are unavailable.

Restore only offline into an explicitly selected target with collision/overwrite checks. Preserve stable server identity, rotate event epoch, verify DB/artifact/session/key consistency, and reconcile before admission. A restored past cursor forces clients to resnapshot; accepted responses never reopen simply because clients reconnect. Document external effects performed after backup that may require reconciliation against current reality.

Acceptance:

- Back up an indefinite human wait with previous accepted decisions, retained session/reports, and credentials; restore and inspect unchanged history.
- Missing/corrupt artifacts, keys, session storage, or incompatible versions fail clearly before admission.
- Old client epoch/cursors trigger a consistent fresh snapshot and no lost/duplicated approval.
- Test backups under WAL and interrupted backup creation; incomplete archives cannot be mistaken for complete ones. No destructive restore of the active installation is required for the demo.
