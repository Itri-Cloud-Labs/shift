-- GitHub App integration (server specification sections 4.4, 10 and 12.3). The owner registers
-- their own App once; its private key and webhook secret are sealed to the App row and never leave
-- it. Installations are what GitHub reports for the App. A connection binds one project to one
-- repository by its numeric ID, through an installation; names are display metadata.
CREATE TABLE github_apps (
  id TEXT PRIMARY KEY NOT NULL,
  app_id INTEGER NOT NULL CHECK (app_id > 0),
  github_host TEXT NOT NULL,
  slug TEXT,
  name TEXT,
  private_key_sealed TEXT NOT NULL,
  webhook_secret_sealed TEXT,
  verified_at INTEGER,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX github_app_identity ON github_apps(github_host, app_id);
--> statement-breakpoint
CREATE TABLE github_installations (
  id TEXT PRIMARY KEY NOT NULL,
  github_app_id TEXT NOT NULL REFERENCES github_apps(id),
  installation_id INTEGER NOT NULL CHECK (installation_id > 0),
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL,
  repositories_json TEXT NOT NULL CHECK (json_valid(repositories_json)),
  permissions_json TEXT NOT NULL CHECK (json_valid(permissions_json)),
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'SUSPENDED', 'REMOVED')),
  verified_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX github_installation_identity ON github_installations(github_app_id, installation_id);
--> statement-breakpoint
CREATE TABLE github_connections (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  installation_id TEXT NOT NULL REFERENCES github_installations(id),
  repository_id INTEGER NOT NULL CHECK (repository_id > 0),
  repository_owner TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  verified_at INTEGER,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  removed_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX github_project_connection ON github_connections(project_id) WHERE removed_at IS NULL;
--> statement-breakpoint
CREATE INDEX github_installation_connections ON github_connections(installation_id);
--> statement-breakpoint
CREATE INDEX github_app_installations ON github_installations(github_app_id);
