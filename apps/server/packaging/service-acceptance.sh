#!/usr/bin/env bash
# Installs a Shift release as this account's systemd user service and drives it through pairing,
# a run, a stop and a crash during that run, an upgrade and removal. Run it only on a disposable
# machine or account: it installs into this account's home and leaves the server's data there.
#
#   service-acceptance.sh DIRECTORY   (holding shift-*-linux-ARCH.tar.gz, SHA256SUMS, install.sh)
set -euo pipefail
dir=$(readlink -f -- "${1:?give the directory with the release archive}")
case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) exit 1 ;; esac
archive=$(ls "$dir"/shift-*-linux-$arch.tar.gz)
[ "$(printf '%s\n' "$archive" | wc -l)" = 1 ] || { echo "expected one archive in $dir" >&2; exit 1; }
data=${XDG_DATA_HOME:-$HOME/.local/share}/shift
state=${XDG_STATE_HOME:-$HOME/.local/state}/shift
shift_bin=$HOME/.local/bin/shift
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
step() { printf '\n== %s\n' "$*"; }
fail() {
  printf 'FAIL: %s\n' "$*" >&2
  journalctl --user --unit shift.service --no-pager --lines 60 >&2 || true
  exit 1
}
mode() { stat -c %a -- "$1"; }
# The release's own Node, so the machine needs none.
json() { "$data/current/node/bin/node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval("v"+process.argv[1])))})' "$1"; }

step 'A tampered archive is refused before anything is installed'
cp "$archive" "$work/"
cp "$dir/SHA256SUMS" "$work/"
printf 'x' >>"$work/$(basename "$archive")"
if bash "$dir/install.sh" --archive "$work/$(basename "$archive")" 2>"$work/err"; then
  fail 'a tampered archive installed'
fi
grep -q 'does not match its SHA-256' "$work/err" || fail "unexpected refusal: $(cat "$work/err")"
[ ! -e "$data/current" ] || fail 'a refused archive changed the installation'

step 'An archive for another architecture is refused'
other=x64
[ "$arch" = x64 ] && other=arm64
renamed=$work/$(basename "$archive" | sed "s/linux-$arch/linux-$other/")
cp "$archive" "$renamed"
(cd "$work" && sha256sum "$(basename "$renamed")" >SHA256SUMS)
if bash "$dir/install.sh" --archive "$renamed" 2>"$work/err"; then fail 'a foreign archive installed'; fi
grep -q "is for $other" "$work/err" || fail "unexpected refusal: $(cat "$work/err")"

step 'Install'
bash "$dir/install.sh" --archive "$archive"
[ -L "$shift_bin" ] || fail 'no shift link'
"$shift_bin" version
"$shift_bin" status || true

step 'Install and start the service; the first start shows a pairing phrase'
"$shift_bin" service install --start | tee "$work/start.txt"
phrase=$(grep -E '^    [a-z]+( [a-z]+){7}$' "$work/start.txt" | sed 's/^ *//')
[ -n "$phrase" ] || fail 'no pairing phrase on first start'
journalctl --user --unit shift.service --no-pager | grep -qF "$phrase" && fail 'the phrase reached the log'

step 'Private files'
[ "$(mode "$state")" = 700 ] || fail "state directory mode $(mode "$state")"
[ "$(mode "$state/secrets/master.key")" = 600 ] || fail 'master key mode'
[ "$(mode "$state/admin.sock")" = 600 ] || fail 'socket mode'
[ "$(mode "$HOME/.config/shift/server.env")" = 600 ] || fail 'settings mode'

step 'Doctor prints no secrets'
printf 'SHIFT_ACCEPTANCE_SECRET=acceptance-secret-value\n' >>"$HOME/.config/shift/server.env"
"$shift_bin" doctor | tee "$work/doctor.txt" || true
"$shift_bin" doctor --json >"$work/doctor.json" || true
mapfile -t keys < <(grep -oE '[A-Za-z0-9+/=_-]{32,}' "$state/secrets/master.key")
for secret in acceptance-secret-value "$phrase" "${keys[@]}"; do
  grep -qF -- "$secret" "$work/doctor.txt" "$work/doctor.json" && fail 'doctor printed a secret'
done
for id in platform runtime state disk service server git; do
  status=$(json ".checks.find(c=>c.id==='$id').status" <"$work/doctor.json")
  [ "$status" != fail ] || fail "doctor check $id failed"
done

step 'Pair over HTTP'
body=$("$data/current/node/bin/node" -e 'process.stdout.write(JSON.stringify({phrase:process.argv[1],deviceName:"acceptance",commandId:crypto.randomUUID()}))' "$phrase")
token=$(curl -fsS -H 'content-type: application/json' -d "$body" http://127.0.0.1:4317/api/v0/pair | json .token)
curl -fsS -H "authorization: Bearer $token" http://127.0.0.1:4317/api/v0/devices >/dev/null || fail 'the paired token was refused'

step 'A run survives a service stop and a crash'
repo=$work/repo
git init -q -b main "$repo"
git -C "$repo" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init
project=$("$shift_bin" project add --path "$repo" --name acceptance | json .id)
marker=$work/marker
cat >"$work/workflow.json" <<EOF
{"nodes":[{"id":"start","type":"manual_trigger"},
 {"id":"work","type":"command","config":{"mode":"shell","script":"echo started >> $marker; sleep 120"}},
 {"id":"end","type":"end"}],
 "connections":[{"id":"c1","fromNodeId":"start","fromPort":"success","toNodeId":"work","toPort":"input"},
 {"id":"c2","fromNodeId":"work","fromPort":"success","toNodeId":"end","toPort":"input"}]}
EOF
workflow=$("$shift_bin" workflow create --project "$project" --name acceptance --file "$work/workflow.json" | json .id)
"$shift_bin" workflow publish "$workflow" >/dev/null
run=$("$shift_bin" run start --workflow "$workflow" | json .id)
for _ in $(seq 1 60); do [ -s "$marker" ] && break; sleep 0.5; done
[ -s "$marker" ] || fail 'the command never started'
"$shift_bin" service stop
"$shift_bin" service start >/dev/null
for _ in $(seq 1 60); do
  state_after=$("$shift_bin" run show "$run" | json .state)
  [ "$state_after" != RUNNING ] && break
  sleep 1
done
[ "$state_after" = NEEDS_HUMAN ] || fail "after a stop the run is $state_after"
"$shift_bin" run show "$run" | json .attention.explanation | grep -q 'server was shut down' ||
  fail 'recovery does not say the shutdown stopped the step'
printf 'after a stop: %s\n' "$state_after"
run=$("$shift_bin" run start --workflow "$workflow" --allow-overlap | json .id)
lines=$(wc -l <"$marker")
for _ in $(seq 1 60); do [ "$(wc -l <"$marker")" -gt "$lines" ] && break; sleep 0.5; done
pid=$(systemctl --user show shift.service --property=MainPID --value)
kill -KILL "$pid"
for _ in $(seq 1 60); do
  new=$(systemctl --user show shift.service --property=MainPID --value)
  [ "$new" != 0 ] && [ "$new" != "$pid" ] && "$shift_bin" health >/dev/null 2>&1 && break
  sleep 1
done
[ "$new" != "$pid" ] || fail 'systemd did not restart the crashed server'
for _ in $(seq 1 60); do
  crashed=$("$shift_bin" run show "$run" | json .state)
  [ "$crashed" != RUNNING ] && break
  sleep 1
done
[ "$crashed" = NEEDS_HUMAN ] || fail "after a crash the run is $crashed"
printf 'after a crash: %s\n' "$crashed"

step 'Upgrade'
new_version=$("$shift_bin" version --json | json .version).1
release=$(basename "$archive" .tar.gz)
next=shift-$new_version-linux-$arch
mkdir "$work/next"
tar -xzf "$archive" -C "$work/next"
mv "$work/next/$release" "$work/next/$next"
"$data/current/node/bin/node" -e 'const f=process.argv[1],m=require(f);m.version=process.argv[2];require("fs").writeFileSync(f,JSON.stringify(m))' "$work/next/$next/MANIFEST.json" "$new_version"
tar -czf "$work/$next.tar.gz" -C "$work/next" "$next"
(cd "$work" && sha256sum "$next.tar.gz" >SHA256SUMS)
held=$("$shift_bin" run start --workflow "$workflow" --allow-overlap | json .id)
lines=$(wc -l <"$marker")
for _ in $(seq 1 60); do [ "$(wc -l <"$marker")" -gt "$lines" ] && break; sleep 0.5; done
if "$shift_bin" upgrade "$work/$next.tar.gz" 2>"$work/err"; then fail 'upgraded during a running step'; fi
"$shift_bin" version --json | grep -q "\"$new_version\"" && fail 'a refused upgrade switched versions'
"$shift_bin" run cancel "$held" --wait >/dev/null
"$shift_bin" upgrade "$work/$next.tar.gz"
[ "$("$shift_bin" version --json | json .version)" = "$new_version" ] || fail 'the upgrade did not switch'
[ "$(readlink "$data/current")" = "versions/$new_version" ] || fail 'current link'

step 'Uninstall keeps data'
"$shift_bin" service uninstall
[ ! -e "$HOME/.config/systemd/user/shift.service" ] || fail 'the unit is still there'
[ -f "$state/shift.db" ] || fail 'data was removed'
printf '\nService acceptance passed on linux-%s\n' "$arch"
