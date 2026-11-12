#!/bin/sh
# Apply pending database migrations, then start the admin app.
set -e
echo "[admin] running migrations"
node /app/scripts/migrate.mjs
exec "$@"
