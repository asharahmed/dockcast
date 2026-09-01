#!/usr/bin/env bash
# Nightly trainer wrapper (docs/infra.md §3.4): runs `python -m dockcast_ml "$@"` and turns an
# OOM kill from a lost night into a retry with more memory.
#
#  * exit 137 with a new `oom_kill` event in this cgroup -> raise this container's own memory
#    limit by TRAIN_MEM_STEP (never above TRAIN_MEM_MAX) through the Docker Engine API on the
#    mounted docker socket (`POST /containers/<self>/update`) and run the trainer again. The
#    trainer is idempotent per local date, so a re-run is safe.
#  * the raised limit is persisted to TRAIN_MEM_STATE_FILE (on the workercache volume) and
#    re-applied at the start of every run, so it survives `compose up -d` recreating the
#    container with the compose-file `mem_limit`.
#  * after a successful run, if the peak *anonymous* memory (sampled from memory.stat every 2 s;
#    page cache is reclaimable and does not cause OOM kills) was >= TRAIN_MEM_HEADROOM_PCT of the
#    limit, the limit is raised now so the next night has headroom instead of an OOM kill.
#
# Needs cgroup v2 (`/sys/fs/cgroup/memory.max`), the docker socket mounted and readable by this
# user (compose `group_add`), and curl. Without them it degrades to a plain run and says so.
set -u

log() { printf '%s [train-with-retry] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

to_bytes() {  # 6g | 2048m | 512k | 1073741824 -> bytes
  local v n unit
  v=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  n=${v%%[bkmg]*}; unit=${v#"$n"}
  case "$unit" in
    ""|b) echo "$n" ;;
    k|kb) echo $((n * 1024)) ;;
    m|mb) echo $((n * 1024 * 1024)) ;;
    g|gb) echo $((n * 1024 * 1024 * 1024)) ;;
    *) log "bad size '$1'"; return 1 ;;
  esac
}
mib() { echo $(( $1 / 1048576 )); }

CG=${CGROUP_DIR:-/sys/fs/cgroup}
SOCK=${DOCKER_SOCK:-/var/run/docker.sock}
CID=${CONTAINER_ID:-$(hostname)}          # compose sets the hostname to the container id
STEP=$(to_bytes "${TRAIN_MEM_STEP:-2g}") || exit 2
MAX=$(to_bytes "${TRAIN_MEM_MAX:-8g}") || exit 2
HEADROOM_PCT=${TRAIN_MEM_HEADROOM_PCT:-80}
STATE_FILE=${TRAIN_MEM_STATE_FILE:-/data/cache/train_mem_limit}
MAX_ATTEMPTS=${TRAIN_MAX_ATTEMPTS:-6}
TRAIN_CMD=${TRAIN_CMD:-python -m dockcast_ml}

current_limit() { [ -r "$CG/memory.max" ] && cat "$CG/memory.max"; }   # bytes | "max" | ""
peak_bytes()    { [ -r "$CG/memory.peak" ] && cat "$CG/memory.peak"; }  # lifetime peak incl. page cache
anon_bytes()    { [ -r "$CG/memory.stat" ] && awk '$1=="anon"{print $2}' "$CG/memory.stat"; }
oom_kills()     { [ -r "$CG/memory.events" ] && awk '$1=="oom_kill"{print $2}' "$CG/memory.events"; }

sample_anon_peak() {  # sample_anon_peak <file>: keep the running max of `anon` in <file> until killed
  local f=$1 max=0 a
  while :; do
    a=$(anon_bytes); if [ -n "$a" ] && [ "$a" -gt "$max" ]; then max=$a; echo "$max" > "$f"; fi
    sleep 2
  done
}

set_limit() {  # set_limit <bytes>: POST /containers/<self>/update. 0 on HTTP 200.
  local bytes=$1 code body
  [ -S "$SOCK" ] || { log "no docker socket at $SOCK; cannot change the limit"; return 1; }
  body=$(mktemp)
  code=$(curl -s -o "$body" -w '%{http_code}' --unix-socket "$SOCK" -X POST \
    -H 'Content-Type: application/json' \
    -d "{\"Memory\":$bytes,\"MemorySwap\":$((bytes * 2))}" \
    "http://localhost/containers/$CID/update")
  if [ "$code" != "200" ]; then
    log "docker update failed (http $code): $(tr -d '\n' < "$body")"; rm -f "$body"; return 1
  fi
  rm -f "$body"
  log "memory limit set to $(mib "$bytes") MiB (memory.max now $(current_limit))"
}

persist_limit() {
  mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null
  echo "$1" > "$STATE_FILE" 2>/dev/null || log "could not persist the limit to $STATE_FILE"
}

raise_limit() {  # raise_limit <reason>: current + STEP, capped at MAX. Returns 1 if it cannot.
  local cur new
  cur=$(current_limit)
  case "$cur" in ""|max) log "limit is '${cur:-unknown}'; cannot raise it ($1)"; return 1 ;; esac
  if [ "$cur" -ge "$MAX" ]; then
    log "limit $(mib "$cur") MiB is already at TRAIN_MEM_MAX $(mib "$MAX") MiB; not raising ($1)"; return 1
  fi
  new=$((cur + STEP)); [ "$new" -gt "$MAX" ] && new=$MAX
  log "raising memory limit $(mib "$cur") -> $(mib "$new") MiB ($1)"
  set_limit "$new" && persist_limit "$new"
}

# --- re-apply a limit persisted by an earlier escalation (survives container recreation) ---
if [ -r "$STATE_FILE" ]; then
  want=$(cat "$STATE_FILE" 2>/dev/null); cur=$(current_limit)
  if [ -n "$want" ] && [ "$want" -gt 0 ] 2>/dev/null && [ -n "$cur" ] && [ "$cur" != "max" ] && [ "$want" -gt "$cur" ]; then
    log "re-applying persisted limit $(mib "$want") MiB (container started with $(mib "$cur") MiB)"
    set_limit "$want" || true
  fi
fi

attempt=1
while :; do
  before=$(oom_kills); limit=$(current_limit)
  log "attempt $attempt/$MAX_ATTEMPTS: $TRAIN_CMD $* (memory.max=${limit:-unknown})"
  anonf=$(mktemp); sample_anon_peak "$anonf" & sampler=$!
  $TRAIN_CMD "$@"; rc=$?
  { kill "$sampler"; wait "$sampler"; } 2>/dev/null
  a=$(anon_bytes); anon_peak=$(cat "$anonf" 2>/dev/null || echo 0); rm -f "$anonf"
  if [ -n "$a" ] && [ "$a" -gt "${anon_peak:-0}" ]; then anon_peak=$a; fi
  after=$(oom_kills); peak=$(peak_bytes)
  if [ "$rc" -eq 0 ]; then
    if [ -n "$limit" ] && [ "$limit" != "max" ] && [ "${anon_peak:-0}" -gt 0 ]; then
      pct=$((anon_peak * 100 / limit))
      log "ok: peak anon $(mib "$anon_peak") MiB = ${pct}% of the $(mib "$limit") MiB limit (cgroup peak incl. cache $(mib "${peak:-0}") MiB)"
      if [ "$pct" -ge "$HEADROOM_PCT" ]; then
        raise_limit "peak anon ${pct}% >= ${HEADROOM_PCT}% headroom threshold" || true
      fi
    else
      log "ok (cgroup peak incl. cache $(mib "${peak:-0}") MiB, limit ${limit:-unknown})"
    fi
    exit 0
  fi
  oom=0
  if [ "$rc" -eq 137 ]; then
    if [ -n "$before" ] && [ -n "$after" ]; then [ "$after" -gt "$before" ] && oom=1; else oom=1; fi
  fi
  if [ "$oom" -ne 1 ]; then log "exit $rc (not an OOM kill); giving up"; exit "$rc"; fi
  log "OOM-killed (exit 137, oom_kill events ${before:-?} -> ${after:-?}, cgroup peak $(mib "${peak:-0}") MiB)"
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then log "giving up after $attempt attempts"; exit 137; fi
  raise_limit "after OOM kill" || { log "cannot raise the limit; giving up"; exit 137; }
  attempt=$((attempt + 1))
done
