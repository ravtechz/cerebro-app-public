#!/usr/bin/env bash
#
# Deploy the Cerebro API to the VM.
#
# Runs from a laptop: it ssh's in, pulls, installs, migrates, restarts.
# Claude Code never runs on the VM — the VM only receives finished code.
#
#   HOST=user@cerebro-vm ./deploy.sh            deploy
#   HOST=user@cerebro-vm ./deploy.sh --status   show service status and recent logs, change nothing
#
# HOST is the ssh target: an account with sudo on the VM, not the `cerebro`
# service user.
#
# One-time setup on the VM (as root), before the first deploy:
#   adduser --system --group --home /opt/cerebro cerebro
#   git clone <repo> /opt/cerebro && chown -R cerebro:cerebro /opt/cerebro
#   python3 -m venv /opt/cerebro/venv
#   cp /opt/cerebro/backend/.env.example /opt/cerebro/backend/.env   # then edit it
#   cp /opt/cerebro/backend/deploy/cerebro-api.service /etc/systemd/system/
#   cp /opt/cerebro/backend/deploy/cerebro-purge.{service,timer} /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now cerebro-api
#   systemctl enable --now cerebro-purge.timer

set -euo pipefail

HOST="${HOST:?set HOST to the ssh target, e.g. HOST=user@cerebro-vm ./deploy.sh}"
APP_DIR="${APP_DIR:-/opt/cerebro}"
SERVICE="cerebro-api"

if [ "${1:-}" = "--status" ]; then
  ssh "$HOST" "systemctl status $SERVICE --no-pager -n 30"
  # The purge is a timer, not a service: it is "healthy" when it is scheduled,
  # so the last/next run is what to look at.
  ssh "$HOST" "systemctl list-timers cerebro-purge --no-pager" || true
  exit 0
fi

echo "==> deploying to $HOST:$APP_DIR"

ssh "$HOST" bash -euo pipefail <<REMOTE
cd "$APP_DIR"

echo "--> git pull"
sudo -u cerebro git pull --ff-only

echo "--> dependencies"
sudo -u cerebro "$APP_DIR/venv/bin/pip" install --quiet --upgrade -r backend/requirements.txt

echo "--> migrations"
# Run as the service user, taking DATABASE_URL from the backend .env — the
# cerebro role owns the database, so no superuser is involved.
# Idempotent: already-applied migrations are skipped.
sudo -u cerebro bash -c 'set -a; . "$APP_DIR/backend/.env"; set +a; cd "$APP_DIR/db" && ./migrate.sh' || {
  echo "migrations failed — not restarting the service" >&2
  exit 1
}

echo "--> restart"
sudo systemctl restart $SERVICE
REMOTE

echo "==> waiting for /health"
for attempt in $(seq 1 15); do
  if ssh "$HOST" "curl -fsS http://localhost:8000/health" 2>/dev/null | grep -q '"db":true'; then
    echo "==> healthy"
    exit 0
  fi
  sleep 1
done

echo "!! service did not become healthy; last logs:" >&2
ssh "$HOST" "journalctl -u $SERVICE -n 40 --no-pager" >&2
exit 1
