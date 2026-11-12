#!/bin/bash
# One-time setup of a fresh VPS (Ubuntu/Debian) for Feelgood Brothers.
#   cp deploy.env.example deploy.env   # fill in VPS_HOST etc.
#   ./setup-vps.sh
# Installs Docker, initialises a single-node Swarm, opens the firewall, creates
# /opt/feelgoodbrothers and the local docker context "feelgoodbrothers".
set -euo pipefail
cd "$(dirname "$0")"
[ -f deploy.env ] || { echo "deploy.env missing (copy deploy.env.example)"; exit 1; }
# shellcheck disable=SC1091
source deploy.env

SSH="ssh -i $SSH_KEY -o IdentitiesOnly=yes $VPS_USER@$VPS_HOST"

echo "▶ [1/4] Docker + firewall on $VPS_HOST"
$SSH 'bash -s' <<'REMOTE'
set -e
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
if command -v ufw >/dev/null; then
  ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
  ufw --force enable
fi
docker swarm init 2>/dev/null || echo "swarm already initialised"
REMOTE

echo "▶ [2/4] Directories in $REMOTE_DIR"
# uploads + backups are written by the app containers (uid 1000 = node) and the backup job
$SSH "mkdir -p $REMOTE_DIR/nginx $REMOTE_DIR/certbot/conf $REMOTE_DIR/certbot/www $REMOTE_DIR/uploads $REMOTE_DIR/backups && chown -R 1000:1000 $REMOTE_DIR/uploads && chmod 700 $REMOTE_DIR/backups"

echo "▶ [3/4] .env on the VPS"
if $SSH "test -f $REMOTE_DIR/.env"; then
  echo "   .env already exists, leaving it alone"
else
  PG_PASS=$(openssl rand -hex 24)
  INDEXNOW=$(openssl rand -hex 16)
  sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$PG_PASS/" -e "s/^INDEXNOW_KEY=.*/INDEXNOW_KEY=$INDEXNOW/" .env.example \
    | $SSH "umask 077 && cat > $REMOTE_DIR/.env"
  echo "   created $REMOTE_DIR/.env with a random Postgres password + IndexNow key"
fi

echo "▶ [4/4] Local docker context '$DOCKER_CONTEXT'"
if docker context inspect "$DOCKER_CONTEXT" >/dev/null 2>&1; then
  echo "   context exists"
else
  docker context create "$DOCKER_CONTEXT" --docker "host=ssh://$VPS_USER@$VPS_HOST"
fi
echo
echo "✓ VPS ready. Next:"
echo "  1. Point DNS for admin.feelgoodbrothers.com and new.feelgoodbrothers.com to $VPS_HOST"
echo "  2. ./deploy.sh                 (build, push and start the stack)"
echo "  3. ./init-letsencrypt.sh       (real SSL certificates)"
echo "  Note: the ssh context uses your ssh config; add a Host entry with IdentityFile $SSH_KEY if needed."
