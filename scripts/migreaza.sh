#!/usr/bin/env bash
# Aplică migrările care n-au rulat încă pe baza dată, în ordine, fiecare o singură
# dată. Ce a rulat se ține în tabela migrare_aplicata. Se rulează cu proprietarul
# tabelelor (octogon_owner), nu cu rolul aplicației.
#
#   scripts/migreaza.sh postgres://octogon_owner@localhost/octogon
set -euo pipefail
URL="${1:?Folosire: scripts/migreaza.sh <url-baza-de-date>}"
cd "$(dirname "$0")/.."

psql "$URL" -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS migrare_aplicata (
    fisier      text PRIMARY KEY,
    aplicata_la timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE migrare_aplicata IS 'Migrations already applied to this database, by file name';
SQL

aplicate=$(psql "$URL" -At -c "SELECT fisier FROM migrare_aplicata")
noi=0
for f in db/migrations/*.sql; do
  nume=$(basename "$f")
  if grep -qx "$nume" <<<"$aplicate"; then continue; fi
  echo "  aplic $nume"
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f"
  psql "$URL" -q -v ON_ERROR_STOP=1 -c "INSERT INTO migrare_aplicata (fisier) VALUES ('$nume')"
  noi=$((noi + 1))
done
echo "migrări noi aplicate: $noi"
