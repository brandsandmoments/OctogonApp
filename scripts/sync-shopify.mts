/**
 * Sincronizarea vânzărilor din Shopify.
 *
 *   npm run sync:shopify                      — toate magazinele configurate
 *   npm run sync:shopify -- --de-la 2026-09-01 — de la o dată, nu de la ultima sincronizare
 *   npm run sync:shopify -- --din-fisier pagini.json --magazin SLEEVY
 *                                             — din răspunsuri salvate, fără rețea (pentru verificare)
 *
 * Fiecare magazin din tabela `magazin` își ia domeniul și tokenul din mediu:
 * SHOPIFY_SHOP_<COD> (ex. sleevy.myshopify.com) și SHOPIFY_TOKEN_<COD> (tokenul unei
 * aplicații custom cu acces read_orders). Un magazin fără ele e sărit, cu mesaj.
 *
 * Citește comenzile modificate de la ultima sincronizare și scrie câte o linie pe
 * comandă și SKU în `vanzare`. Anulările se păstrează: ca în dashboard, măsurăm
 * cererea brută, nu ce a rămas după retururi. Brandul vine din produs, nu din
 * magazin — un magazin poate vinde mai multe branduri; magazinul dă brandul doar
 * când SKU-ul nu e în catalog. Ce a venit din Shopify înlocuiește ce fusese
 * importat din dashboard pentru aceeași comandă și același SKU.
 */
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { caFirma, firmaDinMediu } from '../app/lib/db.ts';

const VERSIUNE_API = '2025-07';

const INTEROGARE = `
  query Comenzi($first: Int!, $after: String, $q: String) {
    orders(first: $first, after: $after, query: $q, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name createdAt updatedAt cancelledAt
        lineItems(first: 100) { nodes { sku quantity originalTotalSet { shopMoney { amount } } } }
      }
    }
  }`;

type Comanda = {
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  lineItems: { nodes: { sku: string | null; quantity: number; originalTotalSet: { shopMoney: { amount: string } } }[] };
};
type Pagina = { data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Comanda[] } } };

// ---------------------------------------------------------------- citire

async function* paginiDinShopify(shop: string, token: string, deLa: string): AsyncGenerator<Pagina> {
  let after: string | null = null;
  for (;;) {
    const r = await fetch(`https://${shop}/admin/api/${VERSIUNE_API}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query: INTEROGARE, variables: { first: 100, after, q: `updated_at:>='${deLa}'` } }),
    });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 2000)); continue; } // limită de rată: așteptăm
    if (!r.ok) throw new Error(`${shop}: Shopify a răspuns ${r.status} ${await r.text()}`);
    const p = (await r.json()) as Pagina & { errors?: unknown };
    if (p.errors) throw new Error(`${shop}: ${JSON.stringify(p.errors)}`);
    yield p;
    if (!p.data.orders.pageInfo.hasNextPage) return;
    after = p.data.orders.pageInfo.endCursor;
  }
}

async function* paginiDinFisier(fisier: string): AsyncGenerator<Pagina> {
  const continut = JSON.parse(readFileSync(fisier, 'utf8')) as Pagina | Pagina[];
  for (const p of Array.isArray(continut) ? continut : [continut]) yield p;
}

// ---------------------------------------------------------------- scriere

type Catalog = {
  produse: { id: string; cod_sku: string; brand_id: string }[];
  marimi: Map<string, string>;
};

async function catalog(c: PoolClient): Promise<Catalog> {
  const produse = (await c.query<Catalog['produse'][number]>(`SELECT id, cod_sku, brand_id FROM produs`)).rows
    .sort((a, b) => b.cod_sku.length - a.cod_sku.length); // cel mai lung prefix câștigă
  const marimi = new Map<string, string>();
  for (const m of (await c.query<{ id: string; cod: string }>(`SELECT id, cod FROM marime`)).rows) marimi.set(m.cod.toUpperCase(), m.id);
  for (const a of (await c.query<{ marime_id: string; alias: string }>(`SELECT marime_id, alias FROM marime_alias`)).rows) {
    if (!marimi.has(a.alias.toUpperCase())) marimi.set(a.alias.toUpperCase(), a.marime_id);
  }
  return { produse, marimi };
}

type Rezultat = { comenzi: number; linii: number; necunoscute: Set<string>; panaLa: string | null };

/** Scrie o pagină de comenzi. Liniile cu același SKU din aceeași comandă se adună într-una. */
async function scriePagina(c: PoolClient, cat: Catalog, brandMagazin: string, p: Pagina, r: Rezultat) {
  for (const o of p.data.orders.nodes) {
    r.comenzi++;
    if (!r.panaLa || o.updatedAt > r.panaLa) r.panaLa = o.updatedAt;
    const pe = new Map<string, { cantitate: number; valoare: number }>();
    for (const l of o.lineItems.nodes) {
      const sku = l.sku?.trim().toUpperCase();
      if (!sku || l.quantity <= 0) continue;
      const x = pe.get(sku) ?? { cantitate: 0, valoare: 0 };
      x.cantitate += l.quantity;
      x.valoare += Number(l.originalTotalSet.shopMoney.amount) || 0;
      pe.set(sku, x);
    }
    for (const [sku, x] of pe) {
      const produs = cat.produse.find((pr) => sku.startsWith(`${pr.cod_sku.toUpperCase()}-`));
      if (!produs) r.necunoscute.add(sku);
      await c.query(
        `INSERT INTO vanzare (firma_id, brand_id, nr_comanda, sku, data, produs_id, marime_id, cantitate, valoare, sursa)
         VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8, 'shopify')
         ON CONFLICT (firma_id, brand_id, nr_comanda, sku) DO UPDATE
            SET data = EXCLUDED.data, produs_id = EXCLUDED.produs_id, marime_id = EXCLUDED.marime_id,
                cantitate = EXCLUDED.cantitate, valoare = EXCLUDED.valoare, sursa = 'shopify'`,
        [produs?.brand_id ?? brandMagazin, o.name, sku, o.createdAt, produs?.id ?? null,
         produs ? cat.marimi.get(sku.slice(produs.cod_sku.length + 1)) ?? null : null, x.cantitate, x.valoare]);
      r.linii++;
    }
  }
}

// ---------------------------------------------------------------- pornire

function argument(nume: string): string | undefined {
  const i = process.argv.indexOf(`--${nume}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const deLaArg = argument('de-la');
const dinFisier = argument('din-fisier');
const doarMagazin = argument('magazin')?.toUpperCase();
if (dinFisier && !doarMagazin) {
  console.error('Cu --din-fisier, spune și --magazin <COD>: brandul de rezervă vine din magazin.');
  process.exit(1);
}

const magazine = await caFirma(firmaDinMediu(), async (c) => (await c.query<{
  id: string; cod: string; brand_id: string; sincronizat_pana_la: string | null;
}>(`SELECT id, cod, brand_id, sincronizat_pana_la::text FROM magazin WHERE activ ORDER BY cod`)).rows);

for (const m of magazine) {
  if (doarMagazin && m.cod !== doarMagazin) continue;
  const shop = process.env[`SHOPIFY_SHOP_${m.cod}`];
  const token = process.env[`SHOPIFY_TOKEN_${m.cod}`];
  if (!dinFisier && (!shop || !token)) {
    console.log(`  ${m.cod}: sărit — lipsesc SHOPIFY_SHOP_${m.cod} și/sau SHOPIFY_TOKEN_${m.cod} în .env`);
    continue;
  }
  // Fără o sincronizare anterioară, se pornește cu 60 de zile în urmă; VANZARI din
  // dashboard acoperă oricum istoricul de dinainte.
  const deLa = deLaArg ?? m.sincronizat_pana_la ?? new Date(Date.now() - 60 * 86_400_000).toISOString();
  const r: Rezultat = { comenzi: 0, linii: 0, necunoscute: new Set(), panaLa: null };

  // Fiecare magazin într-o tranzacție: o sincronizare oprită la jumătate nu mută
  // data de sincronizare, deci data viitoare se reia de unde era.
  await caFirma(firmaDinMediu(), async (c) => {
    const cat = await catalog(c);
    const pagini = dinFisier ? paginiDinFisier(dinFisier) : paginiDinShopify(shop!, token!, deLa);
    for await (const p of pagini) await scriePagina(c, cat, m.brand_id, p, r);
    if (!dinFisier && r.panaLa) {
      await c.query(`UPDATE magazin SET sincronizat_pana_la = $2 WHERE id = $1`, [m.id, r.panaLa]);
    }
  });

  console.log(`  ${m.cod}: ${r.comenzi} comenzi, ${r.linii} linii de vânzare${dinFisier ? ' (din fișier)' : ` de la ${deLa}`}`);
  if (r.necunoscute.size) {
    console.log(`     ${r.necunoscute.size} SKU-uri necunoscute în catalog, păstrate fără produs: ${[...r.necunoscute].slice(0, 8).join(', ')}`);
  }
}
process.exit(0);
