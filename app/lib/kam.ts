import { caFirma } from './db';
import { firmaCurenta } from './sesiune';

/**
 * Eficiența KAM-ului, pe săptămâni (luni–duminică).
 *
 * Pe fiecare linie PSF activă în săptămână, două măsuri:
 *
 *   ritmul săptămânii  = vândut în săptămână / de vândut în săptămână
 *   acuratețea la zi   = 1 − |vândut până acum − de vândut până acum| / de vândut până acum
 *
 * „De vândut" e volumul PSF împărțit egal pe zilele perioadei asumate de KAM
 * (psf_tinta_zilnica); „vândut" sunt vânzările brute ale produsului, împărțite
 * între PSF-urile suprapuse după ținta zilnică a fiecăruia (psf_vandut_zilnic).
 * La finalul perioadei, acuratețea la zi e exact KPI-ul din dashboard (KPI_KAM).
 *
 * Pe KAM, acuratețea e media acurateților pe linii, ponderată cu cât avea fiecare
 * de vândut. O sumă simplă ar lăsa un PSF supraestimat să-l compenseze pe unul
 * subestimat, iar KAM-ul ar părea exact tocmai când a greșit de două ori.
 */

export type Praguri = { acurateteGalben: number; acurateteVerde: number; vandutGalben: number; vandutVerde: number };

export type LiniePsf = {
  linie_id: string;
  comanda: string;
  produs: string;
  cod_sku: string;
  de_la: string;
  pana_la: string;
  volum: number;
  tinta_sapt: number;
  vandut_sapt: number;
  tinta_cum: number;
  vandut_cum: number;
  se_incheie: boolean; // perioada se termină în săptămâna asta: acuratețea e cea finală
};

export type RandKam = {
  kam_id: string | null;
  kam: string;
  linii: number;
  volum: number;
  tinta_sapt: number;
  vandut_sapt: number;
  tinta_cum: number;
  vandut_cum: number;
  acuratete: number | null;
};

/** Lunea săptămânii unei date, ca text YYYY-MM-DD. */
export function luni(zi: string): string {
  const d = new Date(`${zi}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function adaugaZile(zi: string, n: number): string {
  const d = new Date(`${zi}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function acuratete(vandut: number, tinta: number): number | null {
  if (tinta <= 0) return null;
  return Math.max(0, 1 - Math.abs(vandut - tinta) / tinta);
}

const LINII = `
  WITH t AS (
      SELECT linie_id,
             sum(tinta) FILTER (WHERE zi BETWEEN $1::date AND $1::date + 6) AS tinta_sapt,
             sum(tinta) FILTER (WHERE zi <= $1::date + 6) AS tinta_cum
        FROM psf_tinta_zilnica GROUP BY linie_id),
  v AS (
      SELECT linie_id,
             sum(vandut) FILTER (WHERE zi BETWEEN $1::date AND $1::date + 6) AS vandut_sapt,
             sum(vandut) FILTER (WHERE zi <= $1::date + 6) AS vandut_cum
        FROM psf_vandut_zilnic GROUP BY linie_id)
  SELECT cl.id AS linie_id, c.numar AS comanda, c.kam_id, coalesce(u.nume, 'fără KAM') AS kam,
         p.denumire AS produs, p.cod_sku,
         to_char(cl.vanzare_de_la, 'YYYY-MM-DD') AS de_la, to_char(cl.vanzare_pana_la, 'YYYY-MM-DD') AS pana_la,
         (SELECT sum(cantitate) FROM comanda_cantitate WHERE linie_id = cl.id)::int AS volum,
         coalesce(t.tinta_sapt, 0)::float8 AS tinta_sapt, coalesce(v.vandut_sapt, 0)::float8 AS vandut_sapt,
         coalesce(t.tinta_cum, 0)::float8 AS tinta_cum, coalesce(v.vandut_cum, 0)::float8 AS vandut_cum,
         cl.vanzare_pana_la BETWEEN $1::date AND $1::date + 6 AS se_incheie
    FROM comanda c
    JOIN comanda_linie cl ON cl.comanda_id = c.id
    JOIN produs p         ON p.id = cl.produs_id
    LEFT JOIN utilizator u ON u.id = c.kam_id
    LEFT JOIN t ON t.linie_id = cl.id
    LEFT JOIN v ON v.linie_id = cl.id
   WHERE c.tip = 'PSF' AND c.stare <> 'anulata'
     -- activă în săptămână: perioada ei intersectează săptămâna
     AND cl.vanzare_de_la <= $1::date + 6 AND cl.vanzare_pana_la >= $1::date`;

async function citestePraguri(c: import('pg').PoolClient): Promise<Praguri> {
  const { rows } = await c.query<{ cheie: string; valoare: string }>(
    `SELECT cheie, valoare::text FROM parametru WHERE cheie LIKE 'kam_%'`);
  const p = Object.fromEntries(rows.map((r) => [r.cheie, Number(r.valoare)]));
  return {
    acurateteGalben: p.kam_acuratete_galben ?? 0.7, acurateteVerde: p.kam_acuratete_verde ?? 0.85,
    vandutGalben: p.kam_vandut_galben ?? 0.7, vandutVerde: p.kam_vandut_verde ?? 0.9,
  };
}

/** Ultima zi cu vânzări înregistrate: arată cât de proaspete sunt cifrele. */
async function ultimaVanzare(c: import('pg').PoolClient): Promise<string | null> {
  const { rows: [r] } = await c.query<{ zi: string | null }>(
    `SELECT to_char(max(data AT TIME ZONE 'Europe/Bucharest'), 'YYYY-MM-DD') AS zi FROM vanzare`);
  return r.zi;
}

function agrega(linii: (LiniePsf & { kam_id: string | null; kam: string })[]): RandKam[] {
  const pe = new Map<string, RandKam & { pondere: number; suma: number }>();
  for (const l of linii) {
    const k = l.kam_id ?? '';
    const x = pe.get(k) ?? { kam_id: l.kam_id, kam: l.kam, linii: 0, volum: 0, tinta_sapt: 0, vandut_sapt: 0,
                             tinta_cum: 0, vandut_cum: 0, acuratete: null, pondere: 0, suma: 0 };
    x.linii++; x.volum += l.volum;
    x.tinta_sapt += l.tinta_sapt; x.vandut_sapt += l.vandut_sapt;
    x.tinta_cum += l.tinta_cum; x.vandut_cum += l.vandut_cum;
    const a = acuratete(l.vandut_cum, l.tinta_cum);
    if (a !== null) { x.suma += a * l.tinta_cum; x.pondere += l.tinta_cum; }
    pe.set(k, x);
  }
  return [...pe.values()]
    .map(({ pondere, suma, ...r }) => ({ ...r, acuratete: pondere > 0 ? suma / pondere : null }))
    .sort((a, b) => (a.kam_id === null ? 1 : b.kam_id === null ? -1 : a.kam.localeCompare(b.kam)));
}

export type Saptamana = {
  luni: string;
  duminica: string;
  kami: RandKam[];
  total: RandKam;
  praguri: Praguri;
  ultima_vanzare: string | null;
};

export async function saptamana(luniSapt: string): Promise<Saptamana> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows } = await c.query<LiniePsf & { kam_id: string | null; kam: string }>(LINII, [luniSapt]);
    const kami = agrega(rows);
    // Totalul e al HEAD OF SALES: el e măsurat pe performanța tuturor KAM-ilor.
    const [total] = agrega(rows.map((r) => ({ ...r, kam_id: 'toti', kam: 'Toți KAM-ii' })));
    return {
      luni: luniSapt, duminica: adaugaZile(luniSapt, 6), kami,
      total: total ?? { kam_id: 'toti', kam: 'Toți KAM-ii', linii: 0, volum: 0, tinta_sapt: 0, vandut_sapt: 0,
                        tinta_cum: 0, vandut_cum: 0, acuratete: null },
      praguri: await citestePraguri(c), ultima_vanzare: await ultimaVanzare(c),
    };
  });
}

export type DetaliiKam = {
  kam: string;
  linii: LiniePsf[];
  istoric: { luni: string; tinta_sapt: number; vandut_sapt: number; acuratete: number | null; linii: number }[];
  praguri: Praguri;
  ultima_vanzare: string | null;
};

/** Liniile PSF ale unui KAM în săptămână, plus ultimele 8 săptămâni, ca să se vadă direcția. */
export async function detaliiKam(kamId: string | null, luniSapt: string): Promise<DetaliiKam> {
  return caFirma(firmaCurenta(), async (c) => {
    const filtru = (r: { kam_id: string | null }) => r.kam_id === kamId;
    const { rows } = await c.query<LiniePsf & { kam_id: string | null; kam: string }>(LINII, [luniSapt]);
    const ale = rows.filter(filtru);
    const kam = ale[0]?.kam ?? (kamId
      ? (await c.query<{ nume: string }>(`SELECT nume FROM utilizator WHERE id = $1`, [kamId])).rows[0]?.nume ?? 'KAM'
      : 'fără KAM');
    const istoric: DetaliiKam['istoric'] = [];
    for (let i = 7; i >= 0; i--) {
      const l = adaugaZile(luniSapt, -7 * i);
      const { rows: r } = await c.query<LiniePsf & { kam_id: string | null; kam: string }>(LINII, [l]);
      const [a] = agrega(r.filter(filtru));
      istoric.push({ luni: l, tinta_sapt: a?.tinta_sapt ?? 0, vandut_sapt: a?.vandut_sapt ?? 0,
                     acuratete: a?.acuratete ?? null, linii: a?.linii ?? 0 });
    }
    return {
      kam,
      linii: ale.sort((a, b) => a.comanda.localeCompare(b.comanda) || a.produs.localeCompare(b.produs)),
      istoric, praguri: await citestePraguri(c), ultima_vanzare: await ultimaVanzare(c),
    };
  });
}
