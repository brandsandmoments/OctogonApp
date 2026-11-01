import { interogare } from './sesiune';

/**
 * Produsele fiecărui magazin Shopify, cu stocul și vânzările lor, și alertele care
 * ies din ele:
 *
 * - se termină: o mărime care, la ritmul ultimelor 30 de zile, mai ține mai puțin
 *   de `alerta_zile_stoc` zile (sau s-a terminat deja și încă se cere);
 * - nu se mișcă: un produs cu cel puțin `stoc_mort_min_buc` bucăți și nicio vânzare
 *   în ultimele `stoc_mort_zile` zile;
 * - trend: ultimele 7 zile vând de `trend_factor` ori mai mult decât media
 *   săptămânală din cele 23 de zile dinainte (cel puțin `trend_min_buc` bucăți).
 *
 * Vânzările vin din `vanzare`, pe brandul magazinului și pe SKU-ul variantei.
 * Shopify dă aplicației comenzile din ultimele 60 de zile, deci istoria are 60 de zile.
 */

export type Marime = { marime: string; stoc: number; v7: number; v30: number; zile: number | null };

export type ProdusMagazin = {
  magazin_id: string;
  magazin: string;
  produs: string;          // „Costum Artemis Negru"
  tip: string | null;
  activ: boolean;
  stoc: number;            // stoc fizic, fără negative
  v7: number;
  v30: number;
  v60: number;
  ritm: number;            // bucăți pe zi, din ultimele 30 de zile
  zile: number | null;     // cât mai ține stocul la ritmul ăsta; null = nu se vinde
  ultima: string | null;   // ultima vânzare, YYYY-MM-DD
  marimi: Marime[];
  semnale: { se_termina: Marime[]; stoc_mort: boolean; trend: number | null };
};

export type Praguri = { alerta_zile_stoc: number; stoc_mort_zile: number; stoc_mort_min_buc: number; trend_factor: number; trend_min_buc: number };

const IMPLICITE: Praguri = { alerta_zile_stoc: 14, stoc_mort_zile: 30, stoc_mort_min_buc: 3, trend_factor: 2, trend_min_buc: 5 };

export async function praguri(): Promise<Praguri> {
  const r = await interogare<{ cheie: keyof Praguri; valoare: string }>(
    `SELECT cheie, valoare::text FROM parametru WHERE cheie = ANY($1)`, [Object.keys(IMPLICITE)]);
  return { ...IMPLICITE, ...Object.fromEntries(r.map((x) => [x.cheie, Number(x.valoare)])) };
}

const ORDINE = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL'];
const rang = (m: string) => { const i = ORDINE.indexOf(m.toUpperCase()); return i >= 0 ? i : 100 + (Number(m) || 0); };
const OPT_MARIME = /^(m[aă]rime|size|talie|marimea)$/i;

type Rand = {
  magazin_id: string; magazin: string; titlu_produs: string; tip_produs: string | null; activ: boolean;
  optiuni: Record<string, string>; titlu_varianta: string | null; stoc: number; v7: number; v30: number; v60: number;
  ultima: string | null; mort: number;
};

/** Produsele magazinelor (sau ale unuia), cu vânzările și semnalele lor. */
export async function produseMagazine(magazinId?: string): Promise<ProdusMagazin[]> {
  const p = await praguri();
  const randuri = await interogare<Rand>(
    `WITH s AS (
       SELECT v.brand_id, v.sku,
              sum(v.cantitate) FILTER (WHERE v.data >= now() - interval '7 days')::int  AS v7,
              sum(v.cantitate) FILTER (WHERE v.data >= now() - interval '30 days')::int AS v30,
              sum(v.cantitate) FILTER (WHERE v.data >= now() - interval '60 days')::int AS v60,
              sum(v.cantitate) FILTER (WHERE v.data >= now() - make_interval(days => $2::int))::int AS mort,
              to_char(max(v.data) AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD') AS ultima
         FROM vanzare v GROUP BY v.brand_id, v.sku)
     SELECT mv.magazin_id, b.nume AS magazin, mv.titlu_produs, mv.tip_produs, mv.activ, mv.optiuni, mv.titlu_varianta,
            mv.stoc_fizic AS stoc, coalesce(s.v7, 0) AS v7, coalesce(s.v30, 0) AS v30, coalesce(s.v60, 0) AS v60,
            s.ultima, coalesce(s.mort, 0) AS mort
       FROM magazin_varianta mv
       JOIN magazin m ON m.id = mv.magazin_id
       JOIN brand b   ON b.id = m.brand_id
       LEFT JOIN s    ON s.brand_id = m.brand_id AND s.sku = mv.sku
      WHERE ($1::uuid IS NULL OR mv.magazin_id = $1)
      ORDER BY b.nume, mv.titlu_produs`, [magazinId ?? null, p.stoc_mort_zile]);

  const pe = new Map<string, { r: Rand; variante: Rand[] }>();
  for (const r of randuri) {
    const k = `${r.magazin_id}|${r.titlu_produs}`;
    const g = pe.get(k) ?? { r, variante: [] };
    g.variante.push(r);
    pe.set(k, g);
  }

  return [...pe.values()].map(({ r, variante }) => {
    const marimi: Marime[] = variante.map((v) => {
      const ritm = v.v30 / 30;
      const stoc = Math.max(0, v.stoc);
      return {
        marime: Object.entries(v.optiuni ?? {}).find(([k]) => OPT_MARIME.test(k))?.[1]
          ?? (v.titlu_varianta ?? '').split('/').map((x) => x.trim()).find((x) => rang(x) < 100) ?? v.titlu_varianta ?? '—',
        stoc, v7: v.v7, v30: v.v30, zile: ritm > 0 ? Math.floor(stoc / ritm) : null,
      };
    }).sort((a, b) => rang(a.marime) - rang(b.marime));
    const sum = (k: 'v7' | 'v30' | 'v60' | 'mort') => variante.reduce((s, v) => s + v[k], 0);
    const stoc = marimi.reduce((s, m) => s + m.stoc, 0);
    const v7 = sum('v7'), v30 = sum('v30'), v60 = sum('v60');
    const ritm = v30 / 30;
    const inainte = (v30 - v7) / 23 * 7; // media săptămânală din cele 23 de zile dinainte
    const activ = variante.some((v) => v.activ);
    const ultima = variante.map((v) => v.ultima).filter(Boolean).sort().pop() ?? null;
    return {
      magazin_id: r.magazin_id, magazin: r.magazin, produs: r.titlu_produs, tip: r.tip_produs, activ,
      stoc, v7, v30, v60, ritm: Math.round(ritm * 10) / 10, zile: ritm > 0 ? Math.floor(stoc / ritm) : null, ultima, marimi,
      semnale: {
        se_termina: activ ? marimi.filter((m) => m.zile !== null && m.zile < p.alerta_zile_stoc) : [],
        stoc_mort: activ && stoc >= p.stoc_mort_min_buc && sum('mort') === 0,
        trend: activ && v7 >= p.trend_min_buc && v7 >= p.trend_factor * inainte
          ? (inainte > 0 ? Math.round((v7 / inainte) * 10) / 10 : 0) : null,
      },
    };
  });
}

export type Alerte = {
  se_termina: { p: ProdusMagazin; m: Marime }[];
  stoc_mort: ProdusMagazin[];
  trend: ProdusMagazin[];
};

/** Alertele, cele mai grave întâi: ce se termină cel mai repede, ce stă cu cel mai mult stoc, ce crește cel mai tare. */
export function alerte(produse: ProdusMagazin[]): Alerte {
  return {
    se_termina: produse.flatMap((p) => p.semnale.se_termina.map((m) => ({ p, m })))
      .sort((a, b) => (a.m.zile ?? 0) - (b.m.zile ?? 0) || b.m.v30 - a.m.v30),
    stoc_mort: produse.filter((p) => p.semnale.stoc_mort).sort((a, b) => b.stoc - a.stoc),
    trend: produse.filter((p) => p.semnale.trend !== null).sort((a, b) => b.v7 - a.v7),
  };
}
