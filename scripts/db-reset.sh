#!/usr/bin/env bash
# Reconstruieste baza de date de lucru de la zero. Nu se ruleaza pe productie.
set -euo pipefail
BD="${1:-octogon}"
dropdb --if-exists "$BD"
createdb "$BD"
for f in db/migrations/*.sql; do echo "  $f"; psql -q -v ON_ERROR_STOP=1 -d "$BD" -f "$f"; done
echo "  db/seed_octogon.sql"; psql -q -v ON_ERROR_STOP=1 -d "$BD" -f db/seed_octogon.sql
echo "gata: $BD"
