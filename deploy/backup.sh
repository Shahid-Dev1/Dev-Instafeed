#!/usr/bin/env bash
# Nightly logical backup of PostgreSQL with 14-day local retention. Run from cron, e.g.:
#   15 1 * * * /opt/instafeed/deploy/backup.sh >> /var/log/instafeed-backup.log 2>&1
# Copy BACKUP_DIR off-host (object storage) as well; a backup on the same server is not a backup.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/instafeed}"
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/instafeed-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$FILE"
pg_restore --list "$FILE" > /dev/null   # verify the archive is readable
find "$BACKUP_DIR" -name 'instafeed-*.dump' -mtime +14 -delete
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
# Restore (into an empty database): pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" <file>
