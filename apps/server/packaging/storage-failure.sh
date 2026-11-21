#!/usr/bin/env bash
# Fills the disk under a running server and checks that it acknowledges nothing it did not store
# and submits no new effect (specification 11.3). DIRECTORY must be an empty directory, owned by
# this account, on a small file system of its own (CI mounts a 64 MiB tmpfs), because it is filled.
#
#   storage-failure.sh DIRECTORY
set -euo pipefail
small=$(readlink -f -- "${1:?give an empty directory on a small file system}")
# `shift` alone is the shell builtin; the executable needs its path.
shift_bin=${SHIFT:-$(type -P shift)}
[ -n "$shift_bin" ] || { echo "shift is not on PATH" >&2; exit 1; }
state=$small/state
work=$(mktemp -d)
port=4319
server=''
cleanup() {
  [ -n "$server" ] && kill "$server" 2>/dev/null && wait "$server" 2>/dev/null
  rm -rf "$work" "$small/filler"* "$state"
}
trap cleanup EXIT
fail() {
  printf 'FAIL: %s\n' "$*" >&2
  tail -n 40 "$work/server.log" >&2 || true
  exit 1
}
node_bin=$(dirname "$(readlink -f "$(command -v "$shift_bin")")")/../node/bin/node
[ -x "$node_bin" ] || node_bin=node
json() { "$node_bin" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval("v"+process.argv[1])))})' "$1"; }
shift_() { "$shift_bin" "$@" --state-dir "$state"; }
serve() {
  "$shift_bin" serve --state-dir "$state" --port "$port" >>"$work/server.log" 2>&1 &
  server=$!
  for _ in $(seq 1 60); do "$shift_bin" ready --state-dir "$state" >/dev/null 2>&1 && return; sleep 0.5; done
  fail 'the server did not start'
}

serve
repo=$work/repo
git init -q -b main "$repo"
git -C "$repo" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init
project=$(shift_ project add --path "$repo" --name storage | json .id)
marker=$work/effect
cat >"$work/workflow.json" <<EOF
{"nodes":[{"id":"start","type":"manual_trigger"},
 {"id":"review","type":"approval","config":{"title":"Go?"}},
 {"id":"act","type":"command","config":{"mode":"shell","script":"echo done >> $marker"}},
 {"id":"end","type":"end"}],
 "connections":[{"id":"c1","fromNodeId":"start","fromPort":"success","toNodeId":"review","toPort":"input"},
 {"id":"c2","fromNodeId":"review","fromPort":"approved","toNodeId":"act","toPort":"input"},
 {"id":"c3","fromNodeId":"act","fromPort":"success","toNodeId":"end","toPort":"input"}]}
EOF
workflow=$(shift_ workflow create --project "$project" --name storage --file "$work/workflow.json" | json .id)
shift_ workflow publish "$workflow" >/dev/null
run=$(shift_ run start --workflow "$workflow" | json .id)
for _ in $(seq 1 60); do
  interaction=$(shift_ interaction list | json '.find(i=>i.runId==="'"$run"'")?.id ?? ""')
  [ -n "$interaction" ] && break
  sleep 0.5
done
[ -n "$interaction" ] || fail 'the approval never opened'

# Fill the file system: large blocks first, then small ones for what is left.
dd if=/dev/zero of="$small/filler" bs=1M status=none 2>/dev/null || true
for index in $(seq 1 4096); do
  head -c 4096 /dev/zero >"$small/filler.$index" 2>/dev/null || break
done
[ "$(df --output=avail -B1 "$small" | tail -n1 | tr -d ' ')" -lt 65536 ] || fail 'the disk is not full'

if shift_ interaction respond "$interaction" --decision approved >"$work/respond.out" 2>&1; then
  printf 'The approval was acknowledged while the disk was full; it must have been stored.\n'
  acknowledged=1
else
  grep -q PERSISTENCE_UNAVAILABLE "$work/respond.out" || fail "unexpected refusal: $(cat "$work/respond.out")"
  acknowledged=0
  "$shift_bin" ready --state-dir "$state" >"$work/ready.json" 2>/dev/null && fail 'the server still reports ready'
  grep -q PERSISTENCE_UNAVAILABLE "$work/ready.json" || fail "readiness: $(cat "$work/ready.json")"
  # Nothing else is accepted either, even after space is freed, until a restart.
  rm -f "$small/filler"*
  shift_ run start --workflow "$workflow" --allow-overlap >"$work/start.out" 2>&1 && fail 'a run started after storage failed'
  grep -q PERSISTENCE_UNAVAILABLE "$work/start.out" || fail "unexpected: $(cat "$work/start.out")"
fi
sleep 2
[ ! -e "$marker" ] || [ "$acknowledged" = 1 ] || fail 'the effect ran after an unacknowledged approval'
rm -f "$small/filler"*

"$shift_bin" stop --state-dir "$state" >/dev/null
wait "$server" || true
server=''
serve
if [ "$acknowledged" = 0 ]; then
  [ "$(shift_ interaction show "$interaction" | json .state)" = PENDING ] || fail 'the refused approval was recorded'
  shift_ interaction respond "$interaction" --decision approved >/dev/null
fi
[ "$(shift_ run show "$run" --wait | json .state)" = COMPLETED ] || fail 'the run did not complete'
[ "$(wc -l <"$marker")" = 1 ] || fail "the effect ran $(wc -l <"$marker") times"
printf 'Storage failure check passed (approval %s while full)\n' \
  "$([ "$acknowledged" = 1 ] && echo stored || echo refused)"
