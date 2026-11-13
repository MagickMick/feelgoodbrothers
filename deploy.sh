#!/usr/bin/env bash
# Deploys Feelgood Brothers to the Weggeefdeals VPS (docker context "weggeefdeals"), next to the
# stacks "weggeefdeals" and "tintexclusive".
#
#   ./deploy.sh               build + deploy the apps, certificate (nginx is NOT touched)
#   ./deploy.sh --check       read-only: shows what would happen, changes nothing
#   ./deploy.sh --skip-build  no build/deploy of the apps: only certificate (+ nginx with --nginx)
#   ./deploy.sh --nginx       also put our block in the shared nginx (asks for confirmation)
#   ./deploy.sh -y            don't ask for confirmation on an nginx change
#   ./deploy.sh <tag>         own image tag (default: timestamp)
#
# What this script changes on the server:
#   - the own stack "feelgoodbrothers" and /opt/feelgoodbrothers (uploads, backups)
#   - a new certificate "feelgoodbrothers.com" next to the others in the certbot folder of
#     Weggeefdeals (existing certificates are not touched; its certbot service renews ours too)
#   - only with --nginx: the part between "# BEGIN/END feelgoodbrothers" in the nginx config on
#     the server. The new config is built from the config ON THE SERVER, so everything of
#     Weggeefdeals and Tint Exclusive stays byte-for-byte the same. Diff, confirmation, backup,
#     nginx -t, graceful reload (no restart), automatic restore on failure.
# It never changes, restarts or redeploys the stacks "weggeefdeals" or "tintexclusive", and never
# writes into their repositories.
#
# Settings: deploy.env (see deploy.env.example). Secrets: .env.production (see .env.example).
set -euo pipefail
cd "$(dirname "$0")"

STACK=feelgoodbrothers
WEB_IMAGE=feelgoodbrothers-web
ADMIN_IMAGE=feelgoodbrothers-admin
CERT_NAME=feelgoodbrothers.com
BLOCK=nginx/feelgoodbrothers.conf
REMOTE_DIR=/opt/feelgoodbrothers

CHECK_ONLY=0
SKIP_BUILD=0
APPLY_NGINX=0
ASSUME_YES=0
TAG=$(date +%Y%m%d-%H%M%S)
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --nginx) APPLY_NGINX=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -*) echo "Unknown option: $arg"; exit 1 ;;
    *) TAG=$arg ;;
  esac
done

step() { printf '\n▶ %s\n' "$*"; }
ok()   { printf '   ✓ %s\n' "$*"; }
warn() { printf '   ⚠ %s\n' "$*"; }
die()  { printf '\n✗ %s\n' "$*" >&2; exit 1; }

# reads KEY=value lines (no shell evaluation, so values may contain $ or spaces)
load_env() {
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case "$line" in ''|\#*) continue ;; esac
    key=${line%%=*}
    val=${line#*=}
    case "$val" in
      \"*\") val=${val#\"}; val=${val%\"} ;;
      \'*\') val=${val#\'}; val=${val%\'} ;;
    esac
    val=${val//\$HOME/$HOME}
    export "$key=$val"
  done < "$1"
}

[ -f deploy.env ] || die "deploy.env missing (copy deploy.env.example)"
load_env deploy.env
CONTEXT=${DOCKER_CONTEXT:-weggeefdeals}
WG_STACK=${WG_STACK:-weggeefdeals}
REMOTE_NGINX_DIR=${REMOTE_NGINX_DIR:-/opt/weggeefdeals/nginx}
REMOTE_CERTBOT_DIR=${REMOTE_CERTBOT_DIR:-/opt/weggeefdeals/certbot}
read -r -a DOMAINS <<< "${DOMAINS:-new.feelgoodbrothers.com admin.feelgoodbrothers.com}"

# never "docker context use": that would change the global context
local_docker()  { docker --context "${LOCAL_CONTEXT:-default}" "$@"; }
remote_docker() { docker --context "$CONTEXT" "$@"; }

# every service on the server that is not ours, with its replicas (to prove we didn't touch them)
others_snapshot() {
  remote_docker service ls --format '{{.Name}} {{.Replicas}}' | grep -v "^${STACK}_" | sort
}

printf '======================================\n  Feelgood Brothers deploy → %s\n  tag: %s%s\n======================================\n' \
  "${DOMAINS[*]}" "$TAG" "$([ "$CHECK_ONLY" = 1 ] && echo '  (--check: read-only)')"

# ── 0. Checks ────────────────────────────────────────────────────────────────
step "Checks"
[ -f .env.production ] || die ".env.production missing (copy .env.example and fill it in)"
load_env .env.production
for v in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD SITE_URL; do
  [ -n "${!v:-}" ] || die "$v is empty in .env.production"
done
[ "${AI_PROVIDER:-openai}" = "openai" ] && [ -z "${OPENAI_API_KEY:-}" ] && warn "OPENAI_API_KEY is empty: the writing assistant will say it has no key"
ok ".env.production complete"

docker context inspect "$CONTEXT" >/dev/null 2>&1 || die "Docker context '$CONTEXT' does not exist"
[ "$(remote_docker info --format '{{.Swarm.ControlAvailable}}' 2>/dev/null)" = "true" ] \
  || die "Server not reachable via context '$CONTEXT', or not a swarm manager"
ok "server reachable (swarm manager)"

[ -n "$(remote_docker network ls --filter name="^${WG_STACK}_default\$" -q)" ] \
  || die "Network ${WG_STACK}_default does not exist: is the stack '$WG_STACK' running?"
NGINX_CID=$(remote_docker ps -q --filter "name=${WG_STACK}_nginx" | head -1)
[ -n "$NGINX_CID" ] || die "No running nginx container of '$WG_STACK' found"
ok "network and nginx of Weggeefdeals found"

head -1 "$BLOCK" | grep -q '^# BEGIN feelgoodbrothers' && tail -1 "$BLOCK" | grep -q '^# END feelgoodbrothers' \
  || die "$BLOCK must start with '# BEGIN feelgoodbrothers' and end with '# END feelgoodbrothers'"

OTHERS_BEFORE=$(others_snapshot)
ok "other stacks running: $(echo "$OTHERS_BEFORE" | grep -c . | tr -d ' ') services (recorded for the final check)"

MEM=$(remote_docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
ok "server memory: $((MEM / 1024 / 1024)) MB total (this stack is limited to ~1.5 GB, uses ~600-800 MB)"

# DNS (informational: with the Cloudflare proxy on, the A record shows Cloudflare, not the VPS)
for d in "${DOMAINS[@]}"; do
  ip=$(dig +short A "$d" @1.1.1.1 2>/dev/null | tail -1 || true)
  if [ "$ip" = "$VPS_IP" ]; then ok "DNS: $d → $ip"
  else warn "DNS: $d → '${ip:-nothing}' (VPS is $VPS_IP; fine if this is the Cloudflare proxy)"; fi
done

# does the certificate exist and cover every domain?
# (read-only: read the certificate from the running nginx container and parse it locally)
CERT_DOMAINS=$(remote_docker exec "$NGINX_CID" cat "/etc/letsencrypt/live/$CERT_NAME/fullchain.pem" 2>/dev/null \
  | openssl x509 -noout -text 2>/dev/null | grep -o 'DNS:[^,]*' | sed 's/DNS://' | tr '\n' ' ' | sed 's/ $//' || true)
CERT_OK=1
for d in "${DOMAINS[@]}"; do
  case " $CERT_DOMAINS " in *" $d "*) ;; *) CERT_OK=0 ;; esac
done
if [ -z "$CERT_DOMAINS" ]; then warn "no certificate '$CERT_NAME' yet"
elif [ "$CERT_OK" = 1 ]; then ok "certificate covers: $CERT_DOMAINS"
else warn "certificate covers '$CERT_DOMAINS', needs: ${DOMAINS[*]}"; fi

# nginx: the config ON THE SERVER with our block pasted in (replaced if present, appended
# otherwise). Only lines between our markers can change.
CANDIDATE=$(mktemp); REMOTE_CONF=$(mktemp)
trap 'rm -f "$CANDIDATE" "$REMOTE_CONF"' EXIT
remote_docker exec "$NGINX_CID" cat /etc/nginx/conf.d/default.conf > "$REMOTE_CONF"
[ -s "$REMOTE_CONF" ] || die "Could not read the nginx config from the server"
awk -v f="$BLOCK" '
  BEGIN { while ((getline l < f) > 0) b = b l "\n" }
  /^# BEGIN feelgoodbrothers/ { printf "%s", b; skip = 1; done = 1; next }
  /^# END feelgoodbrothers/   { skip = 0; next }
  !skip { print }
  END { if (!done) printf "\n%s", b }
' "$REMOTE_CONF" > "$CANDIDATE"
# safety: outside our block, the new config must be identical to the server's
strip_ours() { awk '/^# BEGIN feelgoodbrothers/{s=1} !s{print} /^# END feelgoodbrothers/{s=0}' "$1" | sed '/^$/d'; }
[ "$(strip_ours "$REMOTE_CONF")" = "$(strip_ours "$CANDIDATE")" ] || die "Internal error: the new nginx config would change more than our block. Nothing was changed."
NGINX_CHANGED=0
if cmp -s "$REMOTE_CONF" "$CANDIDATE"; then ok "our nginx block on the server is up to date"
else NGINX_CHANGED=1; warn "our nginx block on the server is missing or outdated (only applied with --nginx)"; fi

if [ "$CHECK_ONLY" = 1 ]; then
  step "What a real deploy would do"
  if [ "$SKIP_BUILD" = 1 ]; then echo "   1-3. skip build and deploy (--skip-build)"
  else
    echo "   1. build $WEB_IMAGE:$TAG and $ADMIN_IMAGE:$TAG (linux/amd64) and send them to the server"
    echo "   2. create $REMOTE_DIR/uploads and $REMOTE_DIR/backups if needed"
    echo "   3. deploy stack '$STACK' (rolling, next to the other stacks)"
  fi
  [ "$CERT_OK" = 1 ] && echo "   4. certificate is fine" || echo "   4. request certificate '$CERT_NAME' for ${DOMAINS[*]} (needs DNS → $VPS_IP)"
  if [ "$NGINX_CHANGED" = 0 ]; then echo "   5. nginx: our block is up to date, nothing to do"
  elif [ "$APPLY_NGINX" = 1 ]; then echo "   5. nginx: put our block in (diff, confirmation, backup, nginx -t, graceful reload)"
  else echo "   5. nginx: NOT touched (our block is missing or outdated; add --nginx to apply it)"; fi
  if [ "$NGINX_CHANGED" = 1 ]; then
    echo; echo "Difference server → new:"; diff -u "$REMOTE_CONF" "$CANDIDATE" | sed 's/^/   /' || true
  fi
  echo; echo "Nothing was changed."
  exit 0
fi

wait_service() {
  local svc="${STACK}_$1" state replicas
  printf '   waiting for %s' "$1"
  for _ in $(seq 1 80); do
    state=$(remote_docker service inspect "$svc" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}' 2>/dev/null || true)
    replicas=$(remote_docker service ls --filter "name=$svc" --format '{{.Replicas}}' 2>/dev/null | head -1 || true)
    case "$state" in
      rollback_*|paused) echo; remote_docker service logs --tail 40 "$svc" 2>&1 || true; die "Deploy of $1 failed (status: $state). Swarm rolled back, see the logs above." ;;
    esac
    if [ "$replicas" = "1/1" ] && { [ "$state" = "completed" ] || [ -z "$state" ]; }; then echo; ok "$1 running"; return; fi
    printf '.'; sleep 3
  done
  echo; remote_docker service logs --tail 40 "$svc" 2>&1 || true
  die "$1 did not become healthy within 4 minutes (logs above)"
}

if [ "$SKIP_BUILD" = 1 ]; then
  step "[1-3/6] Build and deploy skipped (--skip-build)"
  [ "$(remote_docker service ls --filter "name=${STACK}_fgb-web" --format '{{.Replicas}}')" = "1/1" ] \
    || die "The site isn't running on the server yet. Run ./deploy.sh without --skip-build."
else
  # ── 1. Build locally, so the VPS (and the other sites on it) isn't loaded ──
  step "[1/6] Build images (local, linux/amd64)"
  [ -n "$(git status --porcelain)" ] && warn "uncommitted changes, they are deployed anyway"
  local_docker build --platform linux/amd64 --target web -t "$WEB_IMAGE:$TAG" -t "$WEB_IMAGE:latest" .
  local_docker build --platform linux/amd64 --target admin -t "$ADMIN_IMAGE:$TAG" -t "$ADMIN_IMAGE:latest" .

  # ── 2. Send images to the server (no registry) + host folders ──────────────
  step "[2/6] Send images to the server"
  local_docker save "$WEB_IMAGE:$TAG" "$ADMIN_IMAGE:$TAG" | gzip | remote_docker load
  # uploads belong to the node user (uid 1000) of the admin image
  remote_docker run --rm -v /opt:/host-opt nginx:alpine sh -c \
    "mkdir -p /host-opt/feelgoodbrothers/uploads /host-opt/feelgoodbrothers/backups && chown 1000:1000 /host-opt/feelgoodbrothers/uploads"
  ok "images loaded, $REMOTE_DIR/{uploads,backups} ready"

  # ── 3. Deploy the stack ────────────────────────────────────────────────────
  step "[3/6] Deploy stack '$STACK'"
  export TAG
  remote_docker stack deploy --resolve-image never --prune -c docker-stack.yml "$STACK"
  wait_service fgb-postgres
  wait_service fgb-admin   # runs the database migrations on start
  wait_service fgb-web
fi

# ── 4. Certificate ───────────────────────────────────────────────────────────
step "[4/6] Certificate"
if [ "$CERT_OK" = 1 ]; then
  ok "certificate is fine (renewal is done by the certbot service of Weggeefdeals)"
else
  # Let's Encrypt must reach /.well-known/acme-challenge/ on every domain. Check that first with a
  # probe file, so a DNS mistake doesn't burn Let's Encrypt's rate limit.
  PROBE=fgb-probe-$TAG
  acme_file() { remote_docker run --rm -v "$REMOTE_CERTBOT_DIR/www:/w" nginx:alpine sh -c "$1" < /dev/null; }
  acme_file "mkdir -p /w/.well-known/acme-challenge && echo $PROBE > /w/.well-known/acme-challenge/$PROBE"
  NOT_READY=()
  for d in "${DOMAINS[@]}"; do
    got=$(curl -sLk --max-time 8 "http://$d/.well-known/acme-challenge/$PROBE" || true)
    [ "$got" = "$PROBE" ] && ok "$d reaches this server" || NOT_READY+=("$d")
  done
  acme_file "rm -f /w/.well-known/acme-challenge/$PROBE"
  if [ "${#NOT_READY[@]}" -gt 0 ]; then
    echo "   These hostnames don't reach the VPS yet:"
    for d in "${NOT_READY[@]}"; do echo "     - $d  (A record → $VPS_IP, in Cloudflare 'DNS only' / grey cloud)"; done
    echo "   The apps are deployed; fix DNS and run ./deploy.sh --skip-build. nginx was not touched."
    exit 0
  fi
  CERT_ARGS=()
  for d in "${DOMAINS[@]}"; do CERT_ARGS+=(-d "$d"); done
  if [ -n "${CERT_EMAIL:-}" ]; then CERT_ARGS+=(--email "$CERT_EMAIL"); else CERT_ARGS+=(--register-unsafely-without-email); fi
  # with --cert-name, a changed domain list replaces the domains of the existing certificate
  remote_docker run --rm \
    -v "$REMOTE_CERTBOT_DIR/conf:/etc/letsencrypt" \
    -v "$REMOTE_CERTBOT_DIR/www:/var/www/certbot" \
    certbot/certbot certonly --webroot -w /var/www/certbot "${CERT_ARGS[@]}" \
    --cert-name "$CERT_NAME" --agree-tos --non-interactive \
    || die "Requesting the certificate failed. nginx and the other sites were not touched."
  ok "certificate for ${DOMAINS[*]}"
  # nginx only reads certificates on (re)load: if our block is already active, reload now
  if [ "$NGINX_CHANGED" = 0 ]; then
    remote_docker exec "$NGINX_CID" sh -c 'nginx -t && nginx -s reload' >/dev/null 2>&1 && ok "nginx reloaded with the new certificate"
  fi
fi

# ── 5. nginx of Weggeefdeals (graceful reload with safety net) ──────────────
step "[5/6] nginx of Weggeefdeals: feelgoodbrothers block"
if [ "$NGINX_CHANGED" = 0 ]; then
  ok "nothing to do"
elif [ "$APPLY_NGINX" != 1 ]; then
  warn "not touched: our block is missing or outdated. When you're ready: ./deploy.sh --skip-build --nginx"
else
  echo "   Change to the nginx config of Weggeefdeals:"
  diff -u "$REMOTE_CONF" "$CANDIDATE" | sed 's/^/   /' || true
  if [ "$ASSUME_YES" != 1 ]; then
    [ -t 0 ] || die "No terminal to confirm. Use -y to continue."
    read -r -p "   Apply and gracefully reload nginx? [y/N] " answer
    case "$answer" in y|Y) ;; *) die "Aborted. nginx was not changed." ;; esac
  fi

  BACKUP=nginx.conf.bak-$TAG
  # write in place (same inode): the container has this file mounted as a single file
  nginx_file() { remote_docker run --rm -i --entrypoint sh -v "$REMOTE_NGINX_DIR:/n" nginx:alpine -c "$1"; }
  nginx_file "cp /n/nginx.conf /n/$BACKUP" < /dev/null
  nginx_file 'cat > /n/nginx.conf' < "$CANDIDATE"

  restore() {
    warn "restoring the previous nginx config"
    nginx_file "cat /n/$BACKUP > /n/nginx.conf" < /dev/null
    die "$1 The previous config is back and nginx was not reloaded: the other sites keep running unchanged."
  }
  remote_docker exec "$NGINX_CID" grep -q 'BEGIN feelgoodbrothers' /etc/nginx/conf.d/default.conf \
    || restore "The container doesn't see the new file."
  if ! remote_docker exec "$NGINX_CID" nginx -t 2>&1 | sed 's/^/   /'; then
    restore "nginx -t rejected the new config."
  fi
  remote_docker exec "$NGINX_CID" nginx -s reload
  ok "nginx reloaded (backup: $REMOTE_NGINX_DIR/$BACKUP)"
  warn "a deploy of Weggeefdeals copies its own nginx/nginx.conf to the server: when you change $BLOCK,"
  warn "update the copy in the Weggeefdeals repo too (PR), or that deploy puts the old block back."
fi

# ── 6. Final check ───────────────────────────────────────────────────────────
step "[6/6] Final check"
for d in "${DOMAINS[@]}"; do
  path=/
  case "$d" in admin.*) path=/health ;; esac
  code=000
  for _ in $(seq 1 15); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "https://$d$path" || true)
    [ "$code" = 200 ] && break
    sleep 2
  done
  [ "$code" = 200 ] && ok "https://$d$path → HTTP 200" \
    || warn "https://$d$path → HTTP $code. Check: docker --context $CONTEXT service logs ${STACK}_fgb-web"
done

OTHERS_AFTER=$(others_snapshot)
if [ "$OTHERS_BEFORE" = "$OTHERS_AFTER" ]; then ok "other stacks unchanged: all their services run as before"
else warn "Other stacks differ from before!"; echo "before:"; echo "$OTHERS_BEFORE"; echo "now:"; echo "$OTHERS_AFTER"; fi

# remove old images of this project only, keep the last 3
for img in "$WEB_IMAGE" "$ADMIN_IMAGE"; do
  for old in $(remote_docker image ls "$img" --format '{{.Tag}}' | grep -v '^latest$' | sort -r | tail -n +4); do
    remote_docker rmi "$img:$old" >/dev/null 2>&1 || true
  done
done

printf '\n======================================\n  Done: %s\n======================================\n' "$(printf 'https://%s ' "${DOMAINS[@]}")"
