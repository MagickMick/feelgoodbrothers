#!/bin/bash
# Request (or extend) the Let's Encrypt certificate "feelgoodbrothers.com".
# DNS for every domain must already point to the VPS, and the stack must be running (./deploy.sh).
#
#   ./init-letsencrypt.sh admin.feelgoodbrothers.com new.feelgoodbrothers.com          # before the DNS switch
#   ./init-letsencrypt.sh feelgoodbrothers.com www.feelgoodbrothers.com admin.feelgoodbrothers.com new.feelgoodbrothers.com   # after
#   STAGING=1 ./init-letsencrypt.sh ...   # test against the staging CA first (no rate limits)
set -euo pipefail
cd "$(dirname "$0")"
[ -f deploy.env ] || { echo "deploy.env missing (copy deploy.env.example)"; exit 1; }
# shellcheck disable=SC1091
source deploy.env

[ $# -gt 0 ] || { echo "Usage: $0 domain [domain...]"; exit 1; }
SSH="ssh -i $SSH_KEY -o IdentitiesOnly=yes $VPS_USER@$VPS_HOST"
CONF=$REMOTE_DIR/certbot/conf
WWW=$REMOTE_DIR/certbot/www

DOMAIN_ARGS=""
for d in "$@"; do DOMAIN_ARGS="$DOMAIN_ARGS -d $d"; done
EMAIL_ARG="--register-unsafely-without-email"
[ -n "${LETSENCRYPT_EMAIL:-}" ] && EMAIL_ARG="--email $LETSENCRYPT_EMAIL"
STAGING_ARG=""
[ "${STAGING:-0}" = "1" ] && STAGING_ARG="--staging"

echo "▶ Removing the temporary self-signed certificate (if any)"
$SSH "if [ -f $CONF/live/feelgoodbrothers.com/fullchain.pem ] && [ ! -f $CONF/renewal/feelgoodbrothers.com.conf ]; then rm -rf $CONF/live/feelgoodbrothers.com; fi"

echo "▶ Requesting certificate for: $*"
$SSH "docker run --rm -v $CONF:/etc/letsencrypt -v $WWW:/var/www/certbot certbot/certbot certonly --webroot -w /var/www/certbot $STAGING_ARG $EMAIL_ARG $DOMAIN_ARGS --cert-name feelgoodbrothers.com --key-type ecdsa --agree-tos --non-interactive --expand"

echo "▶ Reloading nginx"
NGINX=$(docker --context "$DOCKER_CONTEXT" ps -q -f name=feelgoodbrothers_nginx | head -1)
docker --context "$DOCKER_CONTEXT" exec "$NGINX" nginx -s reload
echo "✓ Certificate installed. Renewal runs automatically in the certbot service."
