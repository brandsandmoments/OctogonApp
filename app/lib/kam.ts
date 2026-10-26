import { caFirma } from './db';
import { firmaCurenta } from './sesiune';

/**
 * Eficiența KAM-ului, pe perioade: săptămână (luni–duminică), lună, trimestru, an.
 *
 * Pe fiecare linie PSF activă în perioadă, două măsuri:
 *
 *   ritmul perioadei   = vândut în perioadă / de vândut în perioadă
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
  tinta_sapt: number;   // „sapt" a rămas din prima versiune: e ținta perioadei alese
  vandut_sapt: number;
  tinta_cum: number;
  vandut_cum: number;
  se_incheie: boolean; // perioada PSF-ului se termină în perioada aleasă: acuratețea e cea finală
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

export const PERIOADE = { saptamana: 'Săptămână', luna: 'Lună', trimestru: 'Trimestru', an: 'An' } as const;
export type TipPerioada = keyof typeof PERIOADE;
export type Perioada = { tip: TipPerioada; de_la: string; pana_la: string; nume: string };

const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august',
  'septembrie', 'octombrie', 'noiembrie', 'decembrie'];

/** Perioada de tipul ales care conține ziua, cu un nume de citit. */
export function perioada(tip: TipPerioada, zi: string): Perioada {
  if (tip === 'saptamana') {
    const l = luni(zi);
    return { tip, de_la: l, pana_la: adaugaZile(l, 6), nume: `${l} – ${adaugaZile(l, 6)}` };
  }
  const [an, luna] = zi.split('-').map(Number);
  const prima = tip === 'an' ? 1 : tip === 'trimestru' ? Math.floor((luna - 1) / 3) * 3 + 1 : luna;
  const cate = tip === 'an' ? 12 : tip === 'trimestru' ? 3 : 1;
  const de_la = `${an}-${String(prima).padStart(2, '0')}-01`;
  const urm = new Date(Date.UTC(an, prima - 1 + cate, 1, 12));
  const pana_la = adaugaZile(urm.toISOString().slice(0, 10), -1);
  const nume = tip === 'an' ? String(an)
    : tip === 'trimestru' ? `T${(prima - 1) / 3 + 1} ${an}`
    : `${LUNI[prima - 1]} ${an}`;
  return { tip, de_la, pana_la, nume };
}

/** Perioada dinainte (-1) sau următoare (+1). */
export const vecina = (p: Perioada, pas: -1 | 1) =>
  perioada(p.tip, pas < 0 ? adaugaZile(p.de_la, -1) : adaugaZile(p.pana_la, 1));

/**
 * Perioada din adresă. Implicit, cea care conține ziua de acum o săptămână: la
 * săptămână e ultima încheiată (cea curentă abia a început), la lună, trimestru și
 * an e, de obicei, cea în curs.
 */
export function perioadaDinAdresa(q: { perioada?: string; de_la?: string; saptamana?: string }): Perioada {
  const tip: TipPerioada = q.perioada && q.perioada in PERIOADE ? (q.perioada as TipPerioada) : 'saptamana';
  const azi = new Date().toLocaleDateString('sv-SE');
  const zi = q.de_la ?? q.saptamana;
  return perioada(tip, zi && /^\d{4}-\d{2}-\d{2}$/.test(zi) ? zi : adaugaZile(azi, -7));
}

export const adresaPerioadei = (p: Perioada) => `perioada=${p.tip}&de_la=${p.de_la}`;

export function acuratete(vandut: number, tinta: number): number | null {
  if (tinta <= 0) return null;
  return Math.max(0, 1 - Math.abs(vandut - tinta) / tinta);
}

const LINII = `
  WITH t AS (
      SELECT linie_id,
             sum(tinta) FILTER (WHERE zi BETWEEN $1::date AND $2::date) AS tinta_sapt,
             sum(tinta) FILTER (WHERE zi <= $2::date) AS tinta_cum
        FROM psf_tinta_zilnica GROUP BY linie_id),
  v AS (
      SELECT linie_id,
             sum(vandut) FILTER (WHERE zi BETWEEN $1::date AND $2::date) AS vandut_sapt,
             sum(vandut) FILTER (WHERE zi <= $2::date) AS vandut_cum
        FROM psf_vandut_zilnic GROUP BY linie_id)
  SELECT cl.id AS linie_id, c.numar AS comanda, c.kam_id, coalesce(u.nume, 'fără KAM') AS kam,
         p.denumire AS produs, p.cod_sku,
         to_char(cl.vanzare_de_la, 'YYYY-MM-DD') AS de_la, to_char(cl.vanzare_pana_la, 'YYYY-MM-DD') AS pana_la,
         (SELECT sum(cantitate) FROM comanda_cantitate WHERE linie_id = cl.id)::int AS volum,
         coalesce(t.tinta_sapt, 0)::float8 AS tinta_sapt, coalesce(v.vandut_sapt, 0)::float8 AS vandut_sapt,
         coalesce(t.tinta_cum, 0)::float8 AS tinta_cum, coalesce(v.vandut_cum, 0)::float8 AS vandut_cum,
         cl.vanzare_pana_la BETWEEN $1::date AND $2::date AS se_incheie
    FROM comanda c
    JOIN comanda_linie cl ON cl.comanda_id = c.id
    JOIN produs p         ON p.id = cl.produs_id
    LEFT JOIN utilizator u ON u.id = c.kam_id
    LEFT JOIN t ON t.linie_id = cl.id
    LEFT JOIN v ON v.linie_id = cl.id
   WHERE c.tip = 'PSF' AND c.stare <> 'anulata'
     -- activă în perioadă: perioada ei de vânzare o intersectează
     AND cl.vanzare_de_la <= $2::date AND cl.vanzare_pana_la >= $1::date`;

/**
 * O perioadă în curs se măsoară doar până la ultima zi cu vânzări: ținta zilelor
 * care n-au venit încă nu e o restanță a KAM-ului.
 */
const panaLa = (p: Perioada, ultima: string | null) => (ultima && ultima < p.pana_la ? ultima : p.pana_la);

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

export type Eficienta = {
  perioada: Perioada;
  kami: RandKam[];
  total: RandKam;
  praguri: Praguri;
  ultima_vanzare: string | null;
};

export async function eficienta(per: Perioada): Promise<Eficienta> {
  return caFirma(firmaCurenta(), async (c) => {
    const ultima = await ultimaVanzare(c);
    const { rows } = await c.query<LiniePsf & { kam_id: string | null; kam: string }>(LINII, [per.de_la, panaLa(per, ultima)]);
    const kami = agrega(rows);
    // Totalul e al HEAD OF SALES: el e măsurat pe performanța tuturor KAM-ilor.
    const [total] = agrega(rows.map((r) => ({ ...r, kam_id: 'toti', kam: 'Toți KAM-ii' })));
    return {
      perioada: per, kami,
      total: total ?? { kam_id: 'toti', kam: 'Toți KAM-ii', linii: 0, volum: 0, tinta_sapt: 0, vandut_sapt: 0,
                        tinta_cum: 0, vandut_cum: 0, acuratete: null },
      praguri: await citestePraguri(c), ultima_vanzare: ultima,
    };
  });
}

export type DetaliiKam = {
  kam: string;
  linii: LiniePsf[];
  istoric: { perioada: Perioada; tinta_sapt: number; vandut_sapt: number; acuratete: number | null; linii: number }[];
  praguri: Praguri;
  ultima_vanzare: string | null;
};

/** Liniile PSF ale unui KAM în perioadă, plus ultimele 8 perioade de același fel, ca să se vadă direcția. */
export async function detaliiKam(kamId: string | null, per: Perioada): Promise<DetaliiKam> {
  return caFirma(firmaCurenta(), async (c) => {
    const filtru = (r: { kam_id: string | null }) => r.kam_id === kamId;
    const ultima = await ultimaVanzare(c);
    const { rows } = await c.query<LiniePsf & { kam_id: string | null; kam: string }>(LINII, [per.de_la, panaLa(per, ultima)]);
    const ale = rows.filter(filtru);
    const kam = ale[0]?.kam ?? (kamId
      ? (await c.query<{ nume: string }>(`SELECT nume FROM utilizator WHERE id = $1`, [kamId])).rows[0]?.nume ?? 'KAM'
      : 'fără KAM');
    const istoric: DetaliiKam['istoric'] = [];
    const perioade = [per];
    while (perioade.length < 8) perioade.unshift(vecina(perioade[0], -1));
    for (const x of perioade) {
      const { rows: r } = await c.query<LiniePsf & { kam_id: string | null; kam: string }>(LINII, [x.de_la, panaLa(x, ultima)]);
      const [a] = agrega(r.filter(filtru));
      istoric.push({ perioada: x, tinta_sapt: a?.tinta_sapt ?? 0, vandut_sapt: a?.vandut_sapt ?? 0,
                     acuratete: a?.acuratete ?? null, linii: a?.linii ?? 0 });
    }
    return {
      kam,
      linii: ale.sort((a, b) => a.comanda.localeCompare(b.comanda) || a.produs.localeCompare(b.produs)),
      istoric, praguri: await citestePraguri(c), ultima_vanzare: ultima,
    };
  });
}
