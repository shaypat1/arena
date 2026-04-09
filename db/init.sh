#!/bin/bash
# db/init.sh - Run all Arena database migrations in order.
# Usage: ./db/init.sh
#
# Environment variables (with defaults):
#   PGHOST     (default: localhost)
#   PGPORT     (default: 5432)
#   PGUSER     (default: arena)
#   PGDATABASE (default: arena)

set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-arena}"
PGDATABASE="${PGDATABASE:-arena}"

MIGRATIONS_DIR="$(cd "$(dirname "$0")/migrations" && pwd)"

echo "==> Arena DB init"
echo "    Host:     $PGHOST:$PGPORT"
echo "    Database: $PGDATABASE"
echo "    User:     $PGUSER"
echo ""

# -------------------------------------------------------
# Wait for PostgreSQL to accept connections (up to 30s)
# -------------------------------------------------------
echo "==> Waiting for PostgreSQL to be ready..."
MAX_RETRIES=30
RETRY=0
until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -q; do
    RETRY=$((RETRY + 1))
    if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
        echo "ERROR: PostgreSQL not ready after ${MAX_RETRIES}s. Aborting."
        exit 1
    fi
    sleep 1
done
echo "    PostgreSQL is ready."
echo ""

# -------------------------------------------------------
# Run each migration file in lexicographic order
# -------------------------------------------------------
echo "==> Running migrations from $MIGRATIONS_DIR"
for migration in "$MIGRATIONS_DIR"/*.sql; do
    filename="$(basename "$migration")"
    echo "    Running: $filename ..."
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
         -v ON_ERROR_STOP=1 \
         -f "$migration"
    echo "    Done:    $filename"
done

echo ""
echo "==> All migrations applied successfully."
