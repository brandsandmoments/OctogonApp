import type { LinieNoua } from './comenzi';
import { interogare } from './sesiune';

/**
 * Comenzile deschise din magazinele Shopify, împărțite după ce se poate face cu ele
 * azi, din stocul fizic al fiecărui magazin:
 *
 * - livrabilă: tot ce e pe comandă e pe stoc — merge la picking (single = un singur
 *   produs pe comandă, multi = mai multe, culese împreună);
 * - de sunat: avem doar o parte — clientul e sunat și i se oferă ce avem;
 * - fără stoc: nu avem nimic de trimis — alternativă sau restoc.
 *
 * Stocul se împarte întâi comenzilor care pot pleca întregi, de la cea mai veche la
 * cea mai nouă; ce rămâne merge, tot în ordinea vechimii, comenzilor parțiale. Așa
 * o bucată nu stă blocată pe o comandă care oricum așteaptă un telefon, cât timp
 * alta ar putea pleca azi întreagă.
 *
 * O comandă e „posibil dublă" când același telefon are mai multe comenzi deschise
 * în același magazin; „aceeași variantă" când se repetă și produsul — de verificat
 * înainte de expediere.
 */

export type Situatie = 'livrabila' | 'de_sunat' | 'fara_stoc';

export type LinieClasificata = {
  sku: string | null;
  produs: string;          // „Costum Artemis Negru"
  tip: string;             // „Costum"
  model: string;           // „Artemis"
  culoare: string;
  marime: string;
  bucati: number;          // de trimis
  stoc: number;            // stoc fizic al variantei în magazin
  pe_stoc: boolean;        // ajunge stocul pentru linia asta
};

export type ComandaClasificata = {
  id: string;
  magazin_id: string;
  magazin: string;         // brandul
  nume: string;            // „#25448"
  creata_la: string;
  zile: number;            // de când așteaptă
  client: string | null;
  telefon: string | null;
  oras: string | null;
  plata: string | null;
  situatie: Situatie;
  multi: boolean;          // mai multe produse pe comandă
  bucati: number;
  linii: LinieClasificata[];
  dubla: null | { cu: string[]; aceeasi_varianta: boolean };
};

export type Magazin = {
  id: string;
  cod: string;
  brand: string;
  domeniu: string | null;
  legat: boolean;
  sincronizat_la: string | null;
};

type RandLinie = {
  comanda_id: string; magazin_id: string; magazin: string; nume: string; creata_la: string; client: string | null;
  telefon: string | null; oras: string | null; plata: string | null; varianta_gid: string | null; sku: string | null;
  titlu: string; titlu_varianta: string | null; de_livrat: number; stoc: number | null; optiuni: Record<string, string> | null;
  tip_produs: string | null;
};

const OPT_MARIME = /^(m[aă]rime|size|talie|marimea)$/i;
const OPT_CULOARE = /^(culoare|color|colour|culoarea)$/i;

/** „Costum Artemis Negru" → tip „Costum", model „Artemis", culoare „Negru"; opțiunile variantei au întâietate. */
function descrie(r: RandLinie): Pick<LinieClasificata, 'tip' | 'model' | 'culoare' | 'marime'> {
  const cuvinte = r.titlu.trim().split(/\s+/);
  const opt = Object.entries(r.optiuni ?? {});
  const din = (re: RegExp) => opt.find(([k]) => re.test(k))?.[1];
  const parti = (r.titlu_varianta ?? '').split('/').map((s) => s.trim()).filter(Boolean);
  return {
    tip: r.tip_produs || cuvinte[0] || '',
    model: cuvinte.length > 1 ? cuvinte[1] : cuvinte[0] ?? '',
    culoare: din(OPT_CULOARE) ?? (cuvinte.length > 2 ? cuvinte.slice(2).join(' ') : parti.length > 1 ? parti[0] : ''),
    marime: din(OPT_MARIME) ?? parti[parti.length - 1] ?? '',
  };
}

const telefonCheie = (t: string | null) => {
  const cifre = (t ?? '').replace(/\D/g, '');
  return cifre.length >= 9 ? cifre.slice(-9) : null;
};

export async function magazine(): Promise<Magazin[]> {
  return interogare<Magazin>(
    `SELECT m.id, m.cod, b.nume AS brand, m.domeniu, (m.token_criptat IS NOT NULL) AS legat,
            to_char(greatest(m.sincronizat_pana_la, m.produse_sincronizate_la) AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI') AS sincronizat_la
       FROM magazin m JOIN brand b ON b.id = m.brand_id
      WHERE m.activ ORDER BY b.nume`);
}

/** Comenzile deschise ale tuturor magazinelor, clasificate; cele mai vechi întâi. */
export async function comenziMagazine(): Promise<ComandaClasificata[]> {
  const randuri = await interogare<RandLinie>(
    `SELECT mc.id AS comanda_id, mc.magazin_id, b.nume AS magazin, mc.nume,
            to_char(mc.creata_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD') AS creata_la,
            mc.client, mc.telefon, mc.oras, mc.stare_plata AS plata,
            l.varianta_gid, l.sku, l.titlu, l.titlu_varianta, l.de_livrat,
            coalesce(v.stoc_fizic, vs.stoc_fizic) AS stoc, coalesce(v.optiuni, vs.optiuni) AS optiuni,
            coalesce(v.tip_produs, vs.tip_produs) AS tip_produs
       FROM magazin_comanda mc
       JOIN magazin m ON m.id = mc.magazin_id
       JOIN brand b ON b.id = m.brand_id
       JOIN magazin_comanda_linie l ON l.comanda_id = mc.id AND l.de_livrat > 0
       LEFT JOIN magazin_varianta v ON v.magazin_id = mc.magazin_id AND v.varianta_gid = l.varianta_gid
       -- Fără variantă pe linie (produs șters și refăcut), după SKU.
       LEFT JOIN LATERAL (SELECT stoc_fizic, optiuni, tip_produs FROM magazin_varianta
                           WHERE l.varianta_gid IS NULL AND magazin_id = mc.magazin_id AND sku = l.sku LIMIT 1) vs ON true
      ORDER BY mc.creata_la, mc.nume, l.titlu`);

  const comenzi = new Map<string, { r: RandLinie; linii: RandLinie[] }>();
  for (const r of randuri) {
    const c = comenzi.get(r.comanda_id) ?? { r, linii: [] };
    c.linii.push(r);
    comenzi.set(r.comanda_id, c);
  }
  const lista = [...comenzi.values()];

  // Stocul fizic, pe magazin și variantă (sau SKU, când linia n-are variantă).
  const ramas = new Map<string, number>();
  const cheie = (r: RandLinie) => `${r.magazin_id}|${r.varianta_gid ?? `sku:${r.sku}`}`;
  for (const r of randuri) if (!ramas.has(cheie(r))) ramas.set(cheie(r), Math.max(0, r.stoc ?? 0));

  const situatie = new Map<string, Situatie>();
  const peStoc = new Map<RandLinie, boolean>();
  // 1. Comenzile care pleacă întregi, de la cea mai veche.
  for (const c of lista) {
    const nevoie = new Map<string, number>();
    for (const l of c.linii) nevoie.set(cheie(l), (nevoie.get(cheie(l)) ?? 0) + l.de_livrat);
    if ([...nevoie].every(([k, n]) => (ramas.get(k) ?? 0) >= n)) {
      for (const [k, n] of nevoie) ramas.set(k, ramas.get(k)! - n);
      c.linii.forEach((l) => peStoc.set(l, true));
      situatie.set(c.r.comanda_id, 'livrabila');
    }
  }
  // 2. Restul, cu ce a rămas: o linie e pe stoc doar dacă ajunge întreagă.
  for (const c of lista) {
    if (situatie.has(c.r.comanda_id)) continue;
    let ceva = false;
    for (const l of c.linii) {
      const k = cheie(l);
      const ok = (ramas.get(k) ?? 0) >= l.de_livrat;
      if (ok) { ramas.set(k, ramas.get(k)! - l.de_livrat); ceva = true; }
      peStoc.set(l, ok);
    }
    situatie.set(c.r.comanda_id, ceva ? 'de_sunat' : 'fara_stoc');
  }

  // Posibile duble: același telefon, mai multe comenzi deschise în același magazin.
  const peTelefon = new Map<string, typeof lista>();
  for (const c of lista) {
    const t = telefonCheie(c.r.telefon);
    if (!t) continue;
    const k = `${c.r.magazin_id}|${t}`;
    peTelefon.set(k, [...(peTelefon.get(k) ?? []), c]);
  }
  const duble = new Map<string, { cu: string[]; aceeasi_varianta: boolean }>();
  for (const grup of peTelefon.values()) {
    if (grup.length < 2) continue;
    for (const c of grup) {
      const altele = grup.filter((x) => x !== c);
      const variante = new Set(c.linii.map(cheie));
      duble.set(c.r.comanda_id, {
        cu: altele.map((x) => x.r.nume),
        aceeasi_varianta: altele.some((x) => x.linii.some((l) => variante.has(cheie(l)))),
      });
    }
  }

  const azi = Date.parse(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' }));
  return lista.map(({ r, linii }) => ({
    id: r.comanda_id, magazin_id: r.magazin_id, magazin: r.magazin, nume: r.nume, creata_la: r.creata_la,
    zile: Math.round((azi - Date.parse(r.creata_la)) / 86_400_000),
    client: r.client, telefon: r.telefon, oras: r.oras, plata: r.plata,
    situatie: situatie.get(r.comanda_id)!,
    multi: linii.length > 1,
    bucati: linii.reduce((s, l) => s + l.de_livrat, 0),
    linii: linii.map((l) => ({
      sku: l.sku, produs: l.titlu, ...descrie(l), bucati: l.de_livrat, stoc: l.stoc ?? 0, pe_stoc: peStoc.get(l) ?? false,
    })),
    dubla: duble.get(r.comanda_id) ?? null,
  }));
}

export type LipsuriPsc = { brand_id: string; brand: string; linii: LinieNoua[]; bucati: number; necunoscute: number };

/**
 * Ce lipsește ca să poată pleca toate comenzile deschise ale unui magazin: pe
 * fiecare variantă, cererea din comenzi minus stocul fizic. Ies liniile unei PSC
 * (produs și mărime din catalogul aplicației), cu termen peste 14 zile; omul le vede
 * în formularul de comandă și le schimbă înainte să salveze. Variantele fără produs
 * sau mărime în catalog nu pot intra și se numără separat.
 */
export async function lipsuriPentruPsc(magazinId: string): Promise<LipsuriPsc | null> {
  const randuri = await interogare<{ brand_id: string; brand: string; produs_id: string | null; marime_id: string | null; lipsa: number }>(
    `WITH cerere AS (
       SELECT l.varianta_gid, sum(l.de_livrat)::int AS cerut
         FROM magazin_comanda mc JOIN magazin_comanda_linie l ON l.comanda_id = mc.id AND l.de_livrat > 0
        WHERE mc.magazin_id = $1 AND l.varianta_gid IS NOT NULL
        GROUP BY l.varianta_gid)
     SELECT m.brand_id, b.nume AS brand, v.produs_id, v.marime_id, (c.cerut - greatest(v.stoc_fizic, 0))::int AS lipsa
       FROM cerere c
       JOIN magazin_varianta v ON v.magazin_id = $1 AND v.varianta_gid = c.varianta_gid
       JOIN magazin m ON m.id = v.magazin_id JOIN brand b ON b.id = m.brand_id
      WHERE c.cerut > greatest(v.stoc_fizic, 0)`, [magazinId]);
  if (randuri.length === 0) {
    const [m] = await interogare<{ brand_id: string; brand: string }>(
      `SELECT m.brand_id, b.nume AS brand FROM magazin m JOIN brand b ON b.id = m.brand_id WHERE m.id = $1`, [magazinId]);
    return m ? { ...m, linii: [], bucati: 0, necunoscute: 0 } : null;
  }
  const termen = new Date(Date.now() + 14 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' });
  const pe = new Map<string, LinieNoua>();
  let necunoscute = 0;
  for (const r of randuri) {
    if (!r.produs_id || !r.marime_id) { necunoscute += r.lipsa; continue; }
    const l = pe.get(r.produs_id) ?? { produsId: r.produs_id, dataCeruta: termen, vanzareDeLa: '', vanzarePanaLa: '', cantitati: {} };
    l.cantitati[r.marime_id] = (l.cantitati[r.marime_id] ?? 0) + r.lipsa;
    pe.set(r.produs_id, l);
  }
  const linii = [...pe.values()];
  return {
    brand_id: randuri[0].brand_id, brand: randuri[0].brand, linii, necunoscute,
    bucati: linii.reduce((s, l) => s + Object.values(l.cantitati).reduce((a, q) => a + q, 0), 0),
  };
}
