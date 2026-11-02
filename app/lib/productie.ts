import { caFirma } from './db';
import { firmaCurenta, interogare } from './sesiune';
import { stadiulLiniei, type StadiuLinie } from './centralizator';
import { factorLot } from './timp';

/**
 * Planul de producție pe săptămâni (0040). Un PSF sau PSC lansat pleacă singur la
 * croit; managerul de producție îl pune pe săptămâna (luni–vineri) în care se
 * lucrează. Pe săptămână se vede tot drumul fiecărei comenzi — rămas de croit,
 * croit și nedat pe bandă, în lucru, în depozit — și de acolo intră în lucru:
 * ce s-a croit se dă pe bandă și se alocă oamenii pe ce a intrat.
 */

export type ComandaInPlan = {
  comanda_id: string;
  numar: string;
  tip: string;
  brand: string;
  kam: string | null;
  prioritate: number;
  stare: string;
  data_ceruta: string;          // cel mai apropiat termen dintre linii
  model: string;
  saptamana: string | null;     // lunea săptămânii în care e programată
  cerut: number;
  rest_de_croit: number;        // planificat și încă necroit (fără ce s-a închis la croit)
  croit: number;
  banda: number;
  intrat: number;
  ore_om: number | null;        // pe toată comanda, din minutele pe bucată ale modelelor
  stadiu: StadiuLinie;
};

type Rand = Omit<ComandaInPlan, 'stadiu' | 'cerut' | 'rest_de_croit' | 'croit' | 'banda' | 'intrat' | 'ore_om'> & {
  linie_id: string; cerut: number; croit: number; banda: number; intrat: number; inchisa: boolean; rest: number;
  timp_min_buc: number | null; cerut_linie: number;
};

/**
 * Comenzile deschise (lansate, în producție) și cele programate în săptămâna
 * cerută, chiar dacă s-au închis între timp — ca săptămâna să arate și ce s-a terminat.
 */
export async function comenziInPlan(saptamana: string): Promise<ComandaInPlan[]> {
  const randuri = await interogare<Rand>(
    `WITH croit AS (
         SELECT pl.linie_id, le.marime_id, sum(le.cantitate)::int AS q
           FROM planificare pl JOIN lot_croit lc ON lc.planificare_id = pl.id
           JOIN lot_croit_efectiv le ON le.lot_id = lc.id GROUP BY 1, 2),
     banda AS (
         SELECT pl.linie_id, ac.marime_id, sum(ac.cantitate)::int AS q
           FROM planificare pl JOIN lot_croit lc ON lc.planificare_id = pl.id
           JOIN alimentare_banda ab ON ab.lot_id = lc.id
           JOIN alimentare_cantitate ac ON ac.alimentare_id = ab.id GROUP BY 1, 2),
     intrat AS (
         SELECT e.linie_id, e.marime_id, sum(r.cantitate)::int AS q, bool_or(r.inchide_pozitia) AS inchisa
           FROM eticheta e JOIN receptie r ON r.eticheta_id = e.id GROUP BY 1, 2),
     rest AS (
         SELECT pl.linie_id, r.marime_id, sum(r.rest)::int AS q
           FROM planificare_rest_de_croit r JOIN planificare pl ON pl.id = r.planificare_id GROUP BY 1, 2)
     SELECT c.id AS comanda_id, c.numar, c.tip::text AS tip, b.nume AS brand, k.nume AS kam, c.prioritate, c.stare::text AS stare,
            to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta, coalesce(mo.denumire, p.denumire) AS model,
            to_char(ps.saptamana, 'YYYY-MM-DD') AS saptamana,
            cl.id AS linie_id, cc.cantitate AS cerut, coalesce(cr.q, 0) AS croit, coalesce(bd.q, 0) AS banda,
            coalesce(i.q, 0) AS intrat, coalesce(i.inchisa, false) AS inchisa, coalesce(rs.q, 0) AS rest,
            mo.timp_min_buc::float AS timp_min_buc,
            sum(cc.cantitate) OVER (PARTITION BY cl.id)::int AS cerut_linie
       FROM comanda c
       JOIN brand b              ON b.id = c.brand_id
       LEFT JOIN utilizator k    ON k.id = c.kam_id
       LEFT JOIN plan_saptamana ps ON ps.comanda_id = c.id
       JOIN comanda_linie cl     ON cl.comanda_id = c.id
       JOIN produs p             ON p.id = cl.produs_id
       LEFT JOIN model mo        ON mo.id = p.model_id
       JOIN comanda_cantitate cc ON cc.linie_id = cl.id
       LEFT JOIN croit cr  ON cr.linie_id = cl.id AND cr.marime_id = cc.marime_id
       LEFT JOIN banda bd  ON bd.linie_id = cl.id AND bd.marime_id = cc.marime_id
       LEFT JOIN intrat i  ON i.linie_id = cl.id AND i.marime_id = cc.marime_id
       LEFT JOIN rest rs   ON rs.linie_id = cl.id AND rs.marime_id = cc.marime_id
      WHERE c.stare IN ('lansata', 'in_productie') OR ps.saptamana = $1::date
      ORDER BY c.prioritate, c.numar`, [saptamana]);

  const pe = new Map<string, { c: ComandaInPlan; linii: Map<string, Rand[]> }>();
  for (const r of randuri) {
    const x = pe.get(r.comanda_id) ?? {
      c: { comanda_id: r.comanda_id, numar: r.numar, tip: r.tip, brand: r.brand, kam: r.kam, prioritate: r.prioritate,
           stare: r.stare, data_ceruta: r.data_ceruta, model: r.model, saptamana: r.saptamana,
           cerut: 0, rest_de_croit: 0, croit: 0, banda: 0, intrat: 0, ore_om: null, stadiu: 'necroita' as StadiuLinie },
      linii: new Map<string, Rand[]>(),
    };
    if (r.data_ceruta < x.c.data_ceruta) x.c.data_ceruta = r.data_ceruta;
    if (!x.c.model.split(', ').includes(r.model)) x.c.model += `, ${r.model}`;
    x.c.cerut += r.cerut; x.c.rest_de_croit += r.rest; x.c.croit += r.croit; x.c.banda += r.banda; x.c.intrat += r.intrat;
    x.linii.set(r.linie_id, [...(x.linii.get(r.linie_id) ?? []), r]);
    pe.set(r.comanda_id, x);
  }
  // Stadiul comenzii: cel mai puțin avansat dintre liniile ei — e gata abia când e gata tot.
  const ORDINE: StadiuLinie[] = ['necroita', 'croita', 'in_lucru', 'gata'];
  return [...pe.values()].map(({ c, linii }) => {
    const stadii = [...linii.values()].map((m) => stadiulLiniei(m));
    const cuTimp = [...linii.values()].filter((m) => m[0].timp_min_buc);
    const ore_om = cuTimp.length === 0 ? null
      : cuTimp.reduce((s, m) => s + (m[0].cerut_linie * m[0].timp_min_buc! / 60) * factorLot(m[0].cerut_linie), 0);
    return { ...c, ore_om, stadiu: ORDINE[Math.min(...stadii.map((s) => ORDINE.indexOf(s)))] };
  }).sort((a, b) => a.prioritate - b.prioritate || a.data_ceruta.localeCompare(b.data_ceruta) || a.numar.localeCompare(b.numar));
}

/** Pune comenzile pe săptămâna care începe lunea dată (le mută, dacă erau pe alta). */
export async function programeaza(comenzi: string[], saptamana: string): Promise<string | null> {
  if (comenzi.length === 0) return 'Bifează cel puțin o comandă.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saptamana) || new Date(`${saptamana}T12:00:00Z`).getUTCDay() !== 1) return 'Alege săptămâna.';
  await caFirma(firmaCurenta(), async (c) => {
    await c.query(
      `INSERT INTO plan_saptamana (firma_id, comanda_id, saptamana)
       SELECT firma_curenta(), unnest($1::uuid[]), $2::date
       ON CONFLICT (firma_id, comanda_id) DO UPDATE SET saptamana = EXCLUDED.saptamana`, [comenzi, saptamana]);
  });
  return null;
}

export async function scoateDinPlan(comandaId: string): Promise<void> {
  await interogare(`DELETE FROM plan_saptamana WHERE comanda_id = $1`, [comandaId]);
}

/** Câți oameni lucrează acum (alocați, neterminați) pe fiecare tranșă de pe bandă. */
export async function oameniPeTranse(): Promise<Map<string, number>> {
  const r = await interogare<{ id: string; n: number }>(
    `SELECT alimentare_id AS id, count(DISTINCT angajat_id)::int AS n FROM alocare_operatie WHERE gata_la IS NULL GROUP BY 1`);
  return new Map(r.map((x) => [x.id, x.n]));
}
