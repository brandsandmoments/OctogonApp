import { caFirma } from './db';
import { firmaCurenta, interogare } from './sesiune';
import { stadiulLiniei, type StadiuLinie } from './centralizator';
import { factorLot } from './timp';
import { luni } from './perioade';
import { rangMarime } from './format';

/**
 * Planul de producție pe săptămâni (0040, pe culori din 0048). Un PSF sau PSC lansat
 * pleacă singur la croit; managerul de producție îi pune culorile — toate, doar unele,
 * sau doar o parte din bucăți — pe săptămâna (luni–vineri) în care se lucrează. O
 * culoare se poate împărți pe mai multe săptămâni.
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
  saptamana: string | null;     // prima săptămână în care e programată o culoare a ei
  cerut: number;
  rest_de_croit: number;        // planificat și încă necroit (fără ce s-a închis la croit)
  croit: number;
  banda: number;
  intrat: number;
  ore_om: number | null;        // pe toată comanda, din minutele pe bucată ale modelelor
  stadiu: StadiuLinie;
  linii: LinieInPlan[];         // pe culori (produse) și mărimi, pentru desfacerea comenzii
};

export type MarimeInPlan = { marime: string; cerut: number; croit: number; banda: number; intrat: number; rest: number };
/** O programare: culoarea pe o săptămână, toată (bucati null) sau doar atâtea bucăți. */
export type PlanLinie = { id: string; saptamana: string; bucati: number | null };
export type LinieInPlan = {
  linie_id: string; produs: string; cod_sku: string; data_ceruta: string; marimi: MarimeInPlan[];
  cerut: number; croit: number; banda: number; intrat: number; rest: number; stadiu: StadiuLinie;
  ore_om: number | null;
  plan: PlanLinie[];
  de_programat: number;   // bucăți încă neprogramate pe nicio săptămână
};

type Rand = Omit<ComandaInPlan, 'stadiu' | 'cerut' | 'rest_de_croit' | 'croit' | 'banda' | 'intrat' | 'ore_om' | 'linii'> & {
  produs: string; cod_sku: string; marime: string;
  linie_id: string; cerut: number; croit: number; banda: number; intrat: number; inchisa: boolean; rest: number;
  timp_min_buc: number | null; cerut_linie: number;
};

/**
 * Comenzile deschise (lansate, în producție) și cele programate în săptămânile
 * cerute, chiar dacă s-au închis între timp — ca săptămâna să arate și ce s-a terminat.
 */
export async function comenziInPlan(saptamani: string[]): Promise<ComandaInPlan[]> {
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
            NULL::text AS saptamana,
            cl.id AS linie_id, p.denumire AS produs, p.cod_sku, m.cod AS marime, cc.cantitate AS cerut, coalesce(cr.q, 0) AS croit, coalesce(bd.q, 0) AS banda,
            coalesce(i.q, 0) AS intrat, coalesce(i.inchisa, false) AS inchisa, coalesce(rs.q, 0) AS rest,
            mo.timp_min_buc::float AS timp_min_buc,
            sum(cc.cantitate) OVER (PARTITION BY cl.id)::int AS cerut_linie
       FROM comanda c
       JOIN brand b              ON b.id = c.brand_id
       LEFT JOIN utilizator k    ON k.id = c.kam_id
       JOIN comanda_linie cl     ON cl.comanda_id = c.id
       JOIN produs p             ON p.id = cl.produs_id
       LEFT JOIN model mo        ON mo.id = p.model_id
       JOIN comanda_cantitate cc ON cc.linie_id = cl.id
       JOIN marime m             ON m.id = cc.marime_id
       LEFT JOIN croit cr  ON cr.linie_id = cl.id AND cr.marime_id = cc.marime_id
       LEFT JOIN banda bd  ON bd.linie_id = cl.id AND bd.marime_id = cc.marime_id
       LEFT JOIN intrat i  ON i.linie_id = cl.id AND i.marime_id = cc.marime_id
       LEFT JOIN rest rs   ON rs.linie_id = cl.id AND rs.marime_id = cc.marime_id
      WHERE c.stare IN ('lansata', 'in_productie')
         OR EXISTS (SELECT 1 FROM plan_linie x JOIN comanda_linie y ON y.id = x.linie_id
                     WHERE y.comanda_id = c.id AND x.saptamana = ANY ($1::date[]))
      ORDER BY c.prioritate, c.numar, p.denumire, m.ordine`, [saptamani]);

  const planuri = await interogare<PlanLinie & { linie_id: string }>(
    `SELECT id, linie_id, to_char(saptamana, 'YYYY-MM-DD') AS saptamana, bucati FROM plan_linie
      WHERE linie_id = ANY ($1::uuid[]) ORDER BY saptamana`, [[...new Set(randuri.map((r) => r.linie_id))]]);
  const planPe = new Map<string, PlanLinie[]>();
  for (const { linie_id, ...p } of planuri) planPe.set(linie_id, [...(planPe.get(linie_id) ?? []), p]);

  const pe = new Map<string, { c: ComandaInPlan; linii: Map<string, Rand[]> }>();
  for (const r of randuri) {
    const x = pe.get(r.comanda_id) ?? {
      c: { comanda_id: r.comanda_id, numar: r.numar, tip: r.tip, brand: r.brand, kam: r.kam, prioritate: r.prioritate,
           stare: r.stare, data_ceruta: r.data_ceruta, model: r.model, saptamana: null,
           cerut: 0, rest_de_croit: 0, croit: 0, banda: 0, intrat: 0, ore_om: null, stadiu: 'necroita' as StadiuLinie, linii: [] as LinieInPlan[] },
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
  const suma = (m: Rand[], k: 'cerut' | 'croit' | 'banda' | 'intrat' | 'rest') => m.reduce((s, x) => s + x[k], 0);
  return [...pe.values()].map(({ c, linii }) => {
    // Pe culori, în ordinea numelui; mărimile de la cea mai mică la cea mai mare.
    const peCulori: LinieInPlan[] = [...linii.values()].map((m) => {
      const plan = planPe.get(m[0].linie_id) ?? [];
      const stadiu = stadiulLiniei(m);
      const cerut = suma(m, 'cerut');
      const programat = plan.some((p) => p.bucati === null) ? cerut : plan.reduce((s, p) => s + (p.bucati ?? 0), 0);
      return {
        linie_id: m[0].linie_id, produs: m[0].produs, cod_sku: m[0].cod_sku, data_ceruta: m[0].data_ceruta,
        marimi: m.map((x) => ({ marime: x.marime, cerut: x.cerut, croit: x.croit, banda: x.banda, intrat: x.intrat, rest: x.rest }))
          .sort((a, b) => rangMarime(a.marime) - rangMarime(b.marime)),
        cerut, croit: suma(m, 'croit'), banda: suma(m, 'banda'), intrat: suma(m, 'intrat'), rest: suma(m, 'rest'), stadiu,
        ore_om: m[0].timp_min_buc ? (m[0].cerut_linie * m[0].timp_min_buc / 60) * factorLot(m[0].cerut_linie) : null,
        plan, de_programat: stadiu === 'gata' ? 0 : Math.max(0, cerut - programat),
      };
    }).sort((a, b) => a.produs.localeCompare(b.produs, 'ro'));
    const cuTimp = peCulori.filter((l) => l.ore_om !== null);
    const saptamani = peCulori.flatMap((l) => l.plan.map((p) => p.saptamana)).sort();
    return {
      ...c, linii: peCulori, saptamana: saptamani[0] ?? null,
      ore_om: cuTimp.length ? cuTimp.reduce((s, l) => s + l.ore_om!, 0) : null,
      stadiu: ORDINE[Math.min(...peCulori.map((l) => ORDINE.indexOf(l.stadiu)))],
    };
  }).sort((a, b) => a.prioritate - b.prioritate || a.data_ceruta.localeCompare(b.data_ceruta) || a.numar.localeCompare(b.numar));
}

/** Câte bucăți are o programare: ale ei, sau, „toată culoarea", ce n-au luat celelalte programări. */
export function bucatiProgramate(l: LinieInPlan, p: PlanLinie): number {
  if (p.bucati !== null) return p.bucati;
  return Math.max(0, l.cerut - l.plan.filter((x) => x.id !== p.id).reduce((s, x) => s + (x.bucati ?? 0), 0));
}

/**
 * Pune culori pe săptămâna zilei alese din calendar — oricare zi, oricât de departe:
 * toată culoarea (bucati null) sau doar atâtea bucăți. Pe aceeași săptămână, o culoare
 * deja programată primește noua cantitate.
 */
export async function programeaza(intrari: { linieId: string; bucati: number | null }[], zi: string): Promise<string | null> {
  if (intrari.length === 0) return 'Bifează cel puțin o culoare (sau toată comanda).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(zi)) return 'Alege din calendar o zi din săptămâna în care se lucrează.';
  if (intrari.some((x) => x.bucati !== null && !(Number.isInteger(x.bucati) && x.bucati > 0))) return 'Bucățile trebuie să fie un număr întreg, mai mare ca zero (gol = toată culoarea).';
  const saptamana = luni(zi);
  await caFirma(firmaCurenta(), async (c) => {
    for (const x of intrari) {
      await c.query(
        `INSERT INTO plan_linie (firma_id, linie_id, saptamana, bucati) VALUES (firma_curenta(), $1, $2::date, $3)
         ON CONFLICT (firma_id, linie_id, saptamana) DO UPDATE SET bucati = EXCLUDED.bucati`, [x.linieId, saptamana, x.bucati]);
    }
  });
  return null;
}

/** Mută o programare pe altă săptămână; dacă culoarea era deja acolo, se adună (toată culoarea rămâne toată). */
export async function mutaPlan(planId: string, zi: string): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(zi)) return 'Alege din calendar o zi din săptămâna nouă.';
  const saptamana = luni(zi);
  await caFirma(firmaCurenta(), async (c) => {
    const { rows: [p] } = await c.query<{ linie_id: string; bucati: number | null }>(
      `SELECT linie_id, bucati FROM plan_linie WHERE id = $1 FOR UPDATE`, [planId]);
    if (!p) return;
    const { rows: [acolo] } = await c.query<{ id: string; bucati: number | null }>(
      `SELECT id, bucati FROM plan_linie WHERE linie_id = $1 AND saptamana = $2::date AND id <> $3 FOR UPDATE`, [p.linie_id, saptamana, planId]);
    if (acolo) {
      await c.query(`UPDATE plan_linie SET bucati = $2 WHERE id = $1`,
        [acolo.id, acolo.bucati === null || p.bucati === null ? null : acolo.bucati + p.bucati]);
      await c.query(`DELETE FROM plan_linie WHERE id = $1`, [planId]);
    } else {
      await c.query(`UPDATE plan_linie SET saptamana = $2::date WHERE id = $1`, [planId, saptamana]);
    }
  });
  return null;
}

export async function scoateDinPlan(planId: string): Promise<void> {
  await interogare(`DELETE FROM plan_linie WHERE id = $1`, [planId]);
}

/** Câți oameni lucrează acum (alocați, neterminați) pe fiecare tranșă de pe bandă. */
export async function oameniPeTranse(): Promise<Map<string, number>> {
  const r = await interogare<{ id: string; n: number }>(
    `SELECT alimentare_id AS id, count(DISTINCT angajat_id)::int AS n FROM alocare_operatie WHERE gata_la IS NULL GROUP BY 1`);
  return new Map(r.map((x) => [x.id, x.n]));
}
