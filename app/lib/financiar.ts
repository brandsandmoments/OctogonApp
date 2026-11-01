import { interogare } from './sesiune';

/**
 * Zona de financiar, din datele citite de financiarSync.ts: coletele trimise, cu
 * comanda și factura lor, ce e de stornat, rambursurile neîncasate și cele virate.
 * Totul pe o perioadă (după ziua AWB-ului, respectiv a viramentului) și, opțional,
 * pe un magazin și un curier.
 */

export type Filtru = { de: string; pana: string; magazinId?: string; curier?: 'fan' | 'gls' };

export type Colet = {
  curier: string; awb: string; sens: string; magazin: string | null; creat_zi: string; destinatar: string | null; telefon: string | null;
  oras: string | null; referinta: string | null; ramburs: number; stare: string; stare_text: string | null; stare_la: string | null;
  comanda: string | null; potrivire: string | null; facturi: string[]; stornari: string[]; total: number | null;
  virat: number | null; virat_zi: string | null; zile: number | null;
};

const CONDITII = `k.creat_zi BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR k.magazin_id = $3) AND ($4::text IS NULL OR k.curier = $4)`;

const COLET = `
  SELECT k.curier, k.awb, k.sens, b.nume AS magazin, to_char(k.creat_zi, 'YYYY-MM-DD') AS creat_zi, k.destinatar, k.telefon, k.oras, k.referinta,
         k.ramburs::float AS ramburs, k.stare, k.stare_text, to_char(k.stare_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI') AS stare_la,
         k.comanda, k.potrivire, coalesce(x.facturi, '{}') AS facturi, coalesce(x.stornari, '{}') AS stornari, x.total::float AS total,
         v.suma::float AS virat, to_char(v.virat_zi, 'YYYY-MM-DD') AS virat_zi,
         (current_date - coalesce((k.stare_la AT TIME ZONE 'Europe/Bucharest')::date, k.creat_zi)) AS zile
    FROM colet_curier k
    LEFT JOIN magazin m ON m.id = k.magazin_id
    LEFT JOIN brand b ON b.id = m.brand_id
    LEFT JOIN LATERAL (SELECT facturi, stornari, total FROM xc_comanda x
                        WHERE x.nume = k.comanda AND (k.magazin_id IS NULL OR x.magazin_id = k.magazin_id)
                        ORDER BY (k.awb = ANY(x.awb)) DESC LIMIT 1) x ON true
    LEFT JOIN LATERAL (SELECT sum(suma) AS suma, max(virat_zi) AS virat_zi FROM ramburs_virat v
                        WHERE v.curier = k.curier AND v.awb = k.awb) v ON true`;

const parametri = (f: Filtru) => [f.de, f.pana, f.magazinId ?? null, f.curier ?? null];

export type Vedere = 'expediate' | 'nefacturate' | 'de_stornat' | 'neincasat' | 'retururi';

/** Lista unei vederi; cele mai noi întâi, cele mai vechi sus unde contează vechimea. */
export async function colete(f: Filtru, vedere: Vedere): Promise<Colet[]> {
  const unde = {
    expediate: `k.sens = 'iese'`,
    // Livrate fără factură: nici factură validă, nici una stornată (o comandă anulată după refuz
    // n-are nevoie de factură, iar cele pe drum se facturează adesea la livrare).
    nefacturate: `k.sens = 'iese' AND k.stare = 'livrat' AND cardinality(coalesce(x.facturi, '{}')) = 0 AND cardinality(coalesce(x.stornari, '{}')) = 0`,
    // Refuzate sau returnate, cu factură care n-a fost stornată.
    de_stornat: `k.sens = 'iese' AND k.stare IN ('refuzat', 'returnat') AND cardinality(coalesce(x.facturi, '{}')) > 0 AND cardinality(coalesce(x.stornari, '{}')) = 0`,
    // Venite de la clienți: retururi și schimburi.
    retururi: `k.sens = 'intra'`,
    // Livrate cu ramburs, fără virament de la curier.
    neincasat: `k.sens = 'iese' AND k.stare = 'livrat' AND k.ramburs > 0 AND v.suma IS NULL`,
  }[vedere];
  const ordine = vedere === 'neincasat' ? 'zile DESC NULLS LAST, k.awb' : 'k.creat_zi DESC, k.awb';
  return interogare<Colet>(`SELECT * FROM (${COLET} WHERE ${CONDITII} AND ${unde} ORDER BY ${ordine} LIMIT 2000) t`, parametri(f));
}

export type Rezumat = {
  magazin: string | null; colete: number; ramburs: number; livrate: number; refuzate: number; returnate: number; pe_drum: number;
  cu_factura: number; nefacturate: number; din_portal: number; de_stornat: number; neincasat_nr: number; neincasat: number;
  retururi: number; retururi_schimb: number;
};

/** Pe fiecare magazin (și „fără magazin" pentru coletele făcute direct la curier, nepotrivite). */
export async function rezumat(f: Filtru): Promise<Rezumat[]> {
  return interogare<Rezumat>(
    `SELECT magazin, count(*) FILTER (WHERE sens = 'iese')::int AS colete, coalesce(sum(ramburs) FILTER (WHERE sens = 'iese'), 0)::float AS ramburs,
            count(*) FILTER (WHERE sens = 'intra')::int AS retururi,
            count(*) FILTER (WHERE sens = 'intra' AND referinta ~* 'schimb')::int AS retururi_schimb,
            count(*) FILTER (WHERE sens = 'iese' AND stare = 'livrat')::int AS livrate, count(*) FILTER (WHERE sens = 'iese' AND stare = 'refuzat')::int AS refuzate,
            count(*) FILTER (WHERE sens = 'iese' AND stare = 'returnat')::int AS returnate, count(*) FILTER (WHERE sens = 'iese' AND stare IN ('creat', 'in_tranzit'))::int AS pe_drum,
            count(*) FILTER (WHERE sens = 'iese' AND (cardinality(facturi) > 0 OR cardinality(stornari) > 0))::int AS cu_factura,
            count(*) FILTER (WHERE sens = 'iese' AND stare = 'livrat' AND cardinality(facturi) = 0 AND cardinality(stornari) = 0)::int AS nefacturate,
            count(*) FILTER (WHERE sens = 'iese' AND potrivire IS DISTINCT FROM 'awb')::int AS din_portal,
            count(*) FILTER (WHERE sens = 'iese' AND stare IN ('refuzat', 'returnat') AND cardinality(facturi) > 0 AND cardinality(stornari) = 0)::int AS de_stornat,
            count(*) FILTER (WHERE sens = 'iese' AND stare = 'livrat' AND ramburs > 0 AND virat IS NULL)::int AS neincasat_nr,
            coalesce(sum(ramburs) FILTER (WHERE sens = 'iese' AND stare = 'livrat' AND ramburs > 0 AND virat IS NULL), 0)::float AS neincasat
       FROM (${COLET} WHERE ${CONDITII}) t
      GROUP BY magazin ORDER BY magazin NULLS LAST`, parametri(f));
}

export type Virament = { virat_zi: string; magazin: string | null; colete: number; suma: number };

/** Rambursurile virate de curier, pe zi și magazin, în perioadă (după ziua viramentului). */
export async function viramente(f: Filtru): Promise<Virament[]> {
  return interogare<Virament>(
    `SELECT to_char(v.virat_zi, 'YYYY-MM-DD') AS virat_zi, b.nume AS magazin, count(*)::int AS colete, sum(v.suma)::float AS suma
       FROM ramburs_virat v LEFT JOIN magazin m ON m.id = v.magazin_id LEFT JOIN brand b ON b.id = m.brand_id
      WHERE v.virat_zi BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR v.magazin_id = $3) AND ($4::text IS NULL OR v.curier = $4)
      GROUP BY 1, 2 ORDER BY 1 DESC, 2`, parametri(f));
}

export type Sursa = { sursa: string; ultima_zi: string | null; citit_la: string | null; eroare: string | null };

export async function surse(): Promise<Sursa[]> {
  return interogare<Sursa>(
    `SELECT sursa, to_char(ultima_zi, 'DD.MM') AS ultima_zi, to_char(citit_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI') AS citit_la, eroare
       FROM sursa_financiar ORDER BY sursa`);
}

export type Card = { magazin: string | null; plati: number; brut: number; rambursari: number; comision: number; net: number };

/** Plățile cu cardul (Shopify Payments) din perioadă, pe magazin: brut, rambursări, comision, net. */
export async function card(f: Filtru): Promise<Card[]> {
  return interogare<Card>(
    `SELECT b.nume AS magazin, count(*) FILTER (WHERE t.tip = 'CHARGE')::int AS plati,
            coalesce(sum(t.suma) FILTER (WHERE t.tip = 'CHARGE'), 0)::float AS brut,
            coalesce(sum(t.suma) FILTER (WHERE t.tip = 'REFUND'), 0)::float AS rambursari,
            coalesce(sum(t.comision), 0)::float AS comision, coalesce(sum(t.net), 0)::float AS net
       FROM card_tranzactie t JOIN magazin m ON m.id = t.magazin_id JOIN brand b ON b.id = m.brand_id
      WHERE (t.data AT TIME ZONE 'Europe/Bucharest')::date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR t.magazin_id = $3)
      GROUP BY 1 ORDER BY 1`, [f.de, f.pana, f.magazinId ?? null]);
}

export type ViramentCard = { data: string; magazin: string; stare: string; brut: number | null; comision: number | null; net: number };

/** Viramentele Shopify Payments către bancă, din perioadă. */
export async function viramenteCard(f: Filtru): Promise<ViramentCard[]> {
  return interogare<ViramentCard>(
    `SELECT to_char(v.data AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD') AS data, b.nume AS magazin, v.stare,
            v.brut::float AS brut, v.comision::float AS comision, v.net::float AS net
       FROM card_virament v JOIN magazin m ON m.id = v.magazin_id JOIN brand b ON b.id = m.brand_id
      WHERE (v.data AT TIME ZONE 'Europe/Bucharest')::date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR v.magazin_id = $3)
      ORDER BY v.data DESC, b.nume`, [f.de, f.pana, f.magazinId ?? null]);
}
