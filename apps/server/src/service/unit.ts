import { ShiftError } from '../domain/errors.js';
import type { ServicePaths } from './paths.js';

export const managedMarker = '# Managed by `shift service install`';

// Paths are written into the unit unquoted, so only characters systemd reads literally are used.
function plainPath(path: string, what: string): string {
  if (!/^\/[A-Za-z0-9._/@+-]+$/.test(path))
    throw new ShiftError(
      'INVALID_CONFIGURATION',
      `The ${what} path ${JSON.stringify(path)} has characters a systemd unit cannot hold. Use letters, digits and ._/@+- only.`,
      422,
    );
  return path;
}

// The service runs the `current` link, so an upgrade switches the link and restarts without
// rewriting this file. The server stops its own agent and command scopes on SIGTERM; with
// KillMode=mixed, SIGKILL reaches anything left only after TimeoutStopSec, which exceeds the
// longest shutdown deadline the server accepts (30 seconds).
export function renderUnit(paths: ServicePaths): string {
  const executable = plainPath(`${paths.current}/bin/shift`, 'program');
  const environment = plainPath(paths.environmentFile, 'settings');
  return `${managedMarker}, which replaces it. Put settings in ${environment}.
[Unit]
Description=Shift workflow server
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=exec
ExecStart=${executable} serve
EnvironmentFile=${environment}
UMask=0077
Restart=on-failure
RestartSec=5
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=60

[Install]
WantedBy=default.target
`;
}

function setting(name: string, value: string): string {
  if (/[\n\r\0]/.test(value))
    throw new ShiftError('INVALID_CONFIGURATION', `${name} cannot contain line breaks.`, 422);
  return `${name}=${value}`;
}

// Written once, when the service is first installed; later installs never replace it. PATH is the
// installing shell's, because a systemd user service otherwise gets a minimal PATH without the
// owner's OpenCode, git or tools.
export function renderEnvironment(input: { path: string; stateDirectory: string }): string {
  return `# Shift server settings, read by the systemd service. After a change: shift service restart
# This file is private to your account (mode 0600). Commands and agents run with this PATH,
# copied from the shell that installed the service.
${setting('PATH', input.path)}
${setting('SHIFT_STATE_DIR', input.stateDirectory)}
SHIFT_HOST=127.0.0.1
SHIFT_PORT=4317
# SHIFT_PUBLIC=1 allows a non-loopback SHIFT_HOST. Prefer an HTTPS reverse proxy on loopback.
# SHIFT_OPENCODE_MODEL=provider/model
# Provider keys your OpenCode install reads from its environment belong here too; the service
# does not see variables exported by your login shell.
`;
}
