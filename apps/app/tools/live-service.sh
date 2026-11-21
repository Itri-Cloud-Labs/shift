#!/usr/bin/env bash
# Runs the packaged desktop app against the Linux server installed as this account's service, behind
# Caddy with its own certificate authority, with a GNOME keyring holding the device key: the setup
# docs/linux-service.md describes. For disposable machines only (CI, containers): it installs the
# server service into this account and leaves its data.
#
#   live-service.sh SERVER_RELEASE_DIRECTORY   (holding shift-*-linux-x64.tar.gz and SHA256SUMS)
#
# Needs: the live test build of the app (SHIFT_BUILD_LIVE_SMOKE=1 pnpm --filter @shift/app
# package:dir) in apps/app/release/linux-unpacked, Xvfb, dbus-run-session,
# gnome-keyring, curl and a systemd user manager.
set -euo pipefail
release=$(readlink -f -- "${1:?give the server release directory}")
app=$(dirname -- "$(readlink -f -- "$0")")/..
work=$(mktemp -d)
caddy_pid=''
cleanup() {
  [ -n "$caddy_pid" ] && kill "$caddy_pid" 2>/dev/null
  "$HOME/.local/bin/shift" service uninstall >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

archive=$(ls "$release"/shift-*-linux-x64.tar.gz)
version=${archive##*/shift-}
version=${version%-linux-x64.tar.gz}
# A rerun on the same machine finds this release already current; the installer refuses to replace it.
if [ "$(readlink "${XDG_DATA_HOME:-$HOME/.local/share}/shift/current" 2>/dev/null)" != "versions/$version" ]; then
  bash "$release/install.sh" --archive "$archive"
fi
shift_bin=$HOME/.local/bin/shift
node=$HOME/.local/share/shift/current/node/bin/node
"$shift_bin" service install --start >/dev/null

# Caddy, pinned and checked against its published SHA-512.
caddy_version=2.11.8
sha512=c863699eee84c6b410573de2ec67af81d07eb054f9020bb98f3c6cb256fea4be2fd1acfbd39110c649c3338282593bba3d3ed6424d91b7f5675e8b877a8999e9
curl -fsSL -o "$work/caddy.tar.gz" \
  "https://github.com/caddyserver/caddy/releases/download/v$caddy_version/caddy_${caddy_version}_linux_amd64.tar.gz"
echo "$sha512  $work/caddy.tar.gz" | sha512sum -c - >/dev/null
tar -xzf "$work/caddy.tar.gz" -C "$work" caddy
cat >"$work/Caddyfile" <<'EOF'
{
	skip_install_trust
	admin off
	# No HTTP-to-HTTPS redirect on port 80, which an unprivileged account cannot bind.
	auto_https disable_redirects
}
https://127.0.0.1:8443 {
	tls internal
	reverse_proxy 127.0.0.1:4317 {
		flush_interval -1
	}
}
EOF
XDG_DATA_HOME="$work/caddy-data" XDG_CONFIG_HOME="$work/caddy-config" \
  "$work/caddy" run --config "$work/Caddyfile" --adapter caddyfile >"$work/caddy.log" 2>&1 &
caddy_pid=$!
ca=$work/caddy-data/caddy/pki/authorities/local/root.crt
for _ in $(seq 1 60); do
  [ -f "$ca" ] && curl -fsS --cacert "$ca" https://127.0.0.1:8443/api/v0/info >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS --cacert "$ca" https://127.0.0.1:8443/api/v0/info >/dev/null || {
  cat "$work/caddy.log" >&2
  exit 1
}

# A session bus with an unlocked keyring, as a desktop login provides.
# shellcheck disable=SC2016 # expanded by the inner shell, from its arguments
dbus-run-session -- bash -c '
  # A throwaway password creates and unlocks the login keyring without a prompt.
  printf "shift-smoke" | gnome-keyring-daemon --unlock --components=secrets >/dev/null
  xvfb-run -a "$0" "$1/tools/live-smoke.mjs" --shift "$2" --url https://127.0.0.1:8443 --ca "$3" --persistent
' "$node" "$app" "$shift_bin" "$ca"
