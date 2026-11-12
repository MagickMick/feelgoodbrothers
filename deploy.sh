#!/bin/bash
# Build, push and deploy Feelgood Brothers to the VPS (Docker Swarm, zero downtime).
#   ./deploy.sh            # tag = short git sha
#   ./deploy.sh v1.2.0
set -euo pipefail
cd "$(dirname "$0")"
[ -f deploy.env ] || { echo "deploy.env missing (copy deploy.env.example)"; exit 1; }
# shellcheck disable=SC1091
source deploy.env

TAG=${1:-$(git rev-parse --short HEAD)}
SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes)
VPS="$VPS_USER@$VPS_HOST"
WEB="$IMAGE_PREFIX-web"
ADMIN="$IMAGE_PREFIX-admin"

if [ -n "$(git status --porcelain)" ]; then
  echo "⚠  uncommitted changes, deploying them anyway as $TAG"
fi

echo "▶ [1/4] Build images ($TAG) for linux/amd64"
docker --context default build --platform linux/amd64 --target web -t "$WEB:$TAG" -t "$WEB:latest" .
docker --context default build --platform linux/amd64 --target admin -t "$ADMIN:$TAG" -t "$ADMIN:latest" .

echo "▶ [2/4] Push to Docker Hub"
docker --context default push "$WEB:$TAG"
docker --context default push "$ADMIN:$TAG"
docker --context default push "$WEB:latest"
docker --context default push "$ADMIN:latest"

echo "▶ [3/4] Sync config to $VPS:$REMOTE_DIR"
ssh "${SSH_OPTS[@]}" "$VPS" "test -f $REMOTE_DIR/.env" || { echo "No $REMOTE_DIR/.env on the VPS, run ./setup-vps.sh first"; exit 1; }
scp "${SSH_OPTS[@]}" -q docker-stack.yml "$VPS:$REMOTE_DIR/docker-stack.yml"
scp "${SSH_OPTS[@]}" -q nginx/nginx.conf nginx/*.inc "$VPS:$REMOTE_DIR/nginx/"

# nginx needs a certificate to start; create a temporary self-signed one on the very first deploy
ssh "${SSH_OPTS[@]}" "$VPS" "test -f $REMOTE_DIR/certbot/conf/live/feelgoodbrothers.com/fullchain.pem" || {
  echo "   no certificate yet, creating a temporary self-signed one (run ./init-letsencrypt.sh next)"
  ssh "${SSH_OPTS[@]}" "$VPS" "mkdir -p $REMOTE_DIR/certbot/conf/live/feelgoodbrothers.com && docker run --rm -v $REMOTE_DIR/certbot/conf:/etc/letsencrypt --entrypoint openssl certbot/certbot req -x509 -nodes -newkey rsa:2048 -days 1 -keyout /etc/letsencrypt/live/feelgoodbrothers.com/privkey.pem -out /etc/letsencrypt/live/feelgoodbrothers.com/fullchain.pem -subj /CN=localhost"
}

echo "▶ [4/4] Deploy stack (rolling update)"
# the stack file is rendered on the VPS with the VPS .env, so secrets never leave the server
ssh "${SSH_OPTS[@]}" "$VPS" "cd $REMOTE_DIR && set -a && . ./.env && set +a && TAG=$TAG docker stack deploy --with-registry-auth --prune -c docker-stack.yml feelgoodbrothers"

# nginx config is a bind mount: reload it so config changes apply without a restart
NGINX=$(docker --context "$DOCKER_CONTEXT" ps -q -f name=feelgoodbrothers_nginx | head -1)
[ -n "$NGINX" ] && docker --context "$DOCKER_CONTEXT" exec "$NGINX" sh -c "nginx -t && nginx -s reload" || true

echo
docker --context "$DOCKER_CONTEXT" stack services feelgoodbrothers
echo
echo "✓ Deployed $TAG. Follow progress: docker --context $DOCKER_CONTEXT service ps feelgoodbrothers_web"
