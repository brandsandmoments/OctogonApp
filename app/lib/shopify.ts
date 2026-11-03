import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { caFirma, firmaDinMediu } from './db';

/**
 * Legătura cu magazinele Shopify: instalarea aplicației Octogon (OAuth), citirea
 * produselor cu stocul și a comenzilor deschise, webhook-urile care le țin la zi.
 *
 * Shopify e sursa. Variantele se rescriu cu ce spune Shopify; comenzile deschise
 * (nelivrate, neanulate, nerambursate) stau în magazin_comanda, iar o comandă care
 * se închide, se livrează sau se anulează iese de acolo. Aplicația nu scrie nimic
 * înapoi în magazin.
 *
 * Webhook-urile și sincronizarea de noapte rulează fără om logat: firma vine din
 * mediu (FIRMA_ID), ca la scripturi.
 *
 * Mediul: SHOPIFY_CLIENT_ID și SHOPIFY_CLIENT_SECRET (aplicația din Shopify Dev
 * Dashboard), SHOPIFY_CHEIE (32 de octeți, hex, pentru criptarea tokenurilor),
 * APP_URL (adresa publică a aplicației, pentru redirect și webhook-uri).
 *
 * O aplicație cu distribuție custom se instalează pe un singur magazin (sau pe
 * magazinele aceleiași organizații Plus). Când fiecare magazin are aplicația lui,
 * datele ei stau în SHOPIFY_CLIENT_ID_<COD> și SHOPIFY_CLIENT_SECRET_<COD> și au
 * întâietate față de cele comune.
 */

export const VERSIUNE_API = '2026-10';
export const PERMISIUNI = 'read_products,read_inventory,read_orders,read_locations,read_shopify_payments_accounts,read_shopify_payments_payouts';

export class EroareShopify extends Error {}

const mediu = (nume: string) => {
  const v = process.env[nume];
  if (!v) throw new EroareShopify(`Lipsește ${nume} din .env.`);
  return v;
};

/** Aplicația Shopify a magazinului: a lui, dacă are una, altfel cea comună. */
function aplicatia(cod: string): { id: string; secret: string } | null {
  const id = process.env[`SHOPIFY_CLIENT_ID_${cod}`] ?? process.env.SHOPIFY_CLIENT_ID;
  const secret = process.env[`SHOPIFY_CLIENT_SECRET_${cod}`] ?? process.env.SHOPIFY_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

const aplicatiaSigur = (cod: string) => {
  const a = aplicatia(cod);
  if (!a) throw new EroareShopify(`Lipsesc SHOPIFY_CLIENT_ID și SHOPIFY_CLIENT_SECRET (sau _${cod}) din .env.`);
  return a;
};

export const shopifyConfigurat = (cod: string) => Boolean(aplicatia(cod) && process.env.SHOPIFY_CHEIE && process.env.APP_URL);

// ---------------------------------------------------------------- criptarea tokenului

function cheie(): Buffer {
  const k = Buffer.from(mediu('SHOPIFY_CHEIE'), 'hex');
  if (k.length !== 32) throw new EroareShopify('SHOPIFY_CHEIE trebuie să aibă 64 de caractere hex (32 de octeți).');
  return k;
}

export function cripteaza(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', cheie(), iv);
  const date = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), date].map((b) => b.toString('base64')).join('.');
}

export function decripteaza(criptat: string): string {
  const [iv, tag, date] = criptat.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', cheie(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(date), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------- semnături

const egal = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Parametrii de la Shopify la instalare sunt semnați cu secretul aplicației (hmac, hex). */
export function hmacParametriValid(parametri: URLSearchParams, cod: string): boolean {
  const hmac = parametri.get('hmac');
  if (!hmac) return false;
  const restul = [...parametri].filter(([k]) => k !== 'hmac' && k !== 'signature').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // Shopify semnează parametrii codați ca într-un query string (host-ul, base64, poate avea „="); unele
  // biblioteci îi semnează decodați. Primim oricare dintre cele două forme, ambele cu secretul aplicației.
  const codat = new URLSearchParams(restul).toString();
  const decodat = restul.map(([k, v]) => `${k}=${v}`).join('&');
  const semneaza = (m: string) => createHmac('sha256', aplicatiaSigur(cod).secret).update(m).digest('hex');
  return egal(semneaza(codat), hmac) || egal(semneaza(decodat), hmac);
}

/** Adresa publică a aplicației: în spatele lui Caddy, cererea se vede ca venind la localhost. */
export const adresaPublica = (cale: string) => new URL(cale, mediu('APP_URL'));

/** Webhook-urile poartă semnătura corpului brut, în X-Shopify-Hmac-Sha256 (base64). */
export function hmacWebhookValid(corp: string, semnatura: string | null, cod: string): boolean {
  const a = aplicatia(cod);
  if (!semnatura || !a) return false;
  return egal(createHmac('sha256', a.secret).update(corp, 'utf8').digest('base64'), semnatura);
}

/** Codul magazinului după domeniul lui, pentru webhook-urile care vin fără sesiune. */
export async function codDupaDomeniu(domeniu: string): Promise<string | null> {
  return caFirma(firmaDinMediu(), async (c) =>
    (await c.query<{ cod: string }>(`SELECT cod FROM magazin WHERE domeniu = $1`, [domeniu])).rows[0]?.cod ?? null);
}

export async function codMagazin(magazinId: string): Promise<string | null> {
  return caFirma(firmaDinMediu(), async (c) =>
    (await c.query<{ cod: string }>(`SELECT cod FROM magazin WHERE id = $1`, [magazinId])).rows[0]?.cod ?? null);
}

export const domeniuValid = (d: string) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(d);

// ---------------------------------------------------------------- instalarea

export function adresaInstalare(domeniu: string, stare: string, cod: string): string {
  const q = new URLSearchParams({
    client_id: aplicatiaSigur(cod).id, scope: PERMISIUNI,
    redirect_uri: `${mediu('APP_URL')}/shopify/callback`, state: stare,
  });
  return `https://${domeniu}/admin/oauth/authorize?${q}`;
}

export async function schimbaCodulPeToken(domeniu: string, codOauth: string, cod: string): Promise<{ token: string; permisiuni: string }> {
  const app = aplicatiaSigur(cod);
  const r = await fetch(`https://${domeniu}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: app.id, client_secret: app.secret, code: codOauth }),
  });
  if (!r.ok) throw new EroareShopify(`Shopify a refuzat codul de instalare (${r.status}).`);
  const j = await r.json() as { access_token: string; scope: string };
  return { token: j.access_token, permisiuni: j.scope };
}

// ---------------------------------------------------------------- GraphQL

type Acces = { magazinId: string; domeniu: string; token: string };

async function gql<T>(a: Acces, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  for (let incercare = 0; ; incercare++) {
    const r = await fetch(`https://${a.domeniu}/admin/api/${VERSIUNE_API}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': a.token },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 429 || r.status >= 500) {
      if (incercare >= 4) throw new EroareShopify(`Shopify nu răspunde (${r.status}).`);
      await new Promise((ok) => setTimeout(ok, 1000 * 2 ** incercare));
      continue;
    }
    const j = await r.json() as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
    if (j.errors?.some((e) => e.extensions?.code === 'THROTTLED') && incercare < 4) {
      await new Promise((ok) => setTimeout(ok, 1000 * 2 ** incercare));
      continue;
    }
    if (j.errors?.length) throw new EroareShopify([...new Set(j.errors.map((e) => e.message))].join('; '));
    return j.data as T;
  }
}

/** Domeniul și tokenul magazinului: din instalare (criptat în bază) sau din mediu (aplicația custom, 0011). */
async function acces(c: PoolClient, magazinId: string): Promise<Acces | null> {
  const { rows: [m] } = await c.query<{ cod: string; domeniu: string | null; token_criptat: string | null }>(
    `SELECT cod, domeniu, token_criptat FROM magazin WHERE id = $1 AND activ`, [magazinId]);
  if (!m) return null;
  if (m.domeniu && m.token_criptat) return { magazinId, domeniu: m.domeniu, token: decripteaza(m.token_criptat) };
  const domeniu = process.env[`SHOPIFY_SHOP_${m.cod}`], token = process.env[`SHOPIFY_TOKEN_${m.cod}`];
  return domeniu && token ? { magazinId, domeniu, token } : null;
}

// ---------------------------------------------------------------- variantele

const VARIANTA = `
  id sku title price inventoryPolicy
  selectedOptions { name value }
  product { id title productType status }
  inventoryItem { id inventoryLevels(first: 20) { nodes { quantities(names: ["on_hand", "available"]) { name quantity } } } }`;

type VariantaShopify = {
  id: string; sku: string | null; title: string; price: string | null; inventoryPolicy: string | null;
  selectedOptions: { name: string; value: string }[];
  product: { id: string; title: string; productType: string | null; status: string };
  inventoryItem: { id: string; inventoryLevels: { nodes: { quantities: { name: string; quantity: number }[] }[] } } | null;
};

type Catalog = { produse: { id: string; cod_sku: string }[]; dupaNume: Map<string, string>; marimi: Map<string, string> };

async function catalog(c: PoolClient): Promise<Catalog> {
  const toate = (await c.query<{ id: string; cod_sku: string; nume: string }>(`SELECT id, upper(cod_sku) AS cod_sku, lower(denumire) AS nume FROM produs`)).rows;
  const produse = [...toate].sort((a, b) => b.cod_sku.length - a.cod_sku.length); // cel mai lung prefix câștigă, ca la vânzări
  // Denumirea din catalog e titlul din Shopify: variantele fără SKU (ciorne, produse noi) se leagă după titlu.
  const dupaNume = new Map(toate.map((p) => [p.nume, p.id]));
  const marimi = new Map<string, string>();
  for (const m of (await c.query<{ id: string; cod: string }>(`SELECT id, upper(cod) AS cod FROM marime`)).rows) marimi.set(m.cod, m.id);
  for (const a of (await c.query<{ marime_id: string; alias: string }>(`SELECT marime_id, upper(alias) AS alias FROM marime_alias`)).rows) {
    if (!marimi.has(a.alias)) marimi.set(a.alias, a.marime_id);
  }
  return { produse, dupaNume, marimi };
}

const OPTIUNE_MARIME = /^(m[aă]rime|size|talie|marimea)$/i;

async function scrieVarianta(c: PoolClient, magazinId: string, cat: Catalog, v: VariantaShopify) {
  const optiuni = Object.fromEntries(v.selectedOptions.map((o) => [o.name, o.value]));
  const sku = v.sku?.trim().toUpperCase() || null;
  const produs = (sku ? cat.produse.find((p) => sku.startsWith(`${p.cod_sku}-`)) : undefined)
    ?? ((id) => (id ? { id, cod_sku: '' } : undefined))(cat.dupaNume.get(v.product.title.trim().toLowerCase()));
  const marimeText = v.selectedOptions.find((o) => OPTIUNE_MARIME.test(o.name))?.value
    ?? (produs && sku ? sku.slice(produs.cod_sku.length + 1) : null);
  const cantitate = (nume: string) => (v.inventoryItem?.inventoryLevels.nodes ?? [])
    .reduce((s, n) => s + (n.quantities.find((q) => q.name === nume)?.quantity ?? 0), 0);
  await c.query(
    `INSERT INTO magazin_varianta (firma_id, magazin_id, varianta_gid, articol_gid, produs_gid, sku, titlu_produs, titlu_varianta,
                                   tip_produs, optiuni, stoc_fizic, stoc_disponibil, pret, activ, produs_id, marime_id, vinde_fara_stoc, actualizat_la)
     VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
     ON CONFLICT (magazin_id, varianta_gid) DO UPDATE SET
       articol_gid = EXCLUDED.articol_gid, produs_gid = EXCLUDED.produs_gid, sku = EXCLUDED.sku,
       titlu_produs = EXCLUDED.titlu_produs, titlu_varianta = EXCLUDED.titlu_varianta, tip_produs = EXCLUDED.tip_produs,
       optiuni = EXCLUDED.optiuni, stoc_fizic = EXCLUDED.stoc_fizic, stoc_disponibil = EXCLUDED.stoc_disponibil,
       pret = EXCLUDED.pret, activ = EXCLUDED.activ, produs_id = EXCLUDED.produs_id, marime_id = EXCLUDED.marime_id,
       vinde_fara_stoc = EXCLUDED.vinde_fara_stoc, actualizat_la = now()`,
    [magazinId, v.id, v.inventoryItem?.id ?? null, v.product.id, sku, v.product.title, v.title === 'Default Title' ? null : v.title,
     v.product.productType || null, JSON.stringify(optiuni), cantitate('on_hand'), cantitate('available'), v.price,
     v.product.status === 'ACTIVE', produs?.id ?? null, marimeText ? cat.marimi.get(marimeText.trim().toUpperCase()) ?? null : null,
     v.inventoryPolicy === 'CONTINUE']);
}

/** Toate variantele magazinului, cu stocul; cele care nu mai există în Shopify se șterg. */
async function sincronizeazaProduse(c: PoolClient, a: Acces): Promise<number> {
  const cat = await catalog(c);
  const vazute: string[] = [];
  let dupa: string | null = null;
  do {
    const d: { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: VariantaShopify[] } } =
      await gql(a, `query V($dupa: String) { productVariants(first: 100, after: $dupa) {
        pageInfo { hasNextPage endCursor } nodes { ${VARIANTA} } } }`, { dupa });
    for (const v of d.productVariants.nodes) { await scrieVarianta(c, a.magazinId, cat, v); vazute.push(v.id); }
    dupa = d.productVariants.pageInfo.hasNextPage ? d.productVariants.pageInfo.endCursor : null;
  } while (dupa);
  await produseNoi(c, a.magazinId);
  await c.query(`DELETE FROM magazin_varianta WHERE magazin_id = $1 AND NOT (varianta_gid = ANY($2))`, [a.magazinId, vazute]);
  await c.query(`UPDATE magazin SET produse_sincronizate_la = now() WHERE id = $1`, [a.magazinId]);
  return vazute.length;
}

/**
 * Produsele din Shopify care nu sunt încă în catalog (active sau ciorne) se creează aici, ca să
 * se poată da comenzi pe ele imediat: denumirea e titlul din Shopify; codul, din SKU-urile
 * variantelor (fără mărime) sau, fără SKU, din brand + titlu; modelul, din titlu fără felul hainei
 * și fără culoare („Rochie Positano Catifea Albastru" → „Positano Catifea"), găsit sau creat;
 * culoarea, de la capătul titlului. Apoi variantele se leagă de produs.
 */
export async function produseNoi(c: PoolClient, magazinId: string): Promise<number> {
  const { rows: noi } = await c.query<{ produs_gid: string; titlu: string; brand_id: string | null; activ: boolean; skus: string[] }>(
    `SELECT mv.produs_gid, min(mv.titlu_produs) AS titlu, m.brand_id, bool_or(mv.activ) AS activ,
            array_remove(array_agg(DISTINCT mv.sku), NULL) AS skus
       FROM magazin_varianta mv JOIN magazin m ON m.id = mv.magazin_id
      WHERE mv.magazin_id = $1 AND mv.produs_id IS NULL AND coalesce(btrim(mv.titlu_produs), '') <> ''
      GROUP BY mv.produs_gid, m.brand_id`, [magazinId]);
  if (!noi.length) return 0;
  const culori = (await c.query<{ id: string; nume: string }>(`SELECT id, nume FROM culoare`)).rows;
  const slug = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  let create = 0;
  for (const p of noi) {
    if (!p.brand_id) continue;
    const titlu = p.titlu.trim().replace(/\s+/g, ' ');
    const cuv = titlu.split(' ');
    // Culoarea: ultimele două sau ultimul cuvânt, dacă sunt o culoare cunoscută; altfel ultimul cuvânt.
    const cunoscuta = (n: number) => cuv.length > n ? culori.find((x) => x.nume.toLowerCase() === cuv.slice(-n).join(' ').toLowerCase()) : undefined;
    const potrivita = cunoscuta(2) ?? cunoscuta(1);
    const nCul = potrivita ? potrivita.nume.split(' ').length : cuv.length > 1 ? 1 : 0;
    const culoare = nCul ? cuv.slice(-nCul).join(' ') : null;
    const numeModel = cuv.slice(1, cuv.length - nCul).join(' ') || cuv[0];
    // Codul: prefixul comun al SKU-urilor (fără mărime); fără SKU, prefixul brandului + titlul.
    let cod = '';
    if (p.skus.length) {
      cod = p.skus.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });
      cod = p.skus.length > 1 ? cod.replace(/-[^-]*$/, '') : cod.replace(/-[^-]+$/, '');
    }
    if (!cod) {
      const { rows: [pre] } = await c.query<{ prefix: string | null }>(
        `SELECT split_part(cod_sku, '-', 1) AS prefix FROM produs WHERE brand_id = $1 AND NOT din_aplicatie GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`, [p.brand_id]);
      cod = [pre?.prefix ?? 'SHOP', slug(cuv.slice(0, cuv.length - nCul).join('')), culoare ? slug(culoare).replace(/-/g, '') : ''].filter(Boolean).join('-');
    }
    const { rows: [dublu] } = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM produs WHERE upper(cod_sku) = upper($1)`, [cod]);
    if (dublu.n) cod = `${cod}-${dublu.n + 1}`;
    const { rows: [mod] } = await c.query<{ id: string }>(
      `SELECT id FROM model WHERE brand_id = $1 AND lower(denumire) = lower($2) LIMIT 1`, [p.brand_id, numeModel]);
    const modelId = mod?.id ?? (await c.query<{ id: string }>(
      `INSERT INTO model (firma_id, brand_id, cod, denumire) VALUES (firma_curenta(), $1, $2, $3)
       ON CONFLICT (firma_id, brand_id, cod) DO UPDATE SET denumire = model.denumire RETURNING id`,
      [p.brand_id, slug(numeModel).toLowerCase(), numeModel])).rows[0].id;
    let culoareId: string | null = null;
    if (culoare) {
      culoareId = culori.find((x) => x.nume.toLowerCase() === culoare.toLowerCase())?.id
        ?? (await c.query<{ id: string }>(`INSERT INTO culoare (firma_id, nume) VALUES (firma_curenta(), $1) RETURNING id`, [culoare])).rows[0].id;
      if (!culori.some((x) => x.id === culoareId)) culori.push({ id: culoareId, nume: culoare });
    }
    const { rows: [nou] } = await c.query<{ id: string }>(
      `INSERT INTO produs (firma_id, cod_sku, denumire, brand_id, culoare_id, model_id, activ)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6)
       ON CONFLICT (firma_id, denumire) DO UPDATE SET denumire = produs.denumire RETURNING id`,
      [cod, titlu, p.brand_id, culoareId, modelId, p.activ]);
    await c.query(`UPDATE magazin_varianta SET produs_id = $1 WHERE magazin_id = $2 AND produs_gid = $3 AND produs_id IS NULL`,
      [nou.id, magazinId, p.produs_gid]);
    create++;
  }
  return create;
}

// ---------------------------------------------------------------- comenzile

const COMANDA = `
  id name createdAt updatedAt cancelledAt closedAt displayFinancialStatus displayFulfillmentStatus note tags
  totalPriceSet { shopMoney { amount } }
  shippingAddress { name phone city }
  billingAddress { name phone }
  lineItems(first: 100) { nodes { id sku title variantTitle quantity unfulfilledQuantity variant { id }
                                  originalTotalSet { shopMoney { amount } } } }`;

type ComandaShopify = {
  id: string; name: string; createdAt: string; updatedAt: string; cancelledAt: string | null; closedAt: string | null;
  displayFinancialStatus: string | null; displayFulfillmentStatus: string | null; note: string | null; tags: string[];
  totalPriceSet: { shopMoney: { amount: string } } | null;
  shippingAddress: { name: string | null; phone: string | null; city: string | null } | null;
  billingAddress: { name: string | null; phone: string | null } | null;
  lineItems: { nodes: { id: string; sku: string | null; title: string; variantTitle: string | null; quantity: number;
                        unfulfilledQuantity: number; variant: { id: string } | null;
                        originalTotalSet: { shopMoney: { amount: string } } | null }[] };
};

/** Deschisă = mai e ceva de trimis și nu e anulată, arhivată sau rambursată. Doar astea stau în aplicație. */
const deschisa = (o: ComandaShopify) =>
  !o.cancelledAt && !o.closedAt && o.displayFinancialStatus !== 'REFUNDED' && o.displayFinancialStatus !== 'VOIDED'
  && o.lineItems.nodes.some((l) => l.unfulfilledQuantity > 0);

/**
 * Pe copia de test (OCTOGON_TEST=1), clienții nu apar: numele devine „Client #25448",
 * telefonul un număr fals, dar același pentru același telefon — dublele se văd în
 * continuare. Parola contului demo o știu toți cei care testează.
 */
const peTest = process.env.OCTOGON_TEST === '1';
const telefonFals = (t: string | null) => {
  const cifre = (t ?? '').replace(/\D/g, '');
  if (cifre.length < 6) return null;
  const h = createHmac('sha256', 'octogon-test').update(cifre.slice(-9)).digest();
  return `07${String(h.readUInt32BE(0) % 100_000_000).padStart(8, '0')}`;
};

async function scrieComanda(c: PoolClient, magazinId: string, o: ComandaShopify) {
  if (!deschisa(o)) {
    await c.query(`DELETE FROM magazin_comanda WHERE magazin_id = $1 AND comanda_gid = $2`, [magazinId, o.id]);
    return;
  }
  const { rows: [{ id }] } = await c.query<{ id: string }>(
    `INSERT INTO magazin_comanda (firma_id, magazin_id, comanda_gid, nume, creata_la, actualizata_la, client, telefon, oras,
                                  stare_plata, stare_livrare, anulata_la, inchisa_la, total, nota, etichete)
     VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (magazin_id, comanda_gid) DO UPDATE SET
       nume = EXCLUDED.nume, actualizata_la = EXCLUDED.actualizata_la, client = EXCLUDED.client, telefon = EXCLUDED.telefon,
       oras = EXCLUDED.oras, stare_plata = EXCLUDED.stare_plata, stare_livrare = EXCLUDED.stare_livrare,
       anulata_la = EXCLUDED.anulata_la, inchisa_la = EXCLUDED.inchisa_la, total = EXCLUDED.total, nota = EXCLUDED.nota,
       etichete = EXCLUDED.etichete
     RETURNING id`,
    [magazinId, o.id, o.name, o.createdAt, o.updatedAt,
     peTest ? `Client ${o.name}` : o.shippingAddress?.name ?? o.billingAddress?.name ?? null,
     peTest ? telefonFals(o.shippingAddress?.phone ?? o.billingAddress?.phone ?? null) : o.shippingAddress?.phone ?? o.billingAddress?.phone ?? null,
     o.shippingAddress?.city ?? null, o.displayFinancialStatus,
     o.displayFulfillmentStatus, o.cancelledAt, o.closedAt, o.totalPriceSet?.shopMoney.amount ?? null, o.note, o.tags]);
  await c.query(`DELETE FROM magazin_comanda_linie WHERE comanda_id = $1`, [id]);
  for (const l of o.lineItems.nodes) {
    await c.query(
      `INSERT INTO magazin_comanda_linie (firma_id, comanda_id, linie_gid, varianta_gid, sku, titlu, titlu_varianta, cantitate, de_livrat)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, l.id, l.variant?.id ?? null, l.sku?.trim().toUpperCase() || null, l.title, l.variantTitle, l.quantity, l.unfulfilledQuantity]);
  }
}

/** Toate comenzile deschise; cele care nu mai sunt deschise în Shopify ies din aplicație. */
async function sincronizeazaComenzi(c: PoolClient, a: Acces): Promise<number> {
  const vazute: string[] = [];
  let dupa: string | null = null;
  do {
    const d: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: ComandaShopify[] } } =
      await gql(a, `query C($dupa: String) { orders(first: 50, after: $dupa, sortKey: CREATED_AT,
        query: "status:open AND (fulfillment_status:unfulfilled OR fulfillment_status:partial)") {
        pageInfo { hasNextPage endCursor } nodes { ${COMANDA} } } }`, { dupa });
    for (const o of d.orders.nodes) { await scrieComanda(c, a.magazinId, o); if (deschisa(o)) vazute.push(o.id); }
    dupa = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
  } while (dupa);
  await c.query(`DELETE FROM magazin_comanda WHERE magazin_id = $1 AND NOT (comanda_gid = ANY($2))`, [a.magazinId, vazute]);
  await c.query(`UPDATE magazin SET sincronizat_pana_la = now() WHERE id = $1`, [a.magazinId]);
  return vazute.length;
}

// ---------------------------------------------------------------- vânzările

/**
 * Vânzările unei comenzi, câte o linie pe SKU în `vanzare` (0011), pe brandul
 * magazinului. Ca la sincronizarea veche, contează cererea brută: o comandă anulată
 * rămâne. Aceeași comandă citită de două ori se rescrie, nu se adună.
 */
async function scrieVanzari(c: PoolClient, magazinId: string, cat: Catalog, o: ComandaShopify) {
  const pe = new Map<string, { cantitate: number; valoare: number }>();
  for (const l of o.lineItems.nodes) {
    const sku = l.sku?.trim().toUpperCase();
    if (!sku || l.quantity <= 0) continue;
    const x = pe.get(sku) ?? { cantitate: 0, valoare: 0 };
    x.cantitate += l.quantity;
    x.valoare += Number(l.originalTotalSet?.shopMoney.amount) || 0;
    pe.set(sku, x);
  }
  for (const [sku, x] of pe) {
    const produs = cat.produse.find((p) => sku.startsWith(`${p.cod_sku}-`));
    await c.query(
      `INSERT INTO vanzare (firma_id, brand_id, nr_comanda, sku, data, produs_id, marime_id, cantitate, valoare, sursa)
       SELECT firma_curenta(), m.brand_id, $2, $3, $4, $5, $6, $7, $8, 'shopify' FROM magazin m WHERE m.id = $1
       ON CONFLICT (firma_id, brand_id, nr_comanda, sku) DO UPDATE
          SET data = EXCLUDED.data, produs_id = EXCLUDED.produs_id, marime_id = EXCLUDED.marime_id,
              cantitate = EXCLUDED.cantitate, valoare = EXCLUDED.valoare, sursa = 'shopify'`,
      [magazinId, o.name, sku, o.createdAt, produs?.id ?? null,
       produs ? cat.marimi.get(sku.slice(produs.cod_sku.length + 1)) ?? null : null, x.cantitate, x.valoare]);
  }
}

/**
 * Comenzile schimbate de la ultima citire (prima dată: ultimele 60 de zile, cât dă
 * Shopify fără read_all_orders), oricare le-ar fi starea, ca vânzări.
 */
async function sincronizeazaVanzari(c: PoolClient, a: Acces): Promise<number> {
  const { rows: [m] } = await c.query<{ de_la: string }>(
    `SELECT to_char(coalesce(vanzari_pana_la - interval '1 hour', now() - interval '60 days') AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS de_la FROM magazin WHERE id = $1`, [a.magazinId]);
  const inceput = new Date().toISOString();
  const cat = await catalog(c);
  let n = 0;
  let dupa: string | null = null;
  do {
    const d: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: ComandaShopify[] } } =
      await gql(a, `query V($dupa: String, $q: String) { orders(first: 100, after: $dupa, sortKey: UPDATED_AT, query: $q) {
        pageInfo { hasNextPage endCursor } nodes { ${COMANDA} } } }`, { dupa, q: `updated_at:>='${m.de_la}'` });
    for (const o of d.orders.nodes) { await scrieVanzari(c, a.magazinId, cat, o); n++; }
    dupa = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
  } while (dupa);
  await c.query(`UPDATE magazin SET vanzari_pana_la = $2 WHERE id = $1`, [a.magazinId, inceput]);
  return n;
}

// ---------------------------------------------------------------- livrările la curier

const LIVRARE = `
  id name createdAt
  shippingAddress { name phone city }
  billingAddress { name phone }
  fulfillments(first: 10) {
    id status displayStatus createdAt deliveredAt
    trackingInfo(first: 1) { company number url }
    fulfillmentLineItems(first: 30) { nodes { quantity lineItem { title variantTitle } } }
    events(first: 30, sortKey: HAPPENED_AT) { nodes { status happenedAt message } }
  }`;

type ComandaLivrari = {
  id: string; name: string; createdAt: string;
  shippingAddress: { name: string | null; phone: string | null; city: string | null } | null;
  billingAddress: { name: string | null; phone: string | null } | null;
  fulfillments: {
    id: string; status: string; displayStatus: string | null; createdAt: string; deliveredAt: string | null;
    trackingInfo: { company: string | null; number: string | null; url: string | null }[];
    fulfillmentLineItems: { nodes: { quantity: number; lineItem: { title: string; variantTitle: string | null } }[] };
    events: { nodes: { status: string; happenedAt: string; message: string | null }[] };
  }[];
};

/**
 * Coletele unei comenzi, din evenimentele curierului: primul eveniment după AWB
 * (în tranzit, preluat) înseamnă că l-a ridicat curierul; „în livrare", livrat sau
 * eșec. La eșec, mesajele curierului spun de ce: dacă vreunul e „Refuz primire", e
 * refuz; altfel (de obicei „Retur") e colet nelivrat, întors.
 */
async function scrieLivrari(c: PoolClient, magazinId: string, o: ComandaLivrari) {
  for (const f of o.fulfillments) {
    const ev = f.events.nodes;
    const primul = (...st: string[]) => ev.find((e) => st.includes(e.status))?.happenedAt ?? null;
    const esec = [...ev].reverse().find((e) => e.status === 'FAILURE');
    const ridicat = primul('CARRIER_PICKED_UP', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILURE', 'ATTEMPTED_DELIVERY');
    const livrat = f.deliveredAt ?? primul('DELIVERED');
    // Fan Courier trimite întâi „Refuz primire", apoi „Retur" când coletul se întoarce: un refuz
    // rămâne refuz, oricare ar fi ultimul mesaj. Motivul păstrează tot drumul: „Refuz primire → Retur".
    const esecuri = ev.filter((e) => e.status === 'FAILURE');
    const refuz = esecuri.some((e) => /refuz/i.test(e.message ?? ''));
    const motiv = [...new Set(esecuri.map((e) => e.message?.trim()).filter(Boolean))].join(' → ') || null;
    // Ce contează e ultimul deznodământ: un colet refuzat și apoi relivrat e livrat.
    const ultim = [...ev].reverse().find((e) => e.status === 'DELIVERED' || e.status === 'FAILURE');
    const stare = f.status === 'CANCELLED' ? 'anulat'
      : livrat && ultim?.status !== 'FAILURE' ? 'livrat'
      : esec ? (refuz ? 'refuzat' : 'nelivrat')
      : primul('OUT_FOR_DELIVERY') ? 'in_livrare'
      : ridicat ? 'in_tranzit' : 'awb';
    const linii = f.fulfillmentLineItems.nodes;
    const t = f.trackingInfo[0];
    const telefon = o.shippingAddress?.phone ?? o.billingAddress?.phone ?? null;
    await c.query(
      `INSERT INTO magazin_livrare (firma_id, magazin_id, livrare_gid, comanda_gid, comanda, comandata_la, client, telefon, oras,
                                    produse, bucati, curier, awb, urmarire, awb_la, ridicat_la, in_livrare_la, livrat_la, esuat_la,
                                    motiv, stare, actualizat_la)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now())
       ON CONFLICT (magazin_id, livrare_gid) DO UPDATE SET
         client = EXCLUDED.client, telefon = EXCLUDED.telefon, oras = EXCLUDED.oras, produse = EXCLUDED.produse,
         bucati = EXCLUDED.bucati, curier = EXCLUDED.curier, awb = EXCLUDED.awb, urmarire = EXCLUDED.urmarire,
         ridicat_la = EXCLUDED.ridicat_la, in_livrare_la = EXCLUDED.in_livrare_la, livrat_la = EXCLUDED.livrat_la,
         esuat_la = EXCLUDED.esuat_la, motiv = EXCLUDED.motiv, stare = EXCLUDED.stare, actualizat_la = now()`,
      [magazinId, f.id, o.id, o.name, o.createdAt,
       peTest ? `Client ${o.name}` : o.shippingAddress?.name ?? o.billingAddress?.name ?? null,
       peTest ? telefonFals(telefon) : telefon, o.shippingAddress?.city ?? null,
       linii.map((l) => `${l.lineItem.title}${l.lineItem.variantTitle ? ` ${l.lineItem.variantTitle}` : ''} ×${l.quantity}`).join(', '),
       linii.reduce((s, l) => s + l.quantity, 0), t?.company ?? null, t?.number ?? null, t?.url ?? null, f.createdAt,
       ridicat, primul('OUT_FOR_DELIVERY'), livrat, esec?.happenedAt ?? null, motiv, stare]);
  }
}

/** Comenzile cu colete, schimbate de la ultima citire (prima dată: ultimele 45 de zile). */
async function sincronizeazaLivrari(c: PoolClient, a: Acces): Promise<number> {
  const { rows: [m] } = await c.query<{ de_la: string }>(
    `SELECT to_char(coalesce(livrari_pana_la - interval '1 hour', now() - interval '45 days') AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS de_la FROM magazin WHERE id = $1`, [a.magazinId]);
  const inceput = new Date().toISOString();
  let n = 0;
  let dupa: string | null = null;
  do {
    const d: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: ComandaLivrari[] } } =
      await gql(a, `query L($dupa: String, $q: String) { orders(first: 50, after: $dupa, sortKey: UPDATED_AT, query: $q) {
        pageInfo { hasNextPage endCursor } nodes { ${LIVRARE} } } }`,
        { dupa, q: `updated_at:>='${m.de_la}' AND (fulfillment_status:shipped OR fulfillment_status:partial)` });
    for (const o of d.orders.nodes) { await scrieLivrari(c, a.magazinId, o); n += o.fulfillments.length; }
    dupa = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
  } while (dupa);
  await c.query(`UPDATE magazin SET livrari_pana_la = $2 WHERE id = $1`, [a.magazinId, inceput]);
  return n;
}

export type Parte = 'produse' | 'comenzi' | 'vanzari' | 'livrari';
export type RezultatSincronizare = { magazin: string; variante?: number; comenzi?: number; vanzari?: number; livrari?: number; eroare?: string };

/**
 * Sincronizarea unui magazin sau a tuturor: variantele cu stocul, comenzile deschise,
 * vânzările și coletele de la ultima citire (sau doar unele dintre ele), fiecare în tranzacția ei — comenzile căzute nu anulează
 * stocul citit, iar un magazin căzut nu le oprește pe celelalte.
 */
export async function sincronizeaza(magazinId?: string, parti: Parte[] = ['produse', 'comenzi', 'vanzari', 'livrari']): Promise<RezultatSincronizare[]> {
  const firma = firmaDinMediu();
  const magazine = await caFirma(firma, async (c) => (await c.query<{ id: string; cod: string }>(
    `SELECT id, cod FROM magazin WHERE activ ${magazinId ? 'AND id = $1' : ''} ORDER BY cod`, magazinId ? [magazinId] : [])).rows);
  const rez: RezultatSincronizare[] = [];
  for (const m of magazine) {
    const r: RezultatSincronizare = { magazin: m.cod };
    try {
      const a = await caFirma(firma, (c) => acces(c, m.id));
      if (!a) { rez.push({ ...r, eroare: 'nelegat' }); continue; }
      if (parti.includes('produse')) r.variante = await caFirma(firma, (c) => sincronizeazaProduse(c, a));
      if (parti.includes('comenzi')) r.comenzi = await caFirma(firma, (c) => sincronizeazaComenzi(c, a));
      if (parti.includes('vanzari')) r.vanzari = await caFirma(firma, (c) => sincronizeazaVanzari(c, a));
      if (parti.includes('livrari')) r.livrari = await caFirma(firma, (c) => sincronizeazaLivrari(c, a));
    } catch (e) {
      r.eroare = (e as Error).message;
    }
    rez.push(r);
  }
  return rez;
}

// ---------------------------------------------------------------- Shopify Payments

type Bani = { amount: string };

/**
 * Încasările cu cardul ale unui magazin, din Shopify Payments, de la `de` încoace:
 * fiecare tranzacție (plată, rambursare, ajustare) cu comisionul și netul ei, și
 * viramentele către bancă. Cere permisiunile read_shopify_payments_*; fără ele,
 * eroarea spune ce lipsește.
 */
export async function citestePlatiCard(c: PoolClient, magazinId: string, de: string): Promise<number> {
  try {
    return await citestePlatiCardFaraMesaj(c, magazinId, de);
  } catch (e) {
    if (/access denied|access scope/i.test((e as Error).message)) {
      throw new EroareShopify('lipsesc permisiunile Shopify Payments: adaugă-le în aplicația din Dev Dashboard și apasă din nou Instalează în Legături Shopify');
    }
    throw e;
  }
}

async function citestePlatiCardFaraMesaj(c: PoolClient, magazinId: string, de: string): Promise<number> {
  const a = await acces(c, magazinId);
  if (!a) throw new EroareShopify('magazin nelegat');
  let n = 0;
  let dupa: string | null = null;
  do {
    const d: { shopifyPaymentsAccount: { balanceTransactions: { pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: { id: string; type: string; test: boolean; transactionDate: string; amount: Bani; fee: Bani; net: Bani;
               associatedOrder: { name: string } | null; associatedPayout: { id: string | null; status: string | null } }[] } } | null } = await gql(a,
      `query T($q: String!, $dupa: String) { shopifyPaymentsAccount { balanceTransactions(first: 100, after: $dupa, query: $q, hideTransfers: true) {
         pageInfo { hasNextPage endCursor }
         nodes { id type test transactionDate amount { amount } fee { amount } net { amount } associatedOrder { name } associatedPayout { id status } } } } }`,
      { q: `processed_at:>=${de}`, dupa });
    const lista = d.shopifyPaymentsAccount?.balanceTransactions;
    if (!lista) break;
    for (const t of lista.nodes.filter((x) => !x.test)) {
      await c.query(
        `INSERT INTO card_tranzactie (firma_id, magazin_id, id, tip, data, comanda, suma, comision, net, virament_id, virament_stare)
         VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (magazin_id, id) DO UPDATE SET virament_id = EXCLUDED.virament_id, virament_stare = EXCLUDED.virament_stare,
           suma = EXCLUDED.suma, comision = EXCLUDED.comision, net = EXCLUDED.net`,
        [magazinId, t.id, t.type, t.transactionDate, t.associatedOrder?.name ?? null, Number(t.amount.amount), Number(t.fee.amount),
         Number(t.net.amount), t.associatedPayout.id, t.associatedPayout.status]);
      n++;
    }
    dupa = lista.pageInfo.hasNextPage ? lista.pageInfo.endCursor : null;
  } while (dupa);

  // Viramentele, cele mai noi întâi, până la data de început.
  dupa = null;
  do {
    const d: { shopifyPaymentsAccount: { payouts: { pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: { id: string; issuedAt: string; status: string; net: Bani; summary: { chargesGross: Bani; chargesFee: Bani } }[] } } | null } = await gql(a,
      `query P($dupa: String) { shopifyPaymentsAccount { payouts(first: 50, after: $dupa, reverse: true) {
         pageInfo { hasNextPage endCursor }
         nodes { id issuedAt status net { amount } summary { chargesGross { amount } chargesFee { amount } } } } } }`, { dupa });
    const lista = d.shopifyPaymentsAccount?.payouts;
    if (!lista) break;
    for (const p of lista.nodes) {
      await c.query(
        `INSERT INTO card_virament (firma_id, magazin_id, id, data, stare, net, brut, comision)
         VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (magazin_id, id) DO UPDATE SET stare = EXCLUDED.stare, net = EXCLUDED.net, brut = EXCLUDED.brut, comision = EXCLUDED.comision`,
        [magazinId, p.id, p.issuedAt, p.status, Number(p.net.amount), Number(p.summary.chargesGross.amount), Number(p.summary.chargesFee.amount)]);
    }
    const ultimul = lista.nodes[lista.nodes.length - 1];
    dupa = lista.pageInfo.hasNextPage && ultimul && ultimul.issuedAt.slice(0, 10) >= de ? lista.pageInfo.endCursor : null;
  } while (dupa);
  return n;
}

// ---------------------------------------------------------------- după instalare

const SUBIECTE = ['ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_CANCELLED', 'ORDERS_DELETE', 'INVENTORY_LEVELS_UPDATE',
                  'PRODUCTS_CREATE', 'PRODUCTS_UPDATE', 'PRODUCTS_DELETE', 'APP_UNINSTALLED'];

/** Tokenul se salvează criptat pe magazinul brandului ales; apoi webhook-urile și prima sincronizare. */
export async function legaMagazin(magazinId: string, domeniu: string, token: string, permisiuni: string): Promise<void> {
  await caFirma(firmaDinMediu(), async (c) => {
    await c.query(`UPDATE magazin SET domeniu = NULL WHERE domeniu = $1 AND id <> $2`, [domeniu, magazinId]);
    await c.query(
      `UPDATE magazin SET domeniu = $2, token_criptat = $3, permisiuni = $4, instalat_la = now(), activ = true WHERE id = $1`,
      [magazinId, domeniu, cripteaza(token), permisiuni]);
  });
  const a = { magazinId, domeniu, token };
  for (const subiect of SUBIECTE) {
    const d = await gql<{ webhookSubscriptionCreate: { userErrors: { message: string }[] } }>(a,
      `mutation W($s: WebhookSubscriptionTopic!, $u: URL!) {
         webhookSubscriptionCreate(topic: $s, webhookSubscription: { callbackUrl: $u, format: JSON }) { userErrors { message } } }`,
      { s: subiect, u: `${mediu('APP_URL')}/shopify/webhook` });
    // „already taken" = era deja abonat, de la o instalare anterioară
    const erori = d.webhookSubscriptionCreate.userErrors.filter((e) => !/taken|exist/i.test(e.message));
    if (erori.length) throw new EroareShopify(`Webhook ${subiect}: ${erori.map((e) => e.message).join('; ')}`);
  }
  await sincronizeaza(magazinId);
}

// ---------------------------------------------------------------- webhook-uri

/**
 * Un webhook nu se crede pe cuvânt: din el se ia doar ce s-a schimbat (comanda,
 * articolul de stoc, produsul), iar starea se citește proaspăt din Shopify. Așa
 * comenzile și variantele trec printr-un singur drum, oricât de des vin.
 */
export async function primesteWebhook(domeniu: string, subiect: string, corp: Record<string, unknown>): Promise<void> {
  await caFirma(firmaDinMediu(), async (c) => {
    const { rows: [m] } = await c.query<{ id: string }>(`SELECT id FROM magazin WHERE domeniu = $1`, [domeniu]);
    if (!m) return;
    if (subiect === 'app/uninstalled' || subiect === 'shop/redact') {
      await c.query(`UPDATE magazin SET token_criptat = NULL, instalat_la = NULL WHERE id = $1`, [m.id]);
      await c.query(`DELETE FROM magazin_comanda WHERE magazin_id = $1`, [m.id]);
      await c.query(`DELETE FROM magazin_varianta WHERE magazin_id = $1`, [m.id]);
      return;
    }
    if (subiect === 'customers/redact') {
      // Datele clientului stau doar pe comenzile deschise; le ștergem pe ale lui.
      const ids = ((corp.orders_to_redact as number[] | undefined) ?? []).map((n) => `gid://shopify/Order/${n}`);
      if (ids.length) await c.query(`DELETE FROM magazin_comanda WHERE magazin_id = $1 AND comanda_gid = ANY($2)`, [m.id, ids]);
      return;
    }
    if (subiect.startsWith('customers/')) return;
    // Ștergerile nu au nevoie de Shopify: ce s-a șters iese și de aici.
    if (subiect === 'orders/delete') {
      await c.query(`DELETE FROM magazin_comanda WHERE magazin_id = $1 AND comanda_gid = $2`, [m.id, `gid://shopify/Order/${corp.id}`]);
      return;
    }
    if (subiect === 'products/delete') {
      await c.query(`DELETE FROM magazin_varianta WHERE magazin_id = $1 AND produs_gid = $2`, [m.id, `gid://shopify/Product/${corp.id}`]);
      return;
    }
    const a = await acces(c, m.id);
    if (!a) return;
    if (subiect.startsWith('orders/')) {
      const d = await gql<{ order: ComandaShopify | null }>(a, `query O($id: ID!) { order(id: $id) { ${COMANDA} } }`,
        { id: String(corp.admin_graphql_api_id ?? `gid://shopify/Order/${corp.id}`) });
      if (d.order) { await scrieComanda(c, m.id, d.order); await scrieVanzari(c, m.id, await catalog(c), d.order); }
    } else if (subiect === 'inventory_levels/update') {
      const d = await gql<{ inventoryItem: { variant: VariantaShopify | null } | null }>(a,
        `query I($id: ID!) { inventoryItem(id: $id) { variant { ${VARIANTA} } } }`,
        { id: `gid://shopify/InventoryItem/${corp.inventory_item_id}` });
      if (d.inventoryItem?.variant) await scrieVarianta(c, m.id, await catalog(c), d.inventoryItem.variant);
    } else if (subiect.startsWith('products/')) {
      const gid = String(corp.admin_graphql_api_id ?? `gid://shopify/Product/${corp.id}`);
      const d = await gql<{ product: { variants: { nodes: VariantaShopify[] } } | null }>(a,
        `query P($id: ID!) { product(id: $id) { variants(first: 100) { nodes { ${VARIANTA} } } } }`, { id: gid });
      const cat = await catalog(c);
      const vazute = (d.product?.variants.nodes ?? []).map((v) => v.id);
      for (const v of d.product?.variants.nodes ?? []) await scrieVarianta(c, m.id, cat, v);
      await c.query(`DELETE FROM magazin_varianta WHERE magazin_id = $1 AND produs_gid = $2 AND NOT (varianta_gid = ANY($3))`,
        [m.id, gid, vazute]);
    }
  });
}
