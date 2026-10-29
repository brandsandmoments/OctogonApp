#!/usr/bin/env bash
# Backup-ul zilnic al bazei: un fișier pg_dump pe zi în /var/backups/octogon, ultimele
# 30 de zile. Dacă /etc/octogon-backup.env are BACKUP_DEST (ex. un Storage Box:
# u123456@u123456.your-storagebox.de:octogon/), copia pleacă și acolo, prin rsync/ssh.
# Rulează ca postgres, din octogon-backup.timer.
#
# Restaurare: pg_restore --clean --if-exists -d octogon /var/backups/octogon/octogon-<zi>.dump
set -euo pipefail
DIR=/var/backups/octogon
ZI=$(date +%F)
pg_dump -Fc octogon > "$DIR/octogon-$ZI.dump.part"
mv "$DIR/octogon-$ZI.dump.part" "$DIR/octogon-$ZI.dump"
find "$DIR" -name 'octogon-*.dump' -mtime +30 -delete
if [ -f /etc/octogon-backup.env ]; then
  # shellcheck disable=SC1091
  . /etc/octogon-backup.env
  if [ -n "${BACKUP_DEST:-}" ]; then
    rsync -a -e "ssh -p ${BACKUP_PORT:-23} -o BatchMode=yes" "$DIR/octogon-$ZI.dump" "$BACKUP_DEST"
  fi
fi
echo "backup: $DIR/octogon-$ZI.dump"
