# 22. Configure GitHub Apps and pull request actions

Read [COMMON.md](COMMON.md).

Prerequisites: [21](21-git-actions.md). Roadmap: M11. Client onboarding/forms also require 12 and 14.

Read server sections 4.4, 8, 10-13 and client sections 5.1 and 6.2. Use maintained GitHub App authentication/API libraries after current official-doc review. Register the owner's custom App once, encrypt private key/webhook secret, verify installation/repository identities and permissions, and bind projects to repository IDs. App-scoped webhook URL is shared across project bindings. Use installation authentication and short-lived token refresh rather than user OAuth or GitHub CLI as the product contract.

Implement status/capability validation and encrypted rotation. Secret input responses return configured/missing status only. Nodes declare minimum permissions; unused actions do not demand unrelated permissions. Start/execution fail clearly for unverified/missing connections.

Add Get/Create/Update PR nodes with structured repository/branch/PR/commit IDs. PR creation has a stable operation marker plus repository/branch evidence for reconciliation. Multiple ambiguous matches require human resolution. Provide Git Push's temporary App HTTPS credential helper without secret URLs/remotes/logs. Generic HTTP nodes receive no implicit integration credential access.

Implement client onboarding/project binding, permission diagnostics, rotation, and normal node fields. Use fake APIs by default; real disposable-repo checks require authorized credentials.

Acceptance:

- Fake App/token/API fixtures verify expiry/refresh, shared registration, identity/permission checks, rotation, and secret omission.
- PR create/update recovery distinguishes known completion, safe retry, and ambiguous matches.
- App-backed push leaves no token in remote config/logs/snapshots.
- Onboarding and PR authoring require no raw JSON. Missing real App evidence is reported as a release prerequisite, not a passed integration check.
