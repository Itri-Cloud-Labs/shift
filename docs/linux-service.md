# Running Shift on a Linux server

Shift's server runs as a systemd **user** service of your own Linux account, so agents use your OpenCode install, git identity and repositories. Nothing is installed as root, and you run one command with `sudo` yourself. The desktop app connects to it over HTTPS. This guide covers installing, connecting, operating and upgrading it.

## Before you start

- **Linux, x86_64 or aarch64, with glibc 2.35 or newer.** Ubuntu 22.04 and later, Debian 12 and later, and Fedora 36 and later qualify. Alpine and other musl distributions do not.
- **systemd with a user manager.** Log in over ssh or at the console, not through `su`, so `systemctl --user` works.
- **The account that owns your repositories.** Do not install as root: the installer refuses unless you pass `--allow-root`, and agents would then run with full control of the machine.
- **OpenCode 2.x (2.0.26 or later)** installed and signed in for that account. Shift runs your own install and never changes its configuration or credentials.
- **git** with a commit identity (`git config --global user.name` and `user.email`).
- **For GitHub steps and triggers, your own GitHub App**, registered once with `shift github register`. See [GitHub nodes](workflows.md#github-nodes).
- **For other devices, an HTTPS reverse proxy and a hostname.** See [Reach it from other devices](#reach-it-from-other-devices).

## Install

Get `shift-VERSION-linux-ARCH.tar.gz`, `SHA256SUMS` and `install.sh` for your architecture from a source you trust. The installer checks the archive against `SHA256SUMS`, so the checksum file is only as trustworthy as where you got it. Alpha releases are not signed yet.

```sh
bash install.sh --archive shift-VERSION-linux-x64.tar.gz      # SHA256SUMS beside it
shift service install --start
sudo loginctl enable-linger "$USER"                            # once, as an administrator
shift doctor
```

The installer refuses, without changing anything, an archive whose checksum does not match or is missing from `SHA256SUMS`. It also refuses an archive for another architecture, one that needs a newer glibc, or one whose bundled runtime cannot load SQLite on this machine. Each release carries its own Node runtime, so the system's Node does not matter.

`shift service install --start` writes the systemd unit and, the first time, the settings file. It then starts the service and, if no device is paired, prints a pairing phrase. Lingering keeps the service running after you log out and starts it at boot. Without it the service stops with your last session.

| Path                                    | What it holds                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `~/.local/share/shift/versions/VERSION` | The installed releases. `current` links to the one in use; `previous` to the one before. |
| `~/.local/bin/shift`                    | Links to `current/bin/shift`. Add `~/.local/bin` to your PATH.                           |
| `~/.config/shift/server.env`            | The service's settings (mode 0600). Created once; Shift never rewrites it.               |
| `~/.config/systemd/user/shift.service`  | The unit. `shift service install` replaces it; edit the settings file instead.           |
| `~/.local/state/shift/`                 | The database, master key (`secrets/master.key`), workspaces and artifacts (mode 0700).   |

`XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_STATE_HOME` move these when they are set.

## Settings

`~/.config/shift/server.env` is read by the service, and by `shift` commands to find the state directory. After a change, run `shift service restart`.

| Setting                     | Meaning                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATH`                      | Where commands and agents find OpenCode, git and your tools. It is copied from the shell that installed the service, because a user service otherwise gets a minimal PATH. |
| `SHIFT_STATE_DIR`           | The state directory.                                                                                                                                                       |
| `SHIFT_HOST`, `SHIFT_PORT`  | The listener. Keep `127.0.0.1` and put a proxy in front.                                                                                                                   |
| `SHIFT_PUBLIC=1`            | Allows a non-loopback `SHIFT_HOST`. Only behind TLS: device tokens would otherwise cross the network in clear text.                                                        |
| `SHIFT_OPENCODE_MODEL`      | The default model, `provider/model`.                                                                                                                                       |
| `SHIFT_OPENCODE_EXECUTABLE` | OpenCode, when it is not on `PATH`.                                                                                                                                        |

The service does not see variables your login shell exports. If OpenCode reads a provider key from its environment, add that variable here. The file is private to your account, and `shift doctor` never prints its values.

## Pair the desktop app

The first start prints an eight-word phrase that works once, for ten minutes. `shift device pair` prints another. In the desktop app, enter the server's HTTPS address and the phrase. The phrase is shown only in the terminal that started the service and never written to the journal.

## Reach it from other devices

The server listens on `127.0.0.1:4317`. To reach it from elsewhere, put an HTTPS reverse proxy in front of it on the same machine. Shift does not provide TLS, and devices refuse plain HTTP except on loopback.

Requirements for the proxy:

- **Pass `Authorization` through unchanged.** Devices authenticate with bearer tokens.
- **Do not buffer `/api/v0/events`.** It is a server-sent event stream. Shift sends `X-Accel-Buffering: no` and a keepalive comment every 15 seconds.
- **Allow long-lived requests.** The idle timeout must exceed the 15-second keepalive; an hour is comfortable.
- **Allow request bodies up to 2 MiB.** GitHub deliveries can be that large.
- **Expose the whole `/api/v0/` path.** GitHub deliveries (`/api/v0/github/apps/ID/webhook`) and webhook triggers (`/api/v0/triggers/ID/events`) arrive there, authenticated by their signatures or secrets. The administrative socket is never exposed: it is a Unix socket under the state directory.

Use a certificate from a public authority, such as Let's Encrypt. The desktop app trusts the same public authorities as Node.js, not a private or self-signed one, so `tls internal` or a home-made CA will not pair. Caddy obtains and renews a public certificate by itself for a hostname that resolves to the machine:

```caddyfile
shift.example.com {
	reverse_proxy 127.0.0.1:4317 {
		flush_interval -1
	}
}
```

nginx, with a certificate you manage:

```nginx
server {
    listen 443 ssl;
    server_name shift.example.com;
    ssl_certificate     /etc/letsencrypt/live/shift.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shift.example.com/privkey.pem;
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:4317;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```

Check it from another machine: `curl https://shift.example.com/api/v0/info` answers with the server's ID. A device then pairs with `https://shift.example.com`.

## Operate it

```sh
shift                     # service, readiness, address, paired devices, lingering
shift doctor              # checks the installation; changes nothing, prints no secrets
shift service logs [-f]   # the journal
shift service restart
shift service stop
```

The desktop app's **Settings → Server** shows the same version, readiness, how the server runs and its free storage, and lists these commands. It never runs them.

**Stopping.** A stop admits no new work and stops running agent turns and commands within the shutdown deadline (5 seconds by default, `SHIFT_SHUTDOWN_TIMEOUT_MS`, at most 30). It records that it stopped them. When the service starts again, an interrupted agent turn continues in the same conversation. An interrupted command or other effect waits for you (`NEEDS_HUMAN`), saying the shutdown stopped it, because part of it may have happened. `shift run retry`, `complete` or `fail` decides.

**Crashes.** systemd restarts a server that exits unexpectedly. Recovery works the same as after a stop, except it cannot know what a crash interrupted, and it says so.

**Storage failure.** When the disk fills or storage fails, the server stops accepting changes and reports not ready (`PERSISTENCE_UNAVAILABLE`). Every change is refused with a retryable error, so nothing is confirmed that was not stored. It submits no new external effect. Reads keep working. It stays that way until a restart, even after space returns: free space or fix the disk, then `shift service restart`. `shift doctor` warns below 2 GB free.

## Upgrade

Upgrades happen only when you run them:

```sh
shift upgrade shift-NEW-linux-x64.tar.gz        # SHA256SUMS beside it
```

The current release's installer verifies the archive as on install. The new release then checks the database without changing it, and refuses a database another build migrated. It also pauses the running server's dispatch and counts the steps running, in one request. If any step is running, the upgrade is refused and dispatch resumes: wait, hold the run, or pass `--allow-active` to stop them as a service stop would. Otherwise the installer stops the service, switches `current`, starts it and waits until it is ready.

The previous release stays in `versions/`, with the `previous` link. Going back works only while the new version has not migrated the database:

```sh
ln -sfn "$(readlink ~/.local/share/shift/previous)" ~/.local/share/shift/current
systemctl --user restart shift.service
```

Reinstalling the version in use is refused; install another version first.

## Uninstall

`shift service uninstall` stops and removes the service. Your state, settings and releases stay. Delete `~/.local/state/shift`, `~/.config/shift` and `~/.local/share/shift` to remove them, but note the state directory holds your workflows, run history and the master key that encrypts stored credentials.

## Diagnostics and secrets

- `shift doctor` and `shift` print paths, versions and states, never setting values, keys, tokens or phrases.
- The journal holds structured events and error codes. Command and agent output stays in the database, not the journal.
- Before sharing a log, still look it over: a workflow's own commands can print anything.
- Back up `~/.local/state/shift/secrets/master.key` with the database: credentials stored in Shift cannot be decrypted without it. Anyone who can read it, or who runs code as your account, can read those credentials. Shift does not isolate agents from your account.
