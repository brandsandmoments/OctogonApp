#!/usr/bin/env bash
# Actualizarea aplicației pe server, după un push pe main. Se rulează ca root:
#
#   bash /opt/octogon/deploy/actualizeaza.sh
#
# Întâi un backup, apoi codul nou, dependențele, migrările noi, construirea și
# repornirea. Dacă un pas cade, aplicația veche rămâne pornită.
set -euo pipefail
COD=/opt/octogon
[ "$(id -u)" = 0 ] || { echo "Rulează ca root."; exit 1; }
# shellcheck disable=SC1091
. "$COD/.env.owner"
cd /

echo "==> backup înainte de actualizare"
systemctl start octogon-backup.service
echo "==> cod nou"
sudo -H -u octogon git -C "$COD" pull --ff-only
echo "==> dependențe"
sudo -H -u octogon bash -c "cd $COD && npm ci --no-audit --no-fund"
echo "==> migrări noi"
sudo -H -u octogon bash -c "cd $COD && scripts/migreaza.sh '$MIGRARI_URL'"
echo "==> construire"
sudo -H -u octogon bash -c "cd $COD && npm run build"
echo "==> repornire"
systemctl restart octogon.service
sleep 3
systemctl is-active --quiet octogon.service && echo "Gata: aplicația rulează versiunea $(sudo -H -u octogon git -C $COD log --oneline -1)."
