#!/usr/bin/env bash
#
# Cerebro restart — restarts the application's services on the NAS VM, in
# dependency order, verifying each one before moving to the next.
#
# Touches only Cerebro's own units. It never reboots the VM and never restarts
# anything else running there.
#
#   ./restart.sh                # just cerebro-api — the usual case
#   ./restart.sh --all          # postgres → ollama → api, in that order
#   ./restart.sh --ollama       # ollama, then api (model reload)
#   ./restart.sh --postgres     # postgres, then api (asks first)
#   ./restart.sh --dry-run      # print the plan, change nothing
#   ./restart.sh --host user@vm # override the ssh target
#   ./restart.sh --api URL      # override the API base URL
#
# Needs the ssh target and the API base URL, from the environment or the flags:
#   CEREBRO_HOST=user@cerebro-vm CEREBRO_API_URL=http://100.x.y.z:8000 ./restart.sh
#
# The API is always restarted last: it holds an asyncpg pool and an HTTP client
# to Ollama, and both go stale when what they point at restarts underneath them.
#
# Exit 0 if everything came back healthy, 1 otherwise.

set -uo pipefail

HOST="${CEREBRO_HOST:-}"
API_URL="${CEREBRO_API_URL:-}"
SSH_TIMEOUT=10
HEALTH_TRIES=15          # 15 × 2s = 30s, well past the unit's RestartSec=3
HEALTH_INTERVAL=2

API_UNIT="cerebro-api.service"
OLLAMA_UNIT="ollama.service"
PG_UNIT="postgresql@18-main.service"

DO_PG=0; DO_OLLAMA=0; DRY=0; ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --all)      DO_PG=1; DO_OLLAMA=1; shift ;;
    --ollama)   DO_OLLAMA=1; shift ;;
    --postgres) DO_PG=1; shift ;;
    --dry-run)  DRY=1; shift ;;
    -y|--yes)   ASSUME_YES=1; shift ;;
    --host)     HOST="$2"; shift 2 ;;
    --api)      API_URL="$2"; shift 2 ;;
    -h|--help)  sed -n '3,23p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "optiune necunoscuta: $1" >&2; exit 2 ;;
  esac
done

[ -n "$HOST" ] || { echo "seteaza CEREBRO_HOST (ex. user@cerebro-vm) sau foloseste --host" >&2; exit 2; }
[ -n "$API_URL" ] || { echo "seteaza CEREBRO_API_URL (ex. http://100.x.y.z:8000) sau foloseste --api" >&2; exit 2; }

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; PINK=$'\033[95m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; PINK=''; RESET=''
fi

say()  { echo "  $*"; }
fail() { echo "  ${RED}$*${RESET}" >&2; }

remote() { ssh -o ConnectTimeout=$SSH_TIMEOUT -o BatchMode=yes "$HOST" "$@"; }

# systemctl is-active answers "active" for a service that is crash-looping every
# few seconds — it catches it between two restarts. The restart counter is the
# honest signal, so every check below compares it against its own baseline.
restarts_of() { remote "systemctl show $1 -p NRestarts --value" 2>/dev/null; }

wait_for_unit() {
  local unit="$1" baseline="$2" tries=$HEALTH_TRIES state now
  while [ $tries -gt 0 ]; do
    state=$(remote "systemctl is-active $unit" 2>/dev/null)
    now=$(restarts_of "$unit")
    if [ "$state" = "active" ]; then
      if [ -n "$now" ] && [ -n "$baseline" ] && [ "$now" -gt "$((baseline + 1))" ]; then
        fail "$unit reporneste in bucla (NRestarts $baseline → $now)"
        return 1
      fi
      # Two consecutive clean reads, so a service that dies a second later is
      # not mistaken for one that started.
      sleep 1
      [ "$(remote "systemctl is-active $unit" 2>/dev/null)" = "active" ] && return 0
    fi
    sleep $HEALTH_INTERVAL
    tries=$((tries - 1))
  done
  fail "$unit nu a redevenit activ in $((HEALTH_TRIES * HEALTH_INTERVAL))s"
  return 1
}

restart_unit() {
  local unit="$1" label="$2" baseline
  baseline=$(restarts_of "$unit")
  printf '  %-14s ' "$label"

  if [ $DRY -eq 1 ]; then
    echo "${DIM}(dry-run) sudo systemctl restart $unit${RESET}"
    return 0
  fi

  if ! remote "sudo -n systemctl restart $unit" 2>/dev/null; then
    echo "${RED}esuat${RESET}"
    fail "restart refuzat pentru $unit"
    return 1
  fi

  if wait_for_unit "$unit" "$baseline"; then
    echo "${GREEN}ok${RESET}"
    return 0
  fi
  echo "${RED}nu a pornit${RESET}"
  return 1
}

# The API's own liveness check, reached the way the phone reaches it — the only
# proof that matters, since the unit can be "active" while the app is broken.
wait_for_api() {
  local tries=$HEALTH_TRIES body
  printf '  %-14s ' "health"
  if [ $DRY -eq 1 ]; then echo "${DIM}(dry-run) GET $API_URL/health${RESET}"; return 0; fi
  while [ $tries -gt 0 ]; do
    body=$(curl -s -m 5 "$API_URL/health" 2>/dev/null)
    case "$body" in
      *'"status":"ok"'*'"db":true'*) echo "${GREEN}ok${RESET} ${DIM}$body${RESET}"; return 0 ;;
      *'"db":false'*) echo "${YELLOW}API sus, baza de date jos${RESET}"; return 1 ;;
    esac
    sleep $HEALTH_INTERVAL
    tries=$((tries - 1))
  done
  echo "${RED}fara raspuns${RESET}"
  fail "$API_URL/health nu raspunde dupa $((HEALTH_TRIES * HEALTH_INTERVAL))s"
  return 1
}

echo
echo "${PINK}${BOLD}  CEREBRO RESTART${RESET}${DIM} · ${HOST}${RESET}"
[ $DRY -eq 1 ] && echo "${DIM}  dry-run: nu se schimba nimic${RESET}"
echo

if ! remote true 2>/dev/null; then
  fail "VM inaccesibil prin ssh ($HOST)"
  exit 1
fi

# Restarting Postgres drops every open connection, so it is opt-in and confirmed.
if [ $DO_PG -eq 1 ] && [ $DRY -eq 0 ] && [ $ASSUME_YES -eq 0 ]; then
  echo "  ${YELLOW}Postgres va fi repornit — toate conexiunile deschise cad.${RESET}"
  printf '  continui? [y/N] '
  read -r reply
  case "$reply" in [yY]*) ;; *) echo "  anulat"; exit 0 ;; esac
  echo
fi

# Dependencies first, the API last so it reconnects to everything fresh.
STEPS_OK=1
[ $DO_PG -eq 1 ]     && { restart_unit "$PG_UNIT" "postgres" || STEPS_OK=0; }
[ $DO_OLLAMA -eq 1 ] && [ $STEPS_OK -eq 1 ] && { restart_unit "$OLLAMA_UNIT" "ollama" || STEPS_OK=0; }

if [ $STEPS_OK -eq 0 ]; then
  echo
  fail "o dependenta nu a pornit — API-ul NU a fost repornit"
  say "${DIM}investigheaza cu: ssh $HOST 'journalctl -u <unit> -n 50'${RESET}"
  echo
  exit 1
fi

restart_unit "$API_UNIT" "cerebro-api" || STEPS_OK=0
[ $STEPS_OK -eq 1 ] && { wait_for_api || STEPS_OK=0; }

echo
if [ $STEPS_OK -eq 1 ]; then
  if [ $DRY -eq 1 ]; then
    echo "  ${DIM}plan valid; ruleaza fara --dry-run ca sa-l aplici${RESET}"
  else
    echo "  ${GREEN}toate serviciile sunt sus${RESET}"
    say "${DIM}stare completa: ./scripts/status.sh${RESET}"
  fi
else
  fail "reporniea nu s-a incheiat curat"
  say "${DIM}jurnal: ssh $HOST 'journalctl -u $API_UNIT -n 50 --no-pager'${RESET}"
fi
echo

exit $(( STEPS_OK == 1 ? 0 : 1 ))
