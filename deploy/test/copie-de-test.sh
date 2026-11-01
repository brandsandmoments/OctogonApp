#!/usr/bin/env bash
# Copia de test: o a doua aplicație pe același server, cu baza ei (octogon_test), la
# https://test.<domeniu>. Se poate rula oricând din nou: baza de test se reface din
# cea adevărată de acum, cu clienții anonimizați, iar contul demo se pune la loc.
#
#   DEMO_PAROLA=… bash /opt/octogon/deploy/test/copie-de-test.sh 2.31.98.69.nip.io
#
# Pe copia de test intră doar contul demo (utilizator „demo", toate drepturile);
# ceilalți oameni rămân în date, dar nu se pot loga. Magazinele Shopify se citesc la
# 15 minute (doar citire, fără webhook-uri); Slack nu pleacă de aici.
set -euo pipefail
DOMENIU="${1:?Folosire: DEMO_PAROLA=… bash copie-de-test.sh <domeniu>}"
: "${DEMO_PAROLA:?DEMO_PAROLA lipsește}"
COD=/opt/octogon
TEST=/opt/octogon-test
[ "$(id -u)" = 0 ] || { echo "Rulează ca root."; exit 1; }
cd /

echo "==> codul copiei de test, la versiunea aplicației"
if [ ! -d "$TEST/.git" ]; then
  mkdir -p "$TEST" && chown octogon:octogon "$TEST"
  sudo -H -u octogon git clone -q "$COD" "$TEST"
fi
sudo -H -u octogon git -C "$TEST" fetch -q "$COD" "$(sudo -H -u octogon git -C "$COD" rev-parse --abbrev-ref HEAD)"
sudo -H -u octogon git -C "$TEST" reset -q --hard FETCH_HEAD

echo "==> .env de test"
# Aceeași cheie Shopify (tokenurile magazinelor, copiate cu baza, trebuie descifrate),
# altă bază, altă adresă, alt secret de sincronizare, fără Slack și fără accesul la
# curieri, xConnector și SmartBill: copia de test nu atinge conturile adevărate.
sed -e 's#^\(DATABASE_URL=.*\)/octogon$#\1/octogon_test#' \
    -e "s#^APP_URL=.*#APP_URL=https://test.$DOMENIU#" \
    -e '/^SLACK_WEBHOOK_URL=/d' -e '/^SYNC_SECRET=/d' -e '/^OCTOGON_TEST=/d' \
    -e '/^XCONNECTOR_KEY_/d' -e '/^FAN_/d' -e '/^GLS_/d' -e '/^SMARTBILL_/d' "$COD/.env" > "$TEST/.env"
printf 'OCTOGON_TEST=1\nSYNC_SECRET=%s\n' "$(openssl rand -hex 24)" >> "$TEST/.env"
chown octogon:octogon "$TEST/.env"; chmod 600 "$TEST/.env"

echo "==> baza de test, din cea adevărată"
systemctl stop octogon-test.service 2>/dev/null || true
sudo -u postgres dropdb --if-exists octogon_test
sudo -u postgres createdb -O octogon_owner octogon_test
sudo -u postgres pg_dump -Fc octogon | sudo -u postgres pg_restore -d octogon_test --no-comments 2>&1 | grep -v "already exists" || true
sudo -u postgres psql -q -d octogon_test -v ON_ERROR_STOP=1 -v parola="$DEMO_PAROLA" <<'SQL'
BEGIN;
-- Clienții din magazine, anonimizați; la prima citire din Shopify primesc telefoane false stabile.
UPDATE magazin_comanda SET client = 'Client ' || nume, telefon = NULL, nota = NULL;
UPDATE magazin_livrare SET client = 'Client ' || comanda, telefon = NULL;
-- Financiar: coletele de la curieri și comenzile din xConnector, fără nume și telefoane.
UPDATE colet_curier SET destinatar = 'Client ' || coalesce(comanda, awb), telefon = NULL, referinta = NULL;
UPDATE xc_comanda SET client = 'Client ' || nume, telefon = NULL;
UPDATE factura_smartbill SET client = 'Client ' || serie || '-' || numar, telefon = NULL, email = NULL;
-- Extrasele de cont: sumele rămân, descrierile (contrapartide, IBAN-uri) nu.
UPDATE banca_tranzactie SET descriere = NULL;
-- Comenzile și coletele se recitesc de la zero, ca toate să primească telefoane false stabile.
UPDATE magazin SET livrari_pana_la = NULL;
-- Doar contul demo intră: sesiunile, tabletele și ceilalți oameni nu.
DELETE FROM sesiune;
DELETE FROM dispozitiv;
UPDATE utilizator SET activ = false;
SELECT set_config('app.firma_id', (SELECT id::text FROM firma LIMIT 1), true);
INSERT INTO utilizator (firma_id, nume, email, roluri, activ)
VALUES (firma_curenta(), 'Demo', 'demo', '{admin,kam}', true)
ON CONFLICT (firma_id, nume) DO UPDATE SET email = 'demo', roluri = '{admin,kam}', activ = true;
SELECT cont_seteaza_parola((SELECT id FROM utilizator WHERE nume = 'Demo' AND firma_id = firma_curenta()), :'parola');
COMMIT;
SQL

echo "==> construire și pornire"
sudo -H -u octogon bash -c "cd $TEST && npm ci --no-audit --no-fund >/dev/null 2>&1 && npm run build >/tmp/build-test.log 2>&1" \
  || { tail -20 /tmp/build-test.log; exit 1; }
install -m 644 "$COD/deploy/test/octogon-test.service" /etc/systemd/system/
install -m 644 "$COD/deploy/test/octogon-test-magazine.service" /etc/systemd/system/
install -m 644 "$COD/deploy/test/octogon-test-magazine.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now octogon-test.service octogon-test-magazine.timer >/dev/null 2>&1
systemctl restart octogon-test.service

echo "==> HTTPS pentru test.$DOMENIU"
if ! grep -q "^test\.$DOMENIU" /etc/caddy/Caddyfile; then
  cat >> /etc/caddy/Caddyfile <<CADDY

# Copia de test (deploy/test): aceeași aplicație, altă bază, clienți anonimizați.
test.$DOMENIU {
	encode zstd gzip
	request_body {
		max_size 12MB
	}
	header X-Robots-Tag "noindex, nofollow"
	reverse_proxy 127.0.0.1:3001
}
CADDY
  systemctl reload caddy
fi

sleep 5
echo "==> prima citire din magazine (clienții primesc numele și telefoanele false)"
systemctl start octogon-test-magazine.service || echo "citirea magazinelor a dat greș; reîncearcă singură peste 15 minute"
echo
echo "Gata: https://test.$DOMENIU  ·  utilizator: demo"
