import type { PoolClient } from 'pg';
import { caFirma } from './db';
import { firmaCurenta, interogare } from './sesiune';

/** Etapele unei tranșe pe bandă, în ordine. Fiecare cere etapa de dinainte (CHECK în 0010). */
export const ETAPE_BANDA = [
  ['intrat_productie_la', 'Intrat în producție'],
  ['iesit_productie_la', 'Ieșit din producție'],
  ['ctc_la', 'CTC și ambalare'],
  ['predat_depozit_la', 'Predat la depozit'],
] as const;
export type EtapaBanda = (typeof ETAPE_BANDA)[number][0];

export type LotDeAlimentat = {
  lot_id: string;
  cod: string;
  comanda: string;
  prioritate: number;
  data_ceruta: string;
  produs: string;
  croit_la: string;
  saptamana: string | null;   // săptămâna din planul de producție
  croit: number;
  alimentat: number;
  rest: number;
  marimi: { marime: string; rest: number }[];
};

/**
 * Loturile croite care mai au bucăți de dat pe bandă: croit minus ce a intrat
 * deja. Urgența întâi, apoi termenul — ordinea în care șeful de bandă le ia.
 */
export async function deAlimentat(): Promise<LotDeAlimentat[]> {
  const randuri = await interogare<Omit<LotDeAlimentat, 'marimi' | 'croit' | 'alimentat' | 'rest'>
    & { marime: string; croit_m: number; alimentat_m: number; rest_m: number }>(
    `SELECT ra.lot_id, c.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot AS cod,
            c.numar AS comanda, c.prioritate, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
            p.denumire AS produs, to_char(lc.croit_la, 'YYYY-MM-DD') AS croit_la,
            to_char(ps.saptamana, 'YYYY-MM-DD') AS saptamana,
            m.cod AS marime, ra.croit AS croit_m, ra.alimentat AS alimentat_m, ra.rest AS rest_m
       FROM lot_rest_de_alimentat ra
       JOIN lot_croit lc     ON lc.id = ra.lot_id
       JOIN planificare pl   ON pl.id = lc.planificare_id
       JOIN comanda_linie cl ON cl.id = pl.linie_id
       JOIN comanda c        ON c.id = cl.comanda_id
       JOIN produs p         ON p.id = cl.produs_id
       JOIN marime m         ON m.id = ra.marime_id
       CROSS JOIN LATERAL (SELECT coalesce((SELECT min(x.saptamana) FROM plan_linie x WHERE x.linie_id = cl.id),
                                            date_trunc('week', cl.data_ceruta)::date) AS saptamana) ps   -- săptămâna din plan: a urgenței, altfel a termenului
      WHERE ra.lot_id IN (SELECT lot_id FROM lot_rest_de_alimentat GROUP BY lot_id HAVING sum(rest) > 0)
      ORDER BY ps.saptamana NULLS LAST, c.prioritate, cl.data_ceruta, c.numar, pl.numar_transa, lc.numar_lot, m.ordine`,
  );
  const pe = new Map<string, LotDeAlimentat>();
  for (const { marime, croit_m, alimentat_m, rest_m, ...r } of randuri) {
    const x = pe.get(r.lot_id) ?? { ...r, croit: 0, alimentat: 0, rest: 0, marimi: [] };
    x.croit += croit_m; x.alimentat += alimentat_m; x.rest += rest_m;
    if (rest_m > 0) x.marimi.push({ marime, rest: rest_m });
    pe.set(r.lot_id, x);
  }
  return [...pe.values()];
}

export type Transa = {
  id: string;
  cod: string;
  comanda: string;
  prioritate: number;
  data_ceruta: string;
  produs: string;
  bucati: number;
  alimentat_la: string;
  responsabil: string | null;
  etapa: string;          // ultima etapă atinsă, cum o citește omul
  eta: string | null;     // data estimată în depozit
  marja_zile: number | null;
  predat_la: string | null;
};

/**
 * Orele de lucru ale unei tranșe: bucăți × minute pe bucată / 60, ajustat după
 * cantitate — sub 50 de bucăți +20% (pornirea cântărește mai mult), peste 200 −15%
 * (mâna se încălzește). Minutele pe bucată vin din fișa de produs a modelului.
 */
const ORE_OM = `
  ((SELECT sum(cantitate) FROM alimentare_cantitate WHERE alimentare_id = ab.id) * ab.timp_min_buc / 60.0
   * CASE WHEN (SELECT sum(cantitate) FROM alimentare_cantitate WHERE alimentare_id = ab.id) < 50 THEN 1.2
          WHEN (SELECT sum(cantitate) FROM alimentare_cantitate WHERE alimentare_id = ab.id) > 200 THEN 0.85
          ELSE 1 END)`;

/**
 * Data estimată în depozit: zile = ore de lucru / (operatori × ore pe zi), rotunjit
 * în sus, în zile lucrătoare (fără sâmbete și duminici); de la intrarea în producție
 * (sau de la alimentare, dacă n-a intrat încă). Aceeași regulă ca în lib/timp.ts.
 * Fără operatori sau timp pe bucată nu se estimează nimic — o dată inventată e mai
 * rea decât niciuna.
 */
/**
 * Câți oameni lucrează la tranșă: cei alocați în „Cine lucrează" care n-au ieșit încă
 * gata; fără nicio alocare, numărul scris la alimentare.
 */
const ALOCATI = `(SELECT count(DISTINCT x.angajat_id) FROM alocare_operatie x WHERE x.alimentare_id = ab.id AND x.gata_la IS NULL)`;
const PERSOANE = `coalesce(nullif(${ALOCATI}, 0), ab.persoane)`;

const ETA = `
  CASE WHEN ${PERSOANE} IS NOT NULL AND ab.timp_min_buc IS NOT NULL THEN
    adauga_zile_lucratoare(coalesce(ab.intrat_productie_la, ab.alimentat_la)::date,
      greatest(1, ceil(${ORE_OM} / (${PERSOANE} * coalesce((SELECT valoare FROM parametru WHERE cheie = 'ore_pe_zi'), 8))))::int)
  END`;

const ETAPA = `
  CASE WHEN ab.predat_depozit_la  IS NOT NULL THEN 'predat la depozit'
       WHEN ab.ctc_la             IS NOT NULL THEN 'la CTC / ambalare'
       WHEN ab.iesit_productie_la IS NOT NULL THEN 'ieșit din producție'
       WHEN ab.intrat_productie_la IS NOT NULL THEN 'în producție'
       ELSE 'alimentat' END`;

export async function transe(predate: boolean): Promise<Transa[]> {
  return interogare<Transa>(
    `SELECT ab.id, c.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot || '/B' || ab.numar AS cod,
            c.numar AS comanda, c.prioritate, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
            p.denumire AS produs,
            (SELECT sum(cantitate) FROM alimentare_cantitate WHERE alimentare_id = ab.id)::int AS bucati,
            to_char(ab.alimentat_la, 'YYYY-MM-DD HH24:MI') AS alimentat_la, ab.responsabil,
            ${ETAPA} AS etapa,
            to_char(${ETA}, 'YYYY-MM-DD') AS eta,
            (cl.data_ceruta - ${ETA})::int AS marja_zile,
            to_char(ab.predat_depozit_la, 'YYYY-MM-DD HH24:MI') AS predat_la
       FROM alimentare_banda ab
       JOIN lot_croit lc     ON lc.id = ab.lot_id
       JOIN planificare pl   ON pl.id = lc.planificare_id
       JOIN comanda_linie cl ON cl.id = pl.linie_id
       JOIN comanda c        ON c.id = cl.comanda_id
       JOIN produs p         ON p.id = cl.produs_id
      WHERE (ab.predat_depozit_la IS NOT NULL) = $1
      ORDER BY CASE WHEN $1 THEN NULL ELSE c.prioritate END, CASE WHEN $1 THEN NULL ELSE cl.data_ceruta END,
               ab.predat_depozit_la DESC NULLS LAST, ab.alimentat_la`,
    [predate],
  );
}

// ---------------------------------------------------------------- alimentare

export type LotPentruAlimentare = {
  lot: { id: string; cod: string; comanda: string; prioritate: number; data_ceruta: string; produs: string; cod_sku: string;
         timp_min_buc: string | null };
  marimi: { marime_id: string; marime: string; croit: number; alimentat: number; rest: number }[];
};

export async function lotPentruAlimentare(lotId: string): Promise<LotPentruAlimentare | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [lot] } = await c.query<LotPentruAlimentare['lot']>(
      `SELECT lc.id, c.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot AS cod, c.numar AS comanda,
              c.prioritate, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta, p.denumire AS produs, p.cod_sku,
              (SELECT mo.timp_min_buc::text FROM model mo WHERE mo.id = p.model_id) AS timp_min_buc
         FROM lot_croit lc
         JOIN planificare pl   ON pl.id = lc.planificare_id
         JOIN comanda_linie cl ON cl.id = pl.linie_id
         JOIN comanda c        ON c.id = cl.comanda_id
         JOIN produs p         ON p.id = cl.produs_id
        WHERE lc.id = $1 AND lc.croit_la IS NOT NULL`, [lotId]);
    if (!lot) return null;
    const { rows: marimi } = await c.query<LotPentruAlimentare['marimi'][number]>(
      `SELECT ra.marime_id, m.cod AS marime, ra.croit, ra.alimentat, ra.rest
         FROM lot_rest_de_alimentat ra JOIN marime m ON m.id = ra.marime_id
        WHERE ra.lot_id = $1 ORDER BY m.ordine`, [lotId]);
    return { lot, marimi };
  });
}

export type AlimentareNoua = {
  lotId: string;
  cantitati: Map<string, number>;
  persoane: number | null;
  timpMinBuc: number | null;
  responsabil: string;
  observatii: string;
};

/**
 * Dă pe bandă o tranșă dintr-un lot croit, într-o singură tranzacție: tranșa
 * …/B{n}, bucățile pe mărimi (niciodată peste ce s-a croit și n-a intrat deja) și
 * consumul de accesorii, care abia acum ies din depozit. Ca la croit, consumul nu
 * se oprește la stoc negativ: etichetele au fost puse, deci au existat.
 */
export async function alimenteaza(a: AlimentareNoua, client?: PoolClient): Promise<{ id: string } | { eroare: string }> {
  if (a.persoane != null && !(Number.isInteger(a.persoane) && a.persoane > 0)) return { eroare: 'Numărul de persoane trebuie să fie întreg, mai mare ca zero.' };
  if (a.timpMinBuc != null && !(a.timpMinBuc > 0)) return { eroare: 'Timpul pe bucată trebuie să fie mai mare ca zero.' };
  // Cu `client`, în tranzacția celui care cheamă (mai multe loturi deodată, totul sau nimic).
  const lucreaza = async (c: PoolClient): Promise<{ id: string } | { eroare: string }> => {
    const { rows: [lot] } = await c.query<{ croit_la: string | null }>(
      `SELECT croit_la FROM lot_croit WHERE id = $1 FOR UPDATE`, [a.lotId]);
    if (!lot) return { eroare: 'Lotul nu există.' };
    if (!lot.croit_la) return { eroare: 'Lotul nu e croit încă.' };
    const { rows: rest } = await c.query<{ marime_id: string; marime: string; rest: number }>(
      `SELECT ra.marime_id, m.cod AS marime, ra.rest FROM lot_rest_de_alimentat ra
         JOIN marime m ON m.id = ra.marime_id WHERE ra.lot_id = $1`, [a.lotId]);
    const alese: { marime_id: string; q: number }[] = [];
    for (const r of rest) {
      const q = a.cantitati.get(r.marime_id) ?? 0;
      if (!Number.isInteger(q) || q < 0) return { eroare: `Cantitate nevalidă la ${r.marime}.` };
      if (q > r.rest) return { eroare: `La ${r.marime} au rămas de dat pe bandă doar ${r.rest}.` };
      if (q > 0) alese.push({ marime_id: r.marime_id, q });
    }
    if (alese.length === 0) return { eroare: 'Tranșa nu are nicio bucată.' };

    const { rows: [{ id }] } = await c.query<{ id: string }>(
      `INSERT INTO alimentare_banda (firma_id, lot_id, numar, persoane, timp_min_buc, responsabil, observatii)
       VALUES (firma_curenta(), $1, (SELECT coalesce(max(numar), 0) + 1 FROM alimentare_banda WHERE lot_id = $1),
               $2, $3, nullif($4, ''), nullif($5, ''))
       RETURNING id`, [a.lotId, a.persoane, a.timpMinBuc, a.responsabil.trim(), a.observatii.trim()]);
    for (const x of alese) {
      await c.query(
        `INSERT INTO alimentare_cantitate (firma_id, alimentare_id, marime_id, cantitate) VALUES (firma_curenta(), $1, $2, $3)`,
        [id, x.marime_id, x.q]);
    }
    const bucati = alese.reduce((s, x) => s + x.q, 0);
    await c.query(
      `INSERT INTO miscare_stoc (firma_id, material_id, tip, cantitate, alimentare_id)
       SELECT firma_curenta(), pm.material_id, 'consum_banda', -(sum(mc.consum) * $2)::numeric(12,3), $3
         FROM lot_croit lc
         JOIN planificare pl      ON pl.id = lc.planificare_id
         JOIN comanda_linie cl    ON cl.id = pl.linie_id
         JOIN produs_material pm  ON pm.produs_id = cl.produs_id AND pm.tip = 'accesoriu'
         JOIN model_componenta mc ON mc.id = pm.componenta_id
        WHERE lc.id = $1
        GROUP BY pm.material_id
       HAVING sum(mc.consum) * $2 > 0`, [a.lotId, bucati, id]);
    return { id };
  };
  return client ? lucreaza(client) : caFirma(firmaCurenta(), lucreaza);
}

// ---------------------------------------------------------------- o tranșă

export type DetaliiTransa = {
  transa: { id: string; cod: string; lot_id: string; comanda: string; prioritate: number; data_ceruta: string;
            produs: string; cod_sku: string; alimentat_la: string; responsabil: string | null;
            persoane: number | null; alocati: number; timp_min_buc: string | null; observatii: string | null;
            eta: string | null; marja_zile: number | null; ore_om: string | null } & Record<EtapaBanda, string | null>;
  marimi: { marime: string; cantitate: number }[];
  accesorii: { material_id: string; denumire: string; unitate: string; consumat: string }[];
};

export async function detaliiTransa(id: string): Promise<DetaliiTransa | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [transa] } = await c.query<DetaliiTransa['transa']>(
      `SELECT ab.id, c.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot || '/B' || ab.numar AS cod,
              lc.id AS lot_id, c.numar AS comanda, c.prioritate, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
              p.denumire AS produs, p.cod_sku, to_char(ab.alimentat_la, 'YYYY-MM-DD HH24:MI') AS alimentat_la,
              ab.responsabil, ${PERSOANE}::int AS persoane, ${ALOCATI}::int AS alocati, ab.timp_min_buc::text AS timp_min_buc, ab.observatii,
              to_char(ab.intrat_productie_la, 'YYYY-MM-DD HH24:MI') AS intrat_productie_la,
              to_char(ab.iesit_productie_la, 'YYYY-MM-DD HH24:MI') AS iesit_productie_la,
              to_char(ab.ctc_la, 'YYYY-MM-DD HH24:MI') AS ctc_la,
              to_char(ab.predat_depozit_la, 'YYYY-MM-DD HH24:MI') AS predat_depozit_la,
              to_char(${ETA}, 'YYYY-MM-DD') AS eta, (cl.data_ceruta - ${ETA})::int AS marja_zile,
              ${ORE_OM}::numeric(10,1)::text AS ore_om
         FROM alimentare_banda ab
         JOIN lot_croit lc     ON lc.id = ab.lot_id
         JOIN planificare pl   ON pl.id = lc.planificare_id
         JOIN comanda_linie cl ON cl.id = pl.linie_id
         JOIN comanda c        ON c.id = cl.comanda_id
         JOIN produs p         ON p.id = cl.produs_id
        WHERE ab.id = $1`, [id]);
    if (!transa) return null;
    const { rows: marimi } = await c.query<DetaliiTransa['marimi'][number]>(
      `SELECT m.cod AS marime, ac.cantitate FROM alimentare_cantitate ac JOIN marime m ON m.id = ac.marime_id
        WHERE ac.alimentare_id = $1 ORDER BY m.ordine`, [id]);
    const { rows: accesorii } = await c.query<DetaliiTransa['accesorii'][number]>(
      `SELECT mt.id AS material_id, mt.denumire, mt.unitate::text AS unitate, (-ms.cantitate)::text AS consumat
         FROM miscare_stoc ms JOIN material mt ON mt.id = ms.material_id
        WHERE ms.alimentare_id = $1 ORDER BY mt.denumire`, [id]);
    return { transa, marimi, accesorii };
  });
}

/**
 * Bifează următoarea etapă, sau o debifează pe ultima (o greșeală de apăsare).
 * Ordinea o păzește baza: o etapă nu se poate bifa înaintea celei de dinainte.
 */
export async function schimbaEtapa(id: string, etapa: EtapaBanda, bifat: boolean): Promise<string | null> {
  const i = ETAPE_BANDA.findIndex(([k]) => k === etapa);
  if (i < 0) return 'Etapă necunoscută.';
  try {
    await interogare(`UPDATE alimentare_banda SET ${etapa} = ${bifat ? 'now()' : 'NULL'} WHERE id = $1`, [id]);
    return null;
  } catch (e) {
    if ((e as { code?: string }).code === '23514') {
      return bifat ? `Bifează întâi „${ETAPE_BANDA[i - 1]?.[1]}".` : `Debifează întâi „${ETAPE_BANDA[i + 1]?.[1]}".`;
    }
    throw e;
  }
}

// ---------------------------------------------------------------- în lucru, simplu

export type TransaSimpla = {
  id: string; cod: string; comanda: string; model: string; produs: string; bucati: number; marimi: string;
  intrat_la: string; gata_la: string | null; oameni: string | null; data_ceruta: string;
  intrat_ora: string; gata_ora: string | null;   // „02.11 09:30", la ora României
  minute: number;                                // de la intrarea în lucru până a ieșit gata (sau până acum)
};

/** Tranșele în lucru (neieșite) sau ieșite gata, cu mărimile și oamenii lor. */
export async function transeSimple(gata: boolean): Promise<TransaSimpla[]> {
  return interogare<TransaSimpla>(
    `SELECT ab.id, c.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot || '/B' || ab.numar AS cod, c.numar AS comanda,
            coalesce(mo.denumire, p.denumire) AS model, p.denumire AS produs,
            (SELECT sum(cantitate) FROM alimentare_cantitate WHERE alimentare_id = ab.id)::int AS bucati,
            (SELECT string_agg(m.cod || ' ' || ac.cantitate, ' · ' ORDER BY m.ordine) FROM alimentare_cantitate ac
               JOIN marime m ON m.id = ac.marime_id WHERE ac.alimentare_id = ab.id) AS marimi,
            -- ziua din România (nu a serverului), ca gruparea pe săptămâni să nu mute ce iese după miezul nopții
            to_char(coalesce(ab.intrat_productie_la, ab.alimentat_la) AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD') AS intrat_la,
            to_char(ab.iesit_productie_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD') AS gata_la,
            to_char(coalesce(ab.intrat_productie_la, ab.alimentat_la) AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI') AS intrat_ora,
            to_char(ab.iesit_productie_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI') AS gata_ora,
            round(extract(epoch FROM coalesce(ab.iesit_productie_la, now()) - coalesce(ab.intrat_productie_la, ab.alimentat_la)) / 60)::int AS minute,
            (SELECT string_agg(DISTINCT a.nume, ', ') FROM alocare_operatie x JOIN angajat a ON a.id = x.angajat_id
              WHERE x.alimentare_id = ab.id) AS oameni,
            to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta
       FROM alimentare_banda ab
       JOIN lot_croit lc     ON lc.id = ab.lot_id
       JOIN planificare pl   ON pl.id = lc.planificare_id
       JOIN comanda_linie cl ON cl.id = pl.linie_id
       JOIN comanda c        ON c.id = cl.comanda_id
       JOIN produs p         ON p.id = cl.produs_id
       LEFT JOIN model mo    ON mo.id = p.model_id
      WHERE (ab.iesit_productie_la IS NOT NULL) = $1
      ORDER BY CASE WHEN $1 THEN ab.iesit_productie_la END DESC, cl.data_ceruta, c.numar, p.denumire`, [gata]);
}

/**
 * „A ieșit gata": tranșa iese din producție acum (intrată, dacă nu era bifată); întoarce cât
 * a stat în lucru. Totul într-o tranzacție — cu `c`, în tranzacția celui care o cheamă.
 */
export async function iesitGata(id: string, c?: PoolClient): Promise<{ cod: string; minute: number } | null> {
  if (!c) return caFirma(firmaCurenta(), (cl) => iesitGata(id, cl));
  await c.query(
    `UPDATE alimentare_banda SET intrat_productie_la = coalesce(intrat_productie_la, now()), iesit_productie_la = now()
      WHERE id = $1 AND iesit_productie_la IS NULL`, [id]);
  await c.query(`UPDATE alocare_operatie SET gata_la = now(), incepe_la = coalesce(incepe_la, now()) WHERE alimentare_id = $1 AND gata_la IS NULL`, [id]);
  const { rows: [t] } = await c.query<{ cod: string; minute: number }>(
    `SELECT p.denumire AS cod,
            round(extract(epoch FROM ab.iesit_productie_la - coalesce(ab.intrat_productie_la, ab.alimentat_la)) / 60)::int AS minute
       FROM alimentare_banda ab JOIN lot_croit lc ON lc.id = ab.lot_id JOIN planificare pl ON pl.id = lc.planificare_id
       JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN produs p ON p.id = cl.produs_id WHERE ab.id = $1`, [id]);
  return t ?? null;
}

/** Câți oameni lucrează acum (alocați, neterminați) pe fiecare tranșă de pe bandă. */
export async function oameniPeTranse(): Promise<Map<string, number>> {
  const r = await interogare<{ id: string; n: number }>(
    `SELECT alimentare_id AS id, count(DISTINCT angajat_id)::int AS n FROM alocare_operatie WHERE gata_la IS NULL GROUP BY 1`);
  return new Map(r.map((x) => [x.id, x.n]));
}
