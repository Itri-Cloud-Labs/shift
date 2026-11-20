#!/usr/bin/env bash
# Installs or upgrades the Shift server for this account, without root.
#
#   install.sh --archive shift-VERSION-linux-ARCH.tar.gz [--sums SHA256SUMS]
#   install.sh --url BASE_URL --version VERSION      download both over HTTPS first
#   install.sh ... --upgrade [--allow-active]        replace the version a running service uses
#
# Nothing changes until the archive matches SHA256SUMS, fits this machine and runs on its own
# bundled runtime. Releases go to ${XDG_DATA_HOME:-~/.local/share}/shift/versions/VERSION, the
# active one is the `current` link there, and ~/.local/bin/shift points at it. Repositories, the
# server's state and your OpenCode configuration are never touched.
set -euo pipefail
umask 077

fail() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}
say() { printf '%s\n' "$*"; }

archive=''
sums=''
url=''
version=''
upgrade=0
allow_active=0
allow_root=0
while [ $# -gt 0 ]; do
  case "$1" in
    --archive) archive=${2:?--archive needs a file}; shift 2 ;;
    --sums) sums=${2:?--sums needs a file}; shift 2 ;;
    --url) url=${2:?--url needs a base URL}; shift 2 ;;
    --version) version=${2:?--version needs a version}; shift 2 ;;
    --upgrade) upgrade=1; shift ;;
    --allow-active) allow_active=1; shift ;;
    --allow-root) allow_root=1; shift ;;
    -h | --help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "unknown option $1" ;;
  esac
done

# The service runs agents as this account, with its credentials; root would give them everything.
if [ "$(id -u)" = 0 ] && [ "$allow_root" = 0 ]; then
  fail 'run as the account that owns your repositories and OpenCode setup, not root (or pass --allow-root)'
fi
[ "$(uname -s)" = Linux ] || fail 'Shift runs on Linux only'
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "unsupported architecture $(uname -m); releases exist for x86_64 and aarch64" ;;
esac
glibc=$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}') || true
[ -n "$glibc" ] || fail 'this system does not use glibc; Shift releases need glibc Linux'
for tool in tar gzip sha256sum readlink mktemp; do
  command -v "$tool" >/dev/null || fail "$tool is required"
done

data=${XDG_DATA_HOME:-$HOME/.local/share}/shift
bin_dir=$HOME/.local/bin
case "$data$bin_dir" in /*) ;; *) fail 'HOME and XDG_DATA_HOME must be absolute paths' ;; esac
mkdir -p "$data/versions" "$bin_dir"
work=$(mktemp -d "$data/.install.XXXXXX")
trap 'rm -rf "$work"' EXIT

if [ -n "$url" ]; then
  [ -n "$version" ] || fail '--url needs --version'
  [ -z "$archive" ] || fail 'use either --archive or --url'
  case "$url" in https://*) ;; *) fail '--url must use https' ;; esac
  command -v curl >/dev/null || fail 'curl is required for --url'
  archive=$work/shift-$version-linux-$arch.tar.gz
  sums=$work/SHA256SUMS
  curl --proto '=https' --tlsv1.2 -fsSL -o "$archive" "$url/shift-$version-linux-$arch.tar.gz"
  curl --proto '=https' --tlsv1.2 -fsSL -o "$sums" "$url/SHA256SUMS"
fi
[ -n "$archive" ] || fail 'give --archive FILE or --url BASE_URL --version VERSION'
[ -f "$archive" ] || fail "$archive does not exist"
[ -n "$sums" ] || sums=$(dirname -- "$archive")/SHA256SUMS
[ -f "$sums" ] || fail "no checksum file at $sums; pass --sums"

name=$(basename -- "$archive")
case "$name" in
  shift-*-linux-x64.tar.gz | shift-*-linux-arm64.tar.gz) ;;
  *) fail "$name is not a Shift release archive" ;;
esac
release=${name%.tar.gz}
archive_arch=${release##*-linux-}
[ "$archive_arch" = "$arch" ] || fail "$name is for $archive_arch, but this machine is $arch"
release_version=${release#shift-}
release_version=${release_version%-linux-*}
[ -z "$version" ] || [ "$version" = "$release_version" ] || fail "$name is not version $version"
version=$release_version
case "$version" in *[!0-9A-Za-z.-]* | '' | .* | *..*) fail "invalid version $version" ;; esac

expected=$(awk -v file="$name" '$2 == file || $2 == "*" file {print $1}' "$sums")
[ -n "$expected" ] || fail "$sums has no checksum for $name"
[ "$(printf '%s\n' "$expected" | wc -l)" = 1 ] || fail "$sums lists $name more than once"
actual=$(sha256sum -- "$archive" | awk '{print $1}')
[ "$actual" = "$expected" ] || fail "$name does not match its SHA-256 in $sums; it was not installed"
say "Verified $name"

tar -xzf "$archive" -C "$work" --no-same-owner
staged=$work/$release
if [ ! -d "$staged" ] || [ ! -f "$staged/MANIFEST.json" ]; then fail "$name does not contain $release/"; fi
manifest() { "$staged/node/bin/node" -e 'const m=require(process.argv[1]); process.stdout.write(String(m[process.argv[2]]))' "$staged/MANIFEST.json" "$1"; }
[ "$(manifest version)" = "$version" ] || fail 'the archive manifest names another version'
[ "$(manifest arch)" = "$arch" ] || fail 'the archive manifest names another architecture'
minimum=$(manifest minimumGlibc)
if [ "$(printf '%s\n%s\n' "$minimum" "$glibc" | sort -V | head -n1)" != "$minimum" ]; then
  fail "glibc $glibc is older than the $minimum this release needs"
fi
# Loads the bundled Node and its native SQLite binding, which proves both run on this machine.
"$staged/bin/shift" version --json >/dev/null || fail 'the release does not run on this machine'

previous=''
[ -L "$data/current" ] && previous=$(readlink -- "$data/current")
target=$data/versions/$version
service_active=0
if command -v systemctl >/dev/null && systemctl --user is-active --quiet shift.service 2>/dev/null; then
  service_active=1
fi
if [ "$service_active" = 1 ] && [ "$previous" != "versions/$version" ]; then
  [ "$upgrade" = 1 ] || fail "the Shift service is running $(basename -- "${previous:-unknown}"); pass --upgrade to replace it"
  checks=()
  [ "$allow_active" = 1 ] && checks+=(--allow-active)
  # The new release checks the current database and the running server before anything moves.
  "$staged/bin/shift" upgrade-check ${checks[@]+"${checks[@]}"} >"$work/check.json" || {
    cat "$work/check.json" >&2
    fail 'the upgrade check refused; nothing was changed'
  }
fi

if [ -e "$target" ]; then
  if [ "$previous" = "versions/$version" ] && [ "$service_active" = 1 ]; then
    fail "$version is already installed and running"
  fi
  # Same version again: replace the files only when it is not the running one.
  rm -rf "$target.replaced"
  mv -- "$target" "$target.replaced"
fi
mv -- "$staged" "$target"
rm -rf "$target.replaced"

link_bin() {
  local link=$bin_dir/shift
  if [ -e "$link" ] || [ -L "$link" ]; then
    [ -L "$link" ] && [ "$(readlink -- "$link")" = "$data/current/bin/shift" ] && return 0
    say "Left $link alone: it is not Shift's link. Add $data/current/bin to your PATH instead."
    return 0
  fi
  ln -s -- "$data/current/bin/shift" "$link"
}

switch_to() {
  ln -sfn -- "$1" "$data/.current.tmp"
  mv -Tf -- "$data/.current.tmp" "$data/current"
}

if [ "$service_active" = 1 ] && [ "$previous" != "versions/$version" ]; then
  say "Stopping the service on ${previous#versions/}"
  systemctl --user stop shift.service
  switch_to "versions/$version"
  [ -n "$previous" ] && ln -sfn -- "$previous" "$data/previous"
  link_bin
  if ! "$data/current/bin/shift" service start; then
    say "Shift $version did not become ready. To go back, if no database migration ran:"
    say "  ln -sfn $previous $data/current && systemctl --user restart shift.service"
    exit 1
  fi
  say "Upgraded to Shift $version"
  exit 0
fi

switch_to "versions/$version"
[ -n "$previous" ] && [ "$previous" != "versions/$version" ] && ln -sfn -- "$previous" "$data/previous"
link_bin
say "Installed Shift $version in $target"
case ":$PATH:" in *":$bin_dir:"*) ;; *) say "Add $bin_dir to your PATH to run shift." ;; esac
if command -v systemctl >/dev/null && systemctl --user cat shift.service >/dev/null 2>&1; then
  say 'The service will use this version when it next starts: shift service restart'
else
  say 'Next: shift service install --start   (then shift doctor)'
fi
