# Punerea OctogonApp pe server

Ghidul de lansare, pas cu pas. Durează cam o oră, cea mai mare parte așteptare.

Ce rezultă: aplicația la `https://app.octogonfashion.com`, pe un server al nostru,
cu HTTPS, backup zilnic și actualizare dintr-o singură comandă.

## 1. Serverul

Hetzner Cloud → **Add Server**:

- Location: **Falkenstein** sau **Nuremberg** (Germania, aproape de noi, date în UE)
- Image: **Ubuntu 24.04**
- Type: **CX32** (4 vCPU, 8 GB RAM) — ajunge cu mult pentru toată echipa
- SSH key: cheia ta publică (`cat ~/.ssh/id_ed25519.pub` pe Mac; dacă nu există,
  `ssh-keygen -t ed25519`)
- Backups: bifat (+20%) — o copie a întregului server pe zi, separată de backup-ul bazei

Notează adresa IP a serverului.

## 2. Domeniul

La cine ține DNS-ul pentru `octogonfashion.com`, adaugă o înregistrare:

| Tip | Nume | Valoare |
|---|---|---|
| A | `app` | IP-ul serverului |

Așteaptă până `ping app.octogonfashion.com` răspunde cu IP-ul serverului (de obicei
câteva minute). Fără asta, certificatul HTTPS nu se poate emite.

## 3. Instalarea

Din dosarul aplicației, pe Mac, copiază scriptul pe server și intră pe el:

```bash
scp deploy/instaleaza.sh root@app.octogonfashion.com:
```

```bash
ssh root@app.octogonfashion.com
```

Pe server:

```bash
bash instaleaza.sh app.octogonfashion.com
```

Prima rulare se oprește și afișează o cheie (`ssh-ed25519 …`). Pune-o în GitHub:
**OctogonApp → Settings → Deploy keys → Add deploy key**, titlu „server", fără
„Allow write access". Apoi rulează din nou aceeași comandă. A doua oară merge până
la capăt: instalează tot, creează baza de date cu parole generate, aplică migrările
și nomenclatoarele, construiește aplicația și o pornește.

Parolele bazei de date stau doar pe server, în `/opt/octogon/.env` și
`/opt/octogon/.env.owner`. Nu trebuie notate nicăieri.

## 4. Datele

Datele vin din dashboard, la fel ca pe calculatorul de test. Exportă din Google
Sheets, ca `.xlsx`: dashboard-ul și „Situație Tipare". Urcă-le pe server, de pe Mac:

```bash
scp dashboard.xlsx situatie_tipare.xlsx root@app.octogonfashion.com:/opt/octogon/
```

Pe server:

```bash
cd /opt/octogon
sudo -H -u octogon npm run import:dashboard -- dashboard.xlsx
sudo -H -u octogon bash -c '. ./.env.owner && psql "$MIGRARI_URL" -f db/modele_din_denumire.sql && psql "$MIGRARI_URL" -f db/oameni_octogon.sql'
sudo -H -u octogon npm run import:tipare -- situatie_tipare.xlsx
rm dashboard.xlsx situatie_tipare.xlsx
```

Fiecare import scrie la final un raport cu ce n-a putut potrivi. Citește-l: e
același tip de listă pe care am trecut-o pe test (produse fără catalog, comenzi
fără dată de lansare).

## 5. Conturile

Primul cont master, pentru tine. Parola se tastează la prompt, nu apare pe ecran:

```bash
cd /opt/octogon
sudo -H -u octogon npm run cont:admin -- --email octogon.alex@gmail.com --nume "Alexandru Stanciu"
```

Intră în aplicație și, din **Oameni și conturi**, dă fiecăruia email și parolă.
Folosește parole noi, de cel puțin 10 caractere, nu pe cele de pe test: parolele de
pe calculatorul de test nu ajung pe server.

## 6. Shopify (când e cazul)

Tokenurile magazinelor se scriu în `/opt/octogon/.env`, la `SHOPIFY_…`:

```bash
nano /opt/octogon/.env
systemctl restart octogon
```

## Zi de zi

**Actualizarea**, după un push pe `main`:

```bash
ssh root@app.octogonfashion.com bash /opt/octogon/deploy/actualizeaza.sh
```

Face întâi un backup, apoi aduce codul, aplică migrările noi, construiește și
repornește. Dacă un pas cade, rămâne pornită versiunea veche.

**Starea aplicației și jurnalul ei:**

```bash
systemctl status octogon
journalctl -u octogon -n 100
```

**Backup-ul** rulează în fiecare noapte la 02:30, în `/var/backups/octogon/`, cu
ultimele 30 de zile. Ca să plece și în altă parte (recomandat, de ex. un Storage
Box Hetzner), scrie în `/etc/octogon-backup.env`:

```
BACKUP_DEST=u123456@u123456.your-storagebox.de:octogon/
```

și pune cheia publică a utilizatorului `postgres` în Storage Box.

**Restaurarea** unui backup (oprește aplicația cât durează):

```bash
systemctl stop octogon
sudo -u postgres pg_restore --clean --if-exists -d octogon /var/backups/octogon/octogon-2026-11-01.dump
systemctl start octogon
```

## Ce e pe server

| Ce | Unde |
|---|---|
| Codul | `/opt/octogon` (utilizatorul `octogon`) |
| Configurarea și parolele bazei | `/opt/octogon/.env`, `/opt/octogon/.env.owner` |
| Aplicația | serviciul `octogon`, doar pe `127.0.0.1:3000` |
| HTTPS | Caddy, `/etc/caddy/Caddyfile`; certificatul se reînnoiește singur |
| Baza de date | Postgres, baza `octogon`, accesibilă doar local |
| Backup-uri | `/var/backups/octogon`, timer-ul `octogon-backup` |
| Firewall | ufw: doar SSH, HTTP, HTTPS |
