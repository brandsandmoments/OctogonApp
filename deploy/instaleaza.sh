#!/usr/bin/env bash
# Instalarea OctogonApp pe un server Ubuntu 24.04 curat. Se rulează ca root:
#
#   bash instaleaza.sh app.octogonfashion.com
#
# Pune: Postgres 16, Node 22, Caddy (HTTPS automat), utilizatorul de sistem
# „octogon", codul în /opt/octogon, baza de date cu rolurile ei, migrările, nomen-
# clatoarele, aplicația ca serviciu care repornește singur, firewall-ul și backup-ul
# zilnic. Se poate rula din nou: ce există deja nu se strică.
set -euo pipefail

DOMENIU="${1:?Folosire: bash instaleaza.sh <domeniu>, ex. app.octogonfashion.com}"
REPO="${REPO:-git@github.com:brandsandmoments/OctogonApp.git}"
RAMURA="${RAMURA:-main}"
COD=/opt/octogon
CASA=/var/lib/octogon
FIRMA_ID=0c706000-0000-4000-8000-000000000001

[ "$(id -u)" = 0 ] || { echo "Rulează ca root (sudo bash instaleaza.sh …)."; exit 1; }
pas() { echo; echo "==> $*"; }
cd /   # comenzile rulate ca alt utilizator nu pot intra în dosarul lui root

pas "Pachete: Postgres, git, firewall"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q postgresql postgresql-contrib git curl ca-certificates gnupg ufw rsync \
  debian-keyring debian-archive-keyring apt-transport-https openssl

if ! command -v node >/dev/null || ! node -v | grep -q '^v22\.'; then
  pas "Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi

if ! command -v caddy >/dev/null; then
  pas "Caddy (HTTPS automat)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

pas "Utilizatorul de sistem octogon"
id octogon >/dev/null 2>&1 || useradd --system --create-home --home-dir "$CASA" --shell /bin/bash octogon

if [ ! -d "$COD/.git" ]; then
  # Depozitul e privat: serverul primește o cheie doar de citire („deploy key").
  if [ ! -f "$CASA/.ssh/id_ed25519" ]; then
    sudo -H -u octogon mkdir -p "$CASA/.ssh"
    sudo -H -u octogon ssh-keygen -q -t ed25519 -N '' -C "octogon@$DOMENIU" -f "$CASA/.ssh/id_ed25519"
    sudo -H -u octogon ssh-keyscan -q github.com >> "$CASA/.ssh/known_hosts"
  fi
  if ! sudo -H -u octogon git ls-remote "$REPO" >/dev/null 2>&1; then
    echo
    echo "Adaugă cheia de mai jos în GitHub: depozitul OctogonApp → Settings → Deploy keys →"
    echo "Add deploy key (doar citire), apoi rulează din nou scriptul."
    echo
    cat "$CASA/.ssh/id_ed25519.pub"
    exit 2
  fi
  pas "Codul, în $COD"
  mkdir -p "$COD" && chown octogon:octogon "$COD"
  sudo -H -u octogon git clone --branch "$RAMURA" "$REPO" "$COD"
fi

pas "Baza de date"
# Două roluri: proprietarul tabelelor (migrări) și aplicația (fără drept să ocolească
# izolarea pe firme). Parolele se generează o dată și stau doar în fișierele .env.
if [ ! -f "$COD/.env" ]; then
  PAROLA_APP=$(openssl rand -hex 24)
  PAROLA_OWNER=$(openssl rand -hex 24)
  sudo -u postgres psql -q -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'octogon_owner') THEN
    CREATE ROLE octogon_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'octogon_app') THEN
    CREATE ROLE octogon_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END \$\$;
ALTER ROLE octogon_owner PASSWORD '$PAROLA_OWNER';
ALTER ROLE octogon_app PASSWORD '$PAROLA_APP';
SQL
  sudo -u postgres psql -At -c "SELECT 1 FROM pg_database WHERE datname = 'octogon'" | grep -q 1 \
    || sudo -u postgres createdb -O octogon_owner octogon
  sudo -u postgres psql -q -d octogon -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext;"

  umask 077
  cat > "$COD/.env" <<ENV
# Generat de deploy/instaleaza.sh. Nu se pune în git.
DATABASE_URL=postgres://octogon_app:$PAROLA_APP@127.0.0.1:5432/octogon
FIRMA_ID=$FIRMA_ID

# Magazinele Shopify (vezi .env.example): domeniul .myshopify.com și tokenul shpat_…
SHOPIFY_SHOP_PARSEEA=
SHOPIFY_TOKEN_PARSEEA=
SHOPIFY_SHOP_MAISON_LOULOU=
SHOPIFY_TOKEN_MAISON_LOULOU=
SHOPIFY_SHOP_SLEEVY=
SHOPIFY_TOKEN_SLEEVY=
ENV
  echo "MIGRARI_URL=postgres://octogon_owner:$PAROLA_OWNER@127.0.0.1:5432/octogon" > "$COD/.env.owner"
  chown octogon:octogon "$COD/.env" "$COD/.env.owner"
  chmod 600 "$COD/.env" "$COD/.env.owner"
  umask 022
fi
# shellcheck disable=SC1091
. "$COD/.env.owner"

pas "Dependențe, migrări, nomenclatoare"
sudo -H -u octogon bash -c "cd $COD && npm ci --no-audit --no-fund"
sudo -H -u octogon bash -c "cd $COD && scripts/migreaza.sh '$MIGRARI_URL'"
sudo -H -u octogon psql "$MIGRARI_URL" -q -v ON_ERROR_STOP=1 -f "$COD/db/seed_octogon.sql"
sudo -H -u octogon psql "$MIGRARI_URL" -q -v ON_ERROR_STOP=1 -f "$COD/db/oameni_octogon.sql"

pas "Construirea aplicației"
sudo -H -u octogon bash -c "cd $COD && npm run build"

pas "Serviciul octogon"
install -m 644 "$COD/deploy/octogon.service" /etc/systemd/system/octogon.service
install -m 644 "$COD/deploy/octogon-backup.service" /etc/systemd/system/octogon-backup.service
install -m 644 "$COD/deploy/octogon-backup.timer" /etc/systemd/system/octogon-backup.timer
mkdir -p /var/backups/octogon && chown postgres:postgres /var/backups/octogon && chmod 700 /var/backups/octogon
systemctl daemon-reload
systemctl enable --now octogon.service octogon-backup.timer
systemctl restart octogon.service

pas "HTTPS pentru $DOMENIU"
sed "s/{{DOMENIU}}/$DOMENIU/" "$COD/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

pas "Firewall: doar SSH, HTTP și HTTPS"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo
echo "Gata. Aplicația: https://$DOMENIU"
echo "Urmează contul master (vezi deploy/README.md):"
echo "  sudo -H -u octogon bash -c 'cd $COD && npm run cont:admin -- --email <email> --nume \"<nume>\"'"
