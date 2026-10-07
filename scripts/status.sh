#!/usr/bin/env bash
#
# Cerebro status — one screen answering "is everything still up, and when do I
# have to touch it next?".
#
# Runs from the Mac. Everything about the VM goes over ssh; everything about the
# phone build is read out of the last .app Xcode produced. Read-only throughout:
# no writes, no restarts, nothing installed.
#
#   ./status.sh                 # full report
#   ./status.sh --brief         # one line, for a prompt or a cron
#   ./status.sh --host user@vm  # override the ssh target
#   ./status.sh --api URL       # override the API base URL
#
# Needs the ssh target and the API base URL, from the environment or the flags:
#   CEREBRO_HOST=user@cerebro-vm CEREBRO_API_URL=http://100.x.y.z:8000 ./status.sh
#
# Exit code is 0 when everything checks out, 1 when something needs attention —
# so it can gate other scripts.

set -uo pipefail

HOST="${CEREBRO_HOST:-}"
API_URL="${CEREBRO_API_URL:-}"
BRIEF=0
SSH_TIMEOUT=10

# The phone build: whichever Release .app Xcode last wrote. Derived rather than
# hardcoded, because the DerivedData directory name changes if the project is
# ever re-cloned.
APP_GLOB="$HOME/Library/Developer/Xcode/DerivedData/Cerebro-*/Build/Products/Release-iphoneos/Cerebro.app"

while [ $# -gt 0 ]; do
  case "$1" in
    --brief) BRIEF=1; shift ;;
    --host) HOST="$2"; shift 2 ;;
    --api) API_URL="$2"; shift 2 ;;
    -h|--help) sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

PROBLEMS=0
note_problem() { PROBLEMS=$((PROBLEMS + 1)); }

# ── the VM ───────────────────────────────────────────────────────────────────
# One ssh round trip for everything: a handshake per metric would make the
# script slower than the thing it is reporting on.
REMOTE=$(ssh -o ConnectTimeout=$SSH_TIMEOUT -o BatchMode=yes "$HOST" '
  echo "BOOT<<$(uptime -s)"
  echo "UPPRETTY<<$(uptime -p)"
  echo "DISK<<$(df -h / | awk "NR==2 {print \$3\" din \"\$2\" (\"\$5\")\"}")"
  echo "LOAD<<$(cut -d" " -f1-3 /proc/loadavg)"
  systemctl show cerebro-api -p ActiveState -p SubState -p NRestarts -p ActiveEnterTimestamp \
    | sed "s/^/SVC_/;s/=/<</"
  echo "OLLAMA<<$(systemctl is-active ollama 2>/dev/null)"
  echo "PG<<$(systemctl is-active postgresql 2>/dev/null)"
  sudo -u postgres psql -d cerebro -tAF"|" -c \
    "select u.name,
            count(n.uuid) filter (where n.deleted_at is null),
            count(n.uuid) filter (where n.deleted_at is not null),
            count(n.uuid) filter (where n.done and n.deleted_at is null),
            count(n.uuid)
     from users u left join notes n on n.user_id = u.id
     group by u.id, u.name order by u.id" 2>/dev/null | sed "s/^/USER<</"
  sudo -u postgres psql -d cerebro -tAF"|" -c \
    "select c.name, count(n.uuid)
     from categories c
     left join notes n on n.category_id = c.id and n.deleted_at is null
     where c.user_id = (select min(id) from users)
     group by c.id, c.name order by c.sort_order" 2>/dev/null | sed "s/^/CAT<</"
  # to_char needs single quotes, which do not survive this heredoc-over-ssh —
  # hence the substring on the raw timestamp instead.
  echo "LASTNOTE<<$(sudo -u postgres psql -d cerebro -tAc "select substring(max(created_at)::text from 1 for 16) from notes" 2>/dev/null)"
  echo "MIGRATIONS<<$(sudo -u postgres psql -d cerebro -tAc "select count(*) from schema_migrations" 2>/dev/null)"
' 2>/dev/null)
SSH_RC=$?

field() { printf '%s\n' "$REMOTE" | grep "^$1<<" | head -1 | cut -d'<' -f3-; }
rows()  { printf '%s\n' "$REMOTE" | grep "^$1<<" | cut -d'<' -f3-; }

# ── the API, reached the way the phone reaches it ────────────────────────────
HEALTH_BODY=$(curl -s -m 8 -w '\n%{http_code}\n%{time_total}' "$API_URL/health" 2>/dev/null)
HEALTH_CODE=$(printf '%s' "$HEALTH_BODY" | tail -2 | head -1)
HEALTH_TIME=$(printf '%s' "$HEALTH_BODY" | tail -1)
HEALTH_JSON=$(printf '%s' "$HEALTH_BODY" | head -1)

# ── the phone build ──────────────────────────────────────────────────────────
# The 7-day provisioning profile is the thing most likely to bite, and it is the
# one fact no server can report.
APP_PATH=$(ls -dt $APP_GLOB 2>/dev/null | head -1)
PROFILE_EXP=""; DAYS_LEFT=""
if [ -n "$APP_PATH" ] && [ -f "$APP_PATH/embedded.mobileprovision" ]; then
  PROFILE_EXP=$(security cms -D -i "$APP_PATH/embedded.mobileprovision" 2>/dev/null \
    | plutil -extract ExpirationDate raw -o - - 2>/dev/null)
  if [ -n "$PROFILE_EXP" ]; then
    EXP_EPOCH=$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$PROFILE_EXP" '+%s' 2>/dev/null)
    [ -n "$EXP_EPOCH" ] && DAYS_LEFT=$(( (EXP_EPOCH - $(date '+%s')) / 86400 ))
  fi
fi

# ── brief mode ───────────────────────────────────────────────────────────────
if [ $BRIEF -eq 1 ]; then
  TOTAL=$(rows USER | awk -F'|' '{s+=$5} END {print s+0}')
  [ "$HEALTH_CODE" = "200" ] && A="api ok" || { A="api DOWN"; note_problem; }
  if [ -n "$DAYS_LEFT" ]; then
    [ "$DAYS_LEFT" -lt 0 ] && { P="profil EXPIRAT"; note_problem; } || P="profil ${DAYS_LEFT}z"
  else
    P="profil ?"
  fi
  echo "cerebro: $A · $TOTAL note · $P"
  exit $(( PROBLEMS > 0 ? 1 : 0 ))
fi

# ── report ───────────────────────────────────────────────────────────────────
echo
echo "${PINK}${BOLD}  CEREBRO${RESET}${DIM} · $(date '+%d %b %Y, %H:%M')${RESET}"
echo "${DIM}  ────────────────────────────────────────────${RESET}"

echo
echo "${BOLD}  API${RESET}"
if [ "$HEALTH_CODE" = "200" ]; then
  MS=$(awk -v t="$HEALTH_TIME" 'BEGIN {printf "%.0f", t*1000}')
  echo "    stare        ${GREEN}online${RESET} ${DIM}(${MS}ms)${RESET}"
  echo "    raspuns      ${DIM}${HEALTH_JSON}${RESET}"
  case "$HEALTH_JSON" in *'"db":true'*) ;; *) echo "    ${RED}baza de date raportata ca picata${RESET}"; note_problem ;; esac
else
  echo "    stare        ${RED}INACCESIBIL${RESET} ${DIM}($API_URL)${RESET}"
  echo "                 ${DIM}verifica Tailscale pe Mac${RESET}"
  note_problem
fi
echo "    adresa       ${DIM}${API_URL}${RESET}"

if [ $SSH_RC -ne 0 ] || [ -z "$REMOTE" ]; then
  echo
  echo "  ${RED}VM inaccesibil prin ssh ($HOST)${RESET}"
  note_problem
else
  SVC_STATE=$(field SVC_ActiveState)
  echo
  echo "${BOLD}  SERVICIU${RESET} ${DIM}cerebro-api${RESET}"
  if [ "$SVC_STATE" = "active" ]; then
    echo "    stare        ${GREEN}${SVC_STATE}${RESET} ${DIM}($(field SVC_SubState))${RESET}"
  else
    echo "    stare        ${RED}${SVC_STATE:-necunoscut}${RESET}"
    note_problem
  fi
  # systemctl is-active says "active" even for a service crash-looping every
  # 3 seconds, so the restart counter is the honest signal (see Faza 04).
  echo "    pornit de    $(field SVC_ActiveEnterTimestamp | sed 's/^[A-Za-z]* //')"
  echo "    restarturi   $(field SVC_NRestarts) ${DIM}(istoric; creste = probleme)${RESET}"
  echo "    ollama       $(field OLLAMA)"
  echo "    postgres     $(field PG)"

  echo
  echo "${BOLD}  VM${RESET} ${DIM}${HOST#*@}${RESET}"
  echo "    uptime       $(field UPPRETTY | sed 's/^up //')"
  echo "    pornit la    $(field BOOT)"
  echo "    incarcare    $(field LOAD)"
  echo "    disc         $(field DISK)"

  echo
  echo "${BOLD}  NOTE${RESET}"
  printf '    %-12s %6s %6s %6s %6s\n' "user" "active" "done" "trash" "total"
  rows USER | while IFS='|' read -r name live trashed done total; do
    printf '    %-12s %6s %6s %6s %6s\n' "$name" "$live" "$done" "$trashed" "$total"
  done
  echo "    ${DIM}ultima nota: $(field LASTNOTE)${RESET}"

  echo
  # Categories of the first user created — the one rows USER lists first.
  echo "${BOLD}  CATEGORII${RESET} ${DIM}$(rows USER | head -1 | cut -d'|' -f1)${RESET}"
  rows CAT | while IFS='|' read -r name count; do
    printf '    %-16s %s\n' "$name" "$count"
  done
  echo "    ${DIM}migratii aplicate: $(field MIGRATIONS)${RESET}"
fi

echo
echo "${BOLD}  BUILD IPHONE${RESET}"
if [ -z "$APP_PATH" ]; then
  echo "    ${YELLOW}niciun build Release gasit${RESET}"
  echo "    ${DIM}construieste din mobile/ios/ inainte de reinstalare${RESET}"
elif [ -z "$PROFILE_EXP" ]; then
  echo "    ${YELLOW}profilul nu a putut fi citit${RESET}"
else
  WHEN=$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$PROFILE_EXP" '+%d %b, %H:%M' 2>/dev/null)
  if [ -z "$DAYS_LEFT" ]; then
    echo "    expira       $WHEN"
  elif [ "$DAYS_LEFT" -lt 0 ]; then
    echo "    ${RED}EXPIRAT${RESET} de $(( -DAYS_LEFT )) zile ${DIM}($WHEN)${RESET}"
    echo "    ${DIM}aplicatia nu mai porneste pana la reinstalare${RESET}"
    note_problem
  elif [ "$DAYS_LEFT" -le 2 ]; then
    echo "    reinstalare  ${YELLOW}in $DAYS_LEFT zile${RESET} ${DIM}($WHEN)${RESET}"
  else
    echo "    reinstalare  ${GREEN}in $DAYS_LEFT zile${RESET} ${DIM}($WHEN)${RESET}"
  fi
  echo "    build        ${DIM}$(date -r "$APP_PATH" '+%d %b, %H:%M')${RESET}"
fi

# Reinstalling needs the phone reachable, so surface it here rather than making
# it a surprise mid-deploy.
DEV_STATE=$(xcrun devicectl list devices 2>/dev/null | grep -i 'iPhone' | head -1 \
  | grep -oE 'available \(paired\)|unavailable|connected' | head -1)
[ -n "$DEV_STATE" ] && echo "    telefon      ${DIM}${DEV_STATE}${RESET}"

echo
if [ $PROBLEMS -eq 0 ]; then
  echo "${DIM}  ────────────────────────────────────────────${RESET}"
  echo "  ${GREEN}totul in regula${RESET}"
else
  echo "${DIM}  ────────────────────────────────────────────${RESET}"
  if [ $PROBLEMS -eq 1 ]; then
    echo "  ${RED}1 lucru de verificat${RESET}"
  else
    echo "  ${RED}$PROBLEMS lucruri de verificat${RESET}"
  fi
fi
echo

exit $(( PROBLEMS > 0 ? 1 : 0 ))
