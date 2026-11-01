# Legarea magazinelor Shopify

Aplicația citește din fiecare magazin produsele cu stocul și comenzile deschise, și
le ține la zi singură: Shopify o anunță la fiecare comandă nouă sau schimbată și la
fiecare mișcare de stoc (webhook-uri), iar noaptea, la 03:15, se face și o citire
completă. Aplicația nu scrie nimic în magazin.

Se face o singură dată, de un cont master, în trei pași.

## 1. Aplicația Octogon în Shopify

Pe [dev.shopify.com/dashboard](https://dev.shopify.com/dashboard), cu contul care
administrează magazinele:

1. **Create app** → numele „Octogon".
2. La versiunea aplicației:
   - **App URL**: adresa aplicației, de ex. `https://2.31.98.69.nip.io` (sau
     `https://app.octogonfashion.com` când domeniul e gata)
   - **Embed app in Shopify admin**: nu
   - **Redirect URLs**: `<App URL>/shopify/callback`
   - **Scopes**: `read_products`, `read_inventory`, `read_orders`, `read_locations`
   - **Compliance webhooks** (toate trei): `<App URL>/shopify/webhook`
   - **Release** versiunea.
3. **Distribution** → **Custom distribution**, cu domeniul magazinului
   (`maisonloulou.myshopify.com`).
   - O aplicație custom se instalează pe un singur magazin, sau pe magazinele
     aceleiași organizații Shopify Plus. Dacă magazinele nu sunt într-o organizație
     Plus, faci câte o aplicație pe magazin (Octogon Maison Loulou, Octogon Parseea,
     Octogon Sleevy) — aplicația știe să lucreze așa.
4. **Protected customer data** (în setările aplicației): cere acces la **Name**,
   **Phone** și **Address**. Listele de picking și „de sunat" au nevoie de numele,
   telefonul și orașul clientului. Motivul: „expedierea comenzilor proprii".
5. Notează **Client ID** și **Client secret**.

## 2. Datele aplicației pe server

Pe server, în `/opt/octogon/.env`:

```
SHOPIFY_CLIENT_ID=<client id>
SHOPIFY_CLIENT_SECRET=<client secret>
SHOPIFY_CHEIE=<openssl rand -hex 32>
APP_URL=https://2.31.98.69.nip.io
SYNC_SECRET=<openssl rand -hex 24>
```

Cu câte o aplicație pe magazin, datele fiecăreia merg pe codul magazinului:

```
SHOPIFY_CLIENT_ID_MAISON_LOULOU=…
SHOPIFY_CLIENT_SECRET_MAISON_LOULOU=…
SHOPIFY_CLIENT_ID_PARSEEA=…
SHOPIFY_CLIENT_SECRET_PARSEEA=…
SHOPIFY_CLIENT_ID_SLEEVY=…
SHOPIFY_CLIENT_SECRET_SLEEVY=…
```

`SHOPIFY_CHEIE` criptează tokenurile magazinelor în baza de date: dacă se pierde,
magazinele trebuie reinstalate. Apoi `systemctl restart octogon`.

## 3. Instalarea pe fiecare magazin

În aplicație: **Magazine → Legături Shopify**. La fiecare brand scrii domeniul
`.myshopify.com` și apeși **Instalează**. Shopify îți arată ce citește aplicația și
cere aprobarea; după aprobare te întoarce în aplicație, cu prima sincronizare
făcută. De acolo, **Magazine → Comenzi din magazine**.

## Cum se împart comenzile

- **De trimis**: tot ce e pe comandă e pe stoc fizic (on hand).
- **De sunat**: avem doar o parte — fiecare produs e marcat ✔ (avem) sau ✖ (lipsă).
- **Fără stoc**: nu avem nimic de trimis.
- **Posibile duble**: același telefon are mai multe comenzi deschise în același
  magazin; „aceeași variantă" când se repetă și produsul.

Stocul se dă întâi comenzilor care pot pleca întregi, de la cea mai veche; ce
rămâne merge comenzilor parțiale, tot de la cea mai veche. Comenzile anulate,
arhivate, rambursate sau livrate nu apar.

Shopify dă aplicațiilor comenzile din ultimele 60 de zile; o comandă deschisă mai
veche de atât nu apare (pentru ea e nevoie de permisiunea `read_all_orders`, care
se cere separat).
