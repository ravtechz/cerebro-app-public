#!/usr/bin/env bash
#
# Cerebro migration runner (Faza 03, pas 3).
#
# Applies every .sql file in db/migrations/ that has not run yet, in filename
# order, and records it in the schema_migrations table. Safe to run repeatedly:
# already-applied files are skipped, so deploy.sh can call it every time.
#
#   ./migrate.sh              apply pending migrations
#   ./migrate.sh --status     list applied / pending, change nothing
#   ./migrate.sh --baseline [FILE]
#                             record migrations as applied WITHOUT running them,
#                             for a database whose schema was already created by
#                             hand. With FILE, only that one is marked and the
#                             rest stay pending; without it, every pending
#                             migration is marked.
#
# The connection string comes from --dsn, then $DATABASE_URL, then a .env next
# to this script or in its parent — same order as scripts/create_user.py.

set -euo pipefail

DEFAULT_DSN="postgresql://cerebro@localhost/cerebro"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The .sql files live in db/migrations/, not next to this script. Pointing at
# $HERE made the glob match nothing, and the "no migrations found" branch exits
# 0 — so deploy.sh read it as success and the runner silently never applied
# anything. The VM's schema was created by hand in Faza 03, which is why it went
# unnoticed until the first real migration was due.
MIGRATIONS_DIR="$HERE/migrations"

STATUS_ONLY=false
BASELINE=false
BASELINE_ONLY=""
CLI_DSN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --status)   STATUS_ONLY=true; shift ;;
    --baseline)
      BASELINE=true
      # optional filename: anything that is not the next flag
      if [ $# -ge 2 ] && [ "${2#--}" = "$2" ]; then BASELINE_ONLY="$2"; shift 2; else shift; fi
      ;;
    --dsn)    CLI_DSN="${2:?--dsn needs a value}"; shift 2 ;;
    -h|--help) sed -n '3,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

resolve_dsn() {
  if [ -n "$CLI_DSN" ]; then echo "$CLI_DSN"; return; fi
  if [ -n "${DATABASE_URL:-}" ]; then echo "$DATABASE_URL"; return; fi
  for env_file in "$HERE/.env" "$HERE/../.env"; do
    if [ -f "$env_file" ]; then
      local line
      line="$(grep -m1 '^DATABASE_URL=' "$env_file" || true)"
      if [ -n "$line" ]; then
        line="${line#DATABASE_URL=}"
        # strip surrounding quotes if the .env used them
        line="${line%\"}"; line="${line#\"}"
        line="${line%\'}"; line="${line#\'}"
        echo "$line"; return
      fi
    fi
  done
  echo "$DEFAULT_DSN"
}

DSN="$(resolve_dsn)"

command -v psql >/dev/null || { echo "error: psql not found in PATH" >&2; exit 1; }
[ -d "$MIGRATIONS_DIR" ] || { echo "error: $MIGRATIONS_DIR does not exist" >&2; exit 1; }

# Quiet, unaligned, tuples-only — output is parsed, not read by a human.
psql_q() { psql "$DSN" -v ON_ERROR_STOP=1 -qtAX "$@"; }

# client_min_messages: IF NOT EXISTS announces its own no-op with a NOTICE on
# every run, which would be noise in deploy.sh output.
psql_q -c "
  SET client_min_messages = warning;
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );" >/dev/null

applied="$(psql_q -c "SELECT filename FROM schema_migrations;")"

is_applied() {
  printf '%s\n' "$applied" | grep -Fxq "$1"
}

shopt -s nullglob
files=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [ ${#files[@]} -eq 0 ]; then
  echo "no migrations found in $MIGRATIONS_DIR"
  exit 0
fi

if $STATUS_ONLY; then
  for file in "${files[@]}"; do
    name="$(basename "$file")"
    if is_applied "$name"; then echo "  applied  $name"; else echo "  PENDING  $name"; fi
  done
  exit 0
fi

pending=0
for file in "${files[@]}"; do
  name="$(basename "$file")"
  is_applied "$name" && continue

  if $BASELINE; then
    # With an explicit filename, every other migration is left alone so a plain
    # run can still apply it afterwards.
    if [ -n "$BASELINE_ONLY" ] && [ "$name" != "$BASELINE_ONLY" ]; then
      continue
    fi
    echo "baseline  $name (recorded, not executed)"
    psql_q -c "INSERT INTO schema_migrations (filename) VALUES ('$name');" >/dev/null
    pending=$((pending + 1))
    continue
  fi

  echo "applying $name"
  # --single-transaction wraps the file AND the bookkeeping insert in one
  # transaction: a migration that fails halfway leaves neither schema changes
  # nor a row claiming it succeeded.
  psql "$DSN" -v ON_ERROR_STOP=1 -qX --single-transaction \
    -f "$file" \
    -c "INSERT INTO schema_migrations (filename) VALUES ('$name');"
  pending=$((pending + 1))
done

if [ "$pending" -eq 0 ] && $BASELINE && [ -n "$BASELINE_ONLY" ]; then
  echo "error: '$BASELINE_ONLY' is not a pending migration" >&2
  exit 1
elif [ "$pending" -eq 0 ]; then
  echo "database is up to date (${#files[@]} migrations already applied)"
elif $BASELINE; then
  echo "done: $pending migration(s) marked as applied"
else
  echo "done: $pending migration(s) applied"
fi
