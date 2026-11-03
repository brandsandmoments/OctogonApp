import { caFirma } from './db';
import { firmaCurenta, interogare } from './sesiune';
import { rangMarime } from './format';
import { alimenteaza, iesitGata } from './banda';
import { adaugaZileLucratoare } from './timp';

/**
 * Dashboard-ul de producție: comenzile din care s-a croit ceva și n-au ieșit încă
 * toate gata. Pe fiecare culoare, mărimile — cerut, croit, dat în lucru, ieșit gata —
 * și, chiar alături, ce intră acum în lucru. Pe comandă: minutele pe bucată (ale
 * modelului), câți oameni lucrează (de aici, ziua estimată de gata) și cine pe ce fază.
 */

export type MarimeProd = { marime_id: string; marime: string; cerut: number; croit: number; dat: number; gata: number; de_dat: number };
export type CuloareProd = { linie_id: string; produs: string; data_ceruta: string; marimi: MarimeProd[]; cerut: number; croit: number; dat: number; gata: number; de_dat: number };
export type AlocareProd = { id: string; faza: string; utilaj: string | null; om: string };
export type ComandaProd = {
  comanda_id: string; numar: string; tip: string; brand: string; prioritate: number; kam: string | null;
  model: string; model_ids: string[]; timp_min_buc: number | null; oameni: number | null; data_ceruta: string;
  culori: CuloareProd[]; croit: number; dat: number; gata: number; de_dat: number; in_lucru: number;
  alocari: AlocareProd[]; faze_model: string[];
};

type Rand = {
  comanda_id: string; numar: string; tip: string; brand: string; prioritate: number; kam: string | null; oameni: number | null;
  linie_id: string; produs: string; model_id: string | null; model: string; timp_min_buc: number | null; data_ceruta: string;
  marime_id: string; marime: string; cerut: number; croit: number; dat: number; gata: number;
};

export async function comenziInProductie(): Promise<ComandaProd[]> {
  const randuri = await interogare<Rand>(
    `WITH croit AS (
         SELECT pl.linie_id, le.marime_id, sum(le.cantitate)::int AS q
           FROM planificare pl JOIN lot_croit lc ON lc.planificare_id = pl.id
           JOIN lot_croit_efectiv le ON le.lot_id = lc.id GROUP BY 1, 2),
     dat AS (
         SELECT pl.linie_id, ac.marime_id, sum(ac.cantitate)::int AS q,
                sum(ac.cantitate) FILTER (WHERE ab.iesit_productie_la IS NOT NULL)::int AS gata
           FROM planificare pl JOIN lot_croit lc ON lc.planificare_id = pl.id
           JOIN alimentare_banda ab ON ab.lot_id = lc.id
           JOIN alimentare_cantitate ac ON ac.alimentare_id = ab.id GROUP BY 1, 2),
     comenzi AS (
         -- s-a croit ceva și mai e ceva de dat în lucru sau ceva în lucru
         SELECT DISTINCT cl.comanda_id FROM comanda_linie cl
           JOIN croit cr ON cr.linie_id = cl.id
           LEFT JOIN dat d ON d.linie_id = cl.id AND d.marime_id = cr.marime_id
          WHERE cr.q > coalesce(d.q, 0) OR coalesce(d.q, 0) > coalesce(d.gata, 0))
     SELECT c.id AS comanda_id, c.numar, c.tip::text AS tip, b.nume AS brand, c.prioritate, k.nume AS kam, c.oameni_productie AS oameni,
            cl.id AS linie_id, p.denumire AS produs, p.model_id, coalesce(mo.denumire, p.denumire) AS model,
            mo.timp_min_buc::float AS timp_min_buc, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
            cc.marime_id, m.cod AS marime, cc.cantitate AS cerut,
            coalesce(cr.q, 0) AS croit, coalesce(d.q, 0) AS dat, coalesce(d.gata, 0) AS gata
       FROM comenzi x
       JOIN comanda c            ON c.id = x.comanda_id
       JOIN brand b              ON b.id = c.brand_id
       LEFT JOIN utilizator k    ON k.id = c.kam_id
       JOIN comanda_linie cl     ON cl.comanda_id = c.id
       JOIN produs p             ON p.id = cl.produs_id
       LEFT JOIN model mo        ON mo.id = p.model_id
       JOIN comanda_cantitate cc ON cc.linie_id = cl.id
       JOIN marime m             ON m.id = cc.marime_id
       LEFT JOIN croit cr ON cr.linie_id = cl.id AND cr.marime_id = cc.marime_id
       LEFT JOIN dat d    ON d.linie_id = cl.id AND d.marime_id = cc.marime_id
      ORDER BY c.tip DESC, c.numar, p.denumire`);
  const ids = [...new Set(randuri.map((r) => r.comanda_id))];
  const [alocari, faze] = await Promise.all([
    interogare<AlocareProd & { comanda_id: string }>(
      `SELECT x.id, x.comanda_id, x.faza, x.utilaj, a.nume AS om FROM alocare_comanda x JOIN angajat a ON a.id = x.angajat_id
        WHERE x.comanda_id = ANY ($1::uuid[]) ORDER BY x.creat_la`, [ids]),
    interogare<{ model_id: string; denumire: string }>(
      `SELECT model_id, denumire FROM model_operatie WHERE model_id = ANY ($1::uuid[]) ORDER BY ordine`,
      [[...new Set(randuri.map((r) => r.model_id).filter(Boolean))]]),
  ]);

  const pe = new Map<string, ComandaProd>();
  const linii = new Map<string, CuloareProd>();
  for (const r of randuri) {
    let c = pe.get(r.comanda_id);
    if (!c) {
      c = { comanda_id: r.comanda_id, numar: r.numar, tip: r.tip, brand: r.brand, prioritate: r.prioritate, kam: r.kam,
            model: r.model, model_ids: [], timp_min_buc: r.timp_min_buc, oameni: r.oameni, data_ceruta: r.data_ceruta,
            culori: [], croit: 0, dat: 0, gata: 0, de_dat: 0, in_lucru: 0,
            alocari: alocari.filter((a) => a.comanda_id === r.comanda_id).map(({ comanda_id: _, ...a }) => a), faze_model: [] };
      pe.set(r.comanda_id, c);
    }
    if (r.model_id && !c.model_ids.includes(r.model_id)) c.model_ids.push(r.model_id);
    if (!c.model.split(', ').includes(r.model)) c.model += `, ${r.model}`;
    if (r.data_ceruta < c.data_ceruta) c.data_ceruta = r.data_ceruta;
    let l = linii.get(r.linie_id);
    if (!l) {
      l = { linie_id: r.linie_id, produs: r.produs, data_ceruta: r.data_ceruta, marimi: [], cerut: 0, croit: 0, dat: 0, gata: 0, de_dat: 0 };
      linii.set(r.linie_id, l);
      c.culori.push(l);
    }
    const de_dat = Math.max(0, r.croit - r.dat);
    l.marimi.push({ marime_id: r.marime_id, marime: r.marime, cerut: r.cerut, croit: r.croit, dat: r.dat, gata: r.gata, de_dat });
    l.cerut += r.cerut; l.croit += r.croit; l.dat += r.dat; l.gata += r.gata; l.de_dat += de_dat;
    c.croit += r.croit; c.dat += r.dat; c.gata += r.gata; c.de_dat += de_dat; c.in_lucru += r.dat - r.gata;
  }
  for (const c of pe.values()) {
    for (const l of c.culori) l.marimi.sort((a, b) => rangMarime(a.marime) - rangMarime(b.marime));
    c.faze_model = [...new Set(faze.filter((f) => c.model_ids.includes(f.model_id)).map((f) => f.denumire))];
  }
  return [...pe.values()];
}

/** Ziua estimată de gata: bucățile rămase × minute pe bucată, împărțite la oameni și la orele pe zi, în zile lucrătoare de azi. */
export function gataEstimat(c: ComandaProd, orePeZi: number, azi: string): string | null {
  if (!c.timp_min_buc || !c.oameni) return null;
  const ramase = Math.max(0, c.culori.reduce((s, l) => s + l.cerut, 0) - c.gata);
  const zile = Math.max(1, Math.ceil((ramase * c.timp_min_buc / 60) / (c.oameni * orePeZi)));
  return adaugaZileLucratoare(azi, zile);
}

/**
 * Dă în lucru o culoare: bucățile scrise pe mărimi, luate din loturile ei croite în
 * ordine (întâi cel mai vechi). Fiecare lot atins devine o tranșă care intră acum în lucru.
 */
export async function daInLucruCuloare(linieId: string, cantitati: Map<string, number>): Promise<string | null> {
  if (![...cantitati.values()].some((q) => q > 0)) return 'Scrie câte bucăți intră în lucru (sau „Tot").';
  if ([...cantitati.values()].some((q) => !Number.isInteger(q) || q < 0)) return 'Bucățile trebuie să fie numere întregi.';
  const loturi = await interogare<{ lot_id: string; marime_id: string; rest: number }>(
    `SELECT ra.lot_id, ra.marime_id, ra.rest FROM lot_rest_de_alimentat ra
       JOIN lot_croit lc ON lc.id = ra.lot_id JOIN planificare pl ON pl.id = lc.planificare_id
      WHERE pl.linie_id = $1 AND ra.rest > 0 ORDER BY lc.croit_la, lc.numar_lot`, [linieId]);
  const ramas = new Map(cantitati);
  const peLot = new Map<string, Map<string, number>>();
  for (const r of loturi) {
    const vreau = ramas.get(r.marime_id) ?? 0;
    if (vreau <= 0) continue;
    const q = Math.min(vreau, r.rest);
    peLot.set(r.lot_id, (peLot.get(r.lot_id) ?? new Map()).set(r.marime_id, q));
    ramas.set(r.marime_id, vreau - q);
  }
  if ([...ramas.values()].some((q) => q > 0)) return 'Ai scris mai mult decât s-a croit și n-a intrat încă în lucru.';
  for (const [lotId, q] of peLot) {
    const r = await alimenteaza({ lotId, cantitati: q, persoane: null, timpMinBuc: null, responsabil: '', observatii: '' });
    if ('eroare' in r) return r.eroare;
    await interogare(`UPDATE alimentare_banda SET intrat_productie_la = now() WHERE id = $1`, [r.id]);
  }
  return null;
}

/** Minutele pe bucată (pe modelele comenzii) și câți oameni lucrează la comandă. */
export async function salveazaTimpOameni(comandaId: string, minute: number | null, oameni: number | null): Promise<string | null> {
  if (minute !== null && !(minute > 0)) return 'Minutele pe bucată trebuie să fie mai mari ca zero.';
  if (oameni !== null && !(Number.isInteger(oameni) && oameni > 0)) return 'Numărul de oameni trebuie să fie întreg, mai mare ca zero.';
  await caFirma(firmaCurenta(), async (c) => {
    await c.query(`UPDATE comanda SET oameni_productie = $2 WHERE id = $1`, [comandaId, oameni]);
    if (minute !== null) {
      await c.query(
        `UPDATE model SET timp_min_buc = $2 WHERE id IN (
           SELECT p.model_id FROM comanda_linie cl JOIN produs p ON p.id = cl.produs_id WHERE cl.comanda_id = $1 AND p.model_id IS NOT NULL)`,
        [comandaId, minute]);
    }
  });
  return null;
}

export async function adaugaAlocareComanda(comandaId: string, faza: string, utilaj: string, angajatId: string): Promise<string | null> {
  if (!faza.trim()) return 'Scrie faza (sau alege-o din listă).';
  if (!angajatId) return 'Alege omul.';
  await interogare(
    `INSERT INTO alocare_comanda (firma_id, comanda_id, faza, utilaj, angajat_id) VALUES (firma_curenta(), $1, $2, nullif($3, ''), $4)`,
    [comandaId, faza.trim(), utilaj.trim(), angajatId]);
  return null;
}

export async function stergeAlocareComanda(id: string): Promise<void> {
  await interogare(`DELETE FROM alocare_comanda WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------- planul pe săptămâni, după termen

/** Unde e o culoare (sau o comandă) pe drum: necroită, doar croită, intrată în lucru, ieșită din lucru, terminată (în depozit). */
export const STADII_PLAN = {
  necroit: 'Necroit',
  croit: 'Doar croit',
  in_lucru: 'Intrat în lucru',
  iesit: 'Ieșit din lucru',
  terminat: 'Terminat',
} as const;
export type StadiuPlan = keyof typeof STADII_PLAN;
const ORDINE_PLAN: StadiuPlan[] = ['necroit', 'croit', 'in_lucru', 'iesit', 'terminat'];

export type MarimePlan = MarimeProd & { depozit: number };
export type CuloarePlan = Omit<CuloareProd, 'marimi'> & { marimi: MarimePlan[]; depozit: number; stadiu: StadiuPlan; inchisa: boolean };
export type ComandaPlan = {
  comanda_id: string; numar: string; tip: string; brand: string; prioritate: number; kam: string | null; model: string;
  saptamana: string;            // lunea săptămânii termenului (întârziatele nefăcute stau în săptămâna de acum)
  intarziata: boolean;
  urgenta: boolean;             // adusă la urgență în săptămâna asta, peste plan (termenul ei e altul)
  data_ceruta: string; culori: CuloarePlan[];
  cerut: number; croit: number; dat: number; gata: number; depozit: number; de_dat: number;
  ramas_de_intrat: number;      // din comandă, încă neintrat în lucru (croit sau nu)
  stadiu: StadiuPlan;
};

const stadiulCulorii = (l: { cerut: number; croit: number; dat: number; gata: number; depozit: number; inchisa: boolean }): StadiuPlan =>
  l.inchisa || l.depozit >= l.cerut ? 'terminat'
    : l.dat > 0 && l.gata >= l.dat ? 'iesit'
    : l.dat > 0 ? 'in_lucru'
    : l.croit > 0 ? 'croit' : 'necroit';

/**
 * Planul pe săptămâni se face singur, după termen: în fiecare săptămână intră comenzile
 * (pe culori) cu termenul în ea. Ce a rămas nefăcut cu termenul trecut apare în săptămâna
 * de acum, ca întârziat. Fiecare culoare își are stadiul și mărimile — cerut, croit, dat
 * în lucru, ieșit, în depozit — ca să se dea în lucru exact ce intră.
 */
export async function planPeSaptamani(de: string, pana: string, curenta: string, luniDe: (zi: string) => string): Promise<ComandaPlan[]> {
  const sfarsit = new Date(`${pana}T12:00:00Z`); sfarsit.setUTCDate(sfarsit.getUTCDate() + 6);
  const panaLa = sfarsit.toISOString().slice(0, 10);
  const randuri = await interogare<Rand & { depozit: number; inchisa: boolean; urgent: string | null }>(
    `WITH croit AS (
         SELECT pl.linie_id, le.marime_id, sum(le.cantitate)::int AS q
           FROM planificare pl JOIN lot_croit lc ON lc.planificare_id = pl.id
           JOIN lot_croit_efectiv le ON le.lot_id = lc.id GROUP BY 1, 2),
     dat AS (
         SELECT pl.linie_id, ac.marime_id, sum(ac.cantitate)::int AS q,
                sum(ac.cantitate) FILTER (WHERE ab.iesit_productie_la IS NOT NULL)::int AS gata
           FROM planificare pl JOIN lot_croit lc ON lc.planificare_id = pl.id
           JOIN alimentare_banda ab ON ab.lot_id = lc.id
           JOIN alimentare_cantitate ac ON ac.alimentare_id = ab.id GROUP BY 1, 2),
     depozit AS (
         SELECT e.linie_id, e.marime_id, sum(r.cantitate)::int AS q, bool_or(r.inchide_pozitia) AS inchisa
           FROM eticheta e JOIN receptie r ON r.eticheta_id = e.id GROUP BY 1, 2)
     SELECT c.id AS comanda_id, c.numar, c.tip::text AS tip, b.nume AS brand, c.prioritate, k.nume AS kam, c.oameni_productie AS oameni,
            cl.id AS linie_id, p.denumire AS produs, p.model_id, coalesce(mo.denumire, p.denumire) AS model,
            mo.timp_min_buc::float AS timp_min_buc, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
            cc.marime_id, m.cod AS marime, cc.cantitate AS cerut,
            coalesce(cr.q, 0) AS croit, coalesce(d.q, 0) AS dat, coalesce(d.gata, 0) AS gata,
            coalesce(dp.q, 0) AS depozit, coalesce(dp.inchisa, false) AS inchisa,
            (SELECT to_char(min(x.saptamana), 'YYYY-MM-DD') FROM plan_linie x WHERE x.linie_id = cl.id) AS urgent
       FROM comanda c
       JOIN brand b              ON b.id = c.brand_id
       LEFT JOIN utilizator k    ON k.id = c.kam_id
       JOIN comanda_linie cl     ON cl.comanda_id = c.id
       JOIN produs p             ON p.id = cl.produs_id
       LEFT JOIN model mo        ON mo.id = p.model_id
       JOIN comanda_cantitate cc ON cc.linie_id = cl.id
       JOIN marime m             ON m.id = cc.marime_id
       LEFT JOIN croit cr  ON cr.linie_id = cl.id AND cr.marime_id = cc.marime_id
       LEFT JOIN dat d     ON d.linie_id = cl.id AND d.marime_id = cc.marime_id
       LEFT JOIN depozit dp ON dp.linie_id = cl.id AND dp.marime_id = cc.marime_id
      WHERE c.stare IN ('lansata', 'in_productie', 'inchisa')
        AND ((cl.data_ceruta <= $2::date
              AND (cl.data_ceruta >= $1::date OR ($3::date BETWEEN $1::date AND $2::date AND c.stare <> 'inchisa')))
          OR EXISTS (SELECT 1 FROM plan_linie x WHERE x.linie_id = cl.id AND x.saptamana BETWEEN $1::date AND $2::date))
      ORDER BY cl.data_ceruta, c.prioritate, c.numar, p.denumire`, [de, panaLa, curenta]);

  const linii = new Map<string, CuloarePlan & { comanda_id: string }>();
  const info = new Map<string, Rand>();
  const modelLinie = new Map<string, string>();
  const urgentLinie = new Map<string, string | null>();
  for (const r of randuri) {
    info.set(r.comanda_id, r);
    modelLinie.set(r.linie_id, r.model);
    urgentLinie.set(r.linie_id, r.urgent);
    let l = linii.get(r.linie_id);
    if (!l) {
      l = { comanda_id: r.comanda_id, linie_id: r.linie_id, produs: r.produs, data_ceruta: r.data_ceruta, marimi: [],
            cerut: 0, croit: 0, dat: 0, gata: 0, de_dat: 0, depozit: 0, stadiu: 'necroit', inchisa: true };
      linii.set(r.linie_id, l);
    }
    const de_dat = Math.max(0, r.croit - r.dat);
    l.marimi.push({ marime_id: r.marime_id, marime: r.marime, cerut: r.cerut, croit: r.croit, dat: r.dat, gata: r.gata, de_dat, depozit: r.depozit });
    l.cerut += r.cerut; l.croit += r.croit; l.dat += r.dat; l.gata += r.gata; l.de_dat += de_dat; l.depozit += r.depozit;
    l.inchisa = l.inchisa && (r.inchisa || r.depozit >= r.cerut);
  }
  const pe = new Map<string, ComandaPlan>();
  for (const l of linii.values()) {
    l.stadiu = stadiulCulorii(l);
    l.marimi.sort((a, b) => rangMarime(a.marime) - rangMarime(b.marime));
    // Săptămâna culorii: cea în care a fost adusă la urgență, altfel a termenului. Ce a
    // rămas nefăcut dintr-o săptămână trecută stă în săptămâna de acum.
    const urgent = urgentLinie.get(l.linie_id) ?? null;
    const proprie = urgent ?? luniDe(l.data_ceruta);
    const intarziata = proprie < curenta && l.stadiu !== 'terminat';
    const saptamana = intarziata ? curenta : proprie;
    if (saptamana < de || saptamana > pana) continue;   // în afara perioadei (sau terminată, cu termen trecut)
    const r = info.get(l.comanda_id)!;
    const cheie = `${l.comanda_id}|${saptamana}`;
    let c = pe.get(cheie);
    if (!c) {
      c = { comanda_id: r.comanda_id, numar: r.numar, tip: r.tip, brand: r.brand, prioritate: r.prioritate, kam: r.kam, model: modelLinie.get(l.linie_id)!,
            saptamana, intarziata: false, urgenta: false, data_ceruta: l.data_ceruta, culori: [], cerut: 0, croit: 0, dat: 0, gata: 0, depozit: 0,
            de_dat: 0, ramas_de_intrat: 0, stadiu: 'terminat' };
      pe.set(cheie, c);
    }
    const { comanda_id: _, ...culoare } = l;
    c.culori.push(culoare);
    const model = modelLinie.get(l.linie_id)!;
    if (!c.model.split(', ').includes(model)) c.model += `, ${model}`;
    if (l.data_ceruta < c.data_ceruta) c.data_ceruta = l.data_ceruta;
    c.intarziata = c.intarziata || (intarziata && l.data_ceruta < curenta);
    c.urgenta = c.urgenta || (urgent !== null && urgent !== luniDe(l.data_ceruta));
    c.cerut += l.cerut; c.croit += l.croit; c.dat += l.dat; c.gata += l.gata; c.depozit += l.depozit; c.de_dat += l.de_dat;
    if (l.stadiu !== 'terminat') c.ramas_de_intrat += Math.max(0, l.cerut - l.dat);
    if (ORDINE_PLAN.indexOf(l.stadiu) < ORDINE_PLAN.indexOf(c.stadiu)) c.stadiu = l.stadiu;
  }
  return [...pe.values()].sort((a, b) => a.saptamana.localeCompare(b.saptamana) || a.data_ceruta.localeCompare(b.data_ceruta)
    || a.prioritate - b.prioritate || a.numar.localeCompare(b.numar));
}

/** Comenzile deschise care se potrivesc căutării (PSF/PSC, model sau produs), pentru reprioritizare. */
export async function cautaComenziDeschise(q: string): Promise<{ comanda_id: string; numar: string; tip: string; brand: string; model: string; data_ceruta: string; cerut: number }[]> {
  if (!q.trim()) return [];
  return interogare(
    `SELECT c.id AS comanda_id, c.numar, c.tip::text AS tip, b.nume AS brand,
            string_agg(DISTINCT coalesce(mo.denumire, p.denumire), ', ') AS model,
            to_char(min(cl.data_ceruta), 'YYYY-MM-DD') AS data_ceruta,
            (SELECT sum(cc.cantitate) FROM comanda_cantitate cc JOIN comanda_linie y ON y.id = cc.linie_id WHERE y.comanda_id = c.id)::int AS cerut
       FROM comanda c JOIN brand b ON b.id = c.brand_id
       JOIN comanda_linie cl ON cl.comanda_id = c.id JOIN produs p ON p.id = cl.produs_id LEFT JOIN model mo ON mo.id = p.model_id
      WHERE c.stare IN ('lansata', 'in_productie')
        AND (c.numar ILIKE '%' || $1 || '%' OR p.denumire ILIKE '%' || $1 || '%' OR mo.denumire ILIKE '%' || $1 || '%')
      GROUP BY c.id, c.numar, c.tip, b.nume
      ORDER BY min(cl.data_ceruta), c.numar LIMIT 20`, [q.trim()]);
}

/** Adu o comandă la urgență într-o săptămână, peste plan: toate culorile ei se lucrează atunci. */
export async function aduLaUrgenta(comandaId: string, saptamana: string): Promise<void> {
  await caFirma(firmaCurenta(), async (c) => {
    await c.query(`DELETE FROM plan_linie WHERE linie_id IN (SELECT id FROM comanda_linie WHERE comanda_id = $1)`, [comandaId]);
    await c.query(
      `INSERT INTO plan_linie (firma_id, linie_id, saptamana) SELECT firma_curenta(), id, $2::date FROM comanda_linie WHERE comanda_id = $1`,
      [comandaId, saptamana]);
  });
}

/** Scoate urgența: comanda se întoarce în săptămâna termenului ei. */
export async function scoateUrgenta(comandaId: string): Promise<void> {
  await interogare(`DELETE FROM plan_linie WHERE linie_id IN (SELECT id FROM comanda_linie WHERE comanda_id = $1)`, [comandaId]);
}

/** Tranșele unei culori de pe bandă (prin loturile croite ale culorii). */
const TRANSE_CULOARE = `SELECT ab.id FROM alimentare_banda ab JOIN lot_croit lc ON lc.id = ab.lot_id
                         JOIN planificare pl ON pl.id = lc.planificare_id WHERE pl.linie_id = $1`;

/** Culoarea a ieșit din lucru: toate tranșele ei încă în lucru ies acum (ca „A ieșit gata"). */
export async function iesitDinLucruCuloare(linieId: string): Promise<string | null> {
  const transe = await interogare<{ id: string }>(`${TRANSE_CULOARE} AND ab.iesit_productie_la IS NULL`, [linieId]);
  if (!transe.length) return 'Culoarea nu are nimic în lucru.';
  for (const t of transe) await iesitGata(t.id);
  return null;
}

/**
 * Iese din lucru doar o parte din culoare, pe mărimi. Se ia din tranșele în lucru, de la
 * cea mai veche: o tranșă luată toată iese întreagă; din una luată pe jumătate se desparte
 * o tranșă nouă (același lot, aceleași date de intrare) cu bucățile ieșite, iar restul
 * rămâne în lucru, cu oamenii ei.
 */
export async function iesitPartialCuloare(linieId: string, cantitati: Map<string, number>): Promise<string | null> {
  const cerute = [...cantitati].filter(([, q]) => q > 0);
  if (cerute.some(([, q]) => !Number.isInteger(q))) return 'Cantitățile trebuie să fie numere întregi.';
  if (!cerute.length) return 'Scrie câte bucăți au ieșit, pe mărimi (sau „Tot a ieșit").';
  const randuri = await interogare<{ id: string; marime_id: string; cantitate: number }>(
    `SELECT ab.id, ac.marime_id, ac.cantitate FROM alimentare_banda ab JOIN alimentare_cantitate ac ON ac.alimentare_id = ab.id
      WHERE ab.id IN (${TRANSE_CULOARE}) AND ab.iesit_productie_la IS NULL ORDER BY ab.alimentat_la, ab.numar`, [linieId]);
  for (const [m, q] of cerute) {
    const inLucru = randuri.filter((r) => r.marime_id === m).reduce((s, r) => s + r.cantitate, 0);
    if (q > inLucru) return `Pe o mărime au fost scrise ${q} buc, dar în lucru sunt doar ${inLucru}.`;
  }
  // Ce iese din fiecare tranșă, pe mărimi.
  const rest = new Map(cerute);
  const iesePe = new Map<string, Map<string, number>>();
  for (const r of randuri) {
    const q = Math.min(rest.get(r.marime_id) ?? 0, r.cantitate);
    if (q <= 0) continue;
    rest.set(r.marime_id, (rest.get(r.marime_id) ?? 0) - q);
    iesePe.set(r.id, (iesePe.get(r.id) ?? new Map()).set(r.marime_id, q));
  }
  const intregi: string[] = [];
  await caFirma(firmaCurenta(), async (c) => {
    for (const [id, ies] of iesePe) {
      const aTranse = randuri.filter((r) => r.id === id);
      if (aTranse.every((r) => (ies.get(r.marime_id) ?? 0) === r.cantitate)) { intregi.push(id); continue; }
      const { rows: [nou] } = await c.query<{ id: string }>(
        `INSERT INTO alimentare_banda (firma_id, lot_id, numar, alimentat_la, alimentat_de, responsabil, persoane, timp_min_buc,
                                       intrat_productie_la, iesit_productie_la, observatii)
         SELECT firma_id, lot_id, (SELECT max(numar) + 1 FROM alimentare_banda x WHERE x.lot_id = ab.lot_id), alimentat_la, alimentat_de,
                responsabil, persoane, timp_min_buc, coalesce(intrat_productie_la, alimentat_la), now(),
                concat_ws(' · ', observatii, 'ieșită parțial din tranșa ' || numar)
           FROM alimentare_banda ab WHERE id = $1 RETURNING id`, [id]);
      for (const [m, q] of ies) {
        await c.query(`INSERT INTO alimentare_cantitate (firma_id, alimentare_id, marime_id, cantitate) VALUES (firma_curenta(), $1, $2, $3)`, [nou.id, m, q]);
        // Cantitatea nu poate ajunge la zero (CHECK > 0): mărimea luată toată se șterge din tranșa veche.
        if (q === aTranse.find((r) => r.marime_id === m)?.cantitate) {
          await c.query(`DELETE FROM alimentare_cantitate WHERE alimentare_id = $1 AND marime_id = $2`, [id, m]);
        } else {
          await c.query(`UPDATE alimentare_cantitate SET cantitate = cantitate - $3 WHERE alimentare_id = $1 AND marime_id = $2`, [id, m, q]);
        }
      }
    }
  });
  for (const id of intregi) await iesitGata(id);
  return null;
}

/**
 * Culoarea se întoarce în lucru (ieșită din greșeală): tranșele ei ieșite se redeschid.
 * Doar cele care n-au trecut încă de CTC și nimic din culoare n-a intrat în depozit.
 */
export async function inapoiInLucruCuloare(linieId: string, inDepozit: number): Promise<string | null> {
  if (inDepozit > 0) return 'Din culoarea asta a intrat deja marfă în depozit; nu se mai poate întoarce în lucru.';
  const r = await interogare<{ id: string }>(
    `UPDATE alimentare_banda SET iesit_productie_la = NULL WHERE id IN (${TRANSE_CULOARE}) AND iesit_productie_la IS NOT NULL AND ctc_la IS NULL RETURNING id`, [linieId]);
  if (!r.length) return 'Ce a ieșit din lucru din culoarea asta a trecut deja de CTC; nu se mai poate întoarce în lucru.';
  await interogare(`UPDATE alocare_operatie SET gata_la = NULL WHERE alimentare_id = ANY($1::uuid[])`, [r.map((x) => x.id)]);
  return null;
}
