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
            m.cod AS marime, ra.croit AS croit_m, ra.alimentat AS alimentat_m, ra.rest AS rest_m
       FROM lot_rest_de_alimentat ra
       JOIN lot_croit lc     ON lc.id = ra.lot_id
       JOIN planificare pl   ON pl.id = lc.planificare_id
       JOIN comanda_linie cl ON cl.id = pl.linie_id
       JOIN comanda c        ON c.id = cl.comanda_id
       JOIN produs p         ON p.id = cl.produs_id
       JOIN marime m         ON m.id = ra.marime_id
      WHERE ra.lot_id IN (SELECT lot_id FROM lot_rest_de_alimentat GROUP BY lot_id HAVING sum(rest) > 0)
      ORDER BY c.prioritate, cl.data_ceruta, c.numar, pl.numar_transa, lc.numar_lot, m.ordine`,
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
 * Data estimată în depozit, ca în dashboard: ore-om = bucăți × minute pe bucată / 60;
 * zile = ore-om / (persoane × ore pe zi), rotunjit în sus; de la intrarea în
 * producție (sau de la alimentare, dacă n-a intrat încă). Fără persoane sau timp
 * pe bucată nu se estimează nimic — o dată inventată e mai rea decât niciuna.
 */
const ETA = `
  CASE WHEN ab.persoane IS NOT NULL AND ab.timp_min_buc IS NOT NULL THEN
    (coalesce(ab.intrat_productie_la, ab.alimentat_la)::date
      + ceil((SELECT sum(cantitate) FROM alimentare_cantitate WHERE alimentare_id = ab.id) * ab.timp_min_buc / 60.0
             / (ab.persoane * coalesce((SELECT valoare FROM parametru WHERE cheie = 'ore_pe_zi'), 8)))::int)
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
  lot: { id: string; cod: string; comanda: string; prioritate: number; data_ceruta: string; produs: string; cod_sku: string };
  marimi: { marime_id: string; marime: string; croit: number; alimentat: number; rest: number }[];
  accesorii: { denumire: string; unitate: string; consum: string }[];
};

export async function lotPentruAlimentare(lotId: string): Promise<LotPentruAlimentare | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [lot] } = await c.query<LotPentruAlimentare['lot']>(
      `SELECT lc.id, c.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot AS cod, c.numar AS comanda,
              c.prioritate, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta, p.denumire AS produs, p.cod_sku
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
    const { rows: accesorii } = await c.query<LotPentruAlimentare['accesorii'][number]>(
      `SELECT mt.denumire, mt.unitate::text AS unitate, sum(mc.consum)::text AS consum
         FROM lot_croit lc
         JOIN planificare pl      ON pl.id = lc.planificare_id
         JOIN comanda_linie cl    ON cl.id = pl.linie_id
         JOIN produs_material pm  ON pm.produs_id = cl.produs_id AND pm.tip = 'accesoriu'
         JOIN model_componenta mc ON mc.id = pm.componenta_id
         JOIN material mt         ON mt.id = pm.material_id
        WHERE lc.id = $1
        GROUP BY mt.id, mt.denumire, mt.unitate ORDER BY mt.denumire`, [lotId]);
    return { lot, marimi, accesorii };
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
export async function alimenteaza(a: AlimentareNoua): Promise<{ id: string } | { eroare: string }> {
  if (a.persoane != null && !(Number.isInteger(a.persoane) && a.persoane > 0)) return { eroare: 'Numărul de persoane trebuie să fie întreg, mai mare ca zero.' };
  if (a.timpMinBuc != null && !(a.timpMinBuc > 0)) return { eroare: 'Timpul pe bucată trebuie să fie mai mare ca zero.' };
  return caFirma(firmaCurenta(), async (c) => {
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
  });
}

// ---------------------------------------------------------------- o tranșă

export type DetaliiTransa = {
  transa: { id: string; cod: string; lot_id: string; comanda: string; prioritate: number; data_ceruta: string;
            produs: string; cod_sku: string; alimentat_la: string; responsabil: string | null;
            persoane: number | null; timp_min_buc: string | null; observatii: string | null;
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
              ab.responsabil, ab.persoane, ab.timp_min_buc::text AS timp_min_buc, ab.observatii,
              to_char(ab.intrat_productie_la, 'YYYY-MM-DD HH24:MI') AS intrat_productie_la,
              to_char(ab.iesit_productie_la, 'YYYY-MM-DD HH24:MI') AS iesit_productie_la,
              to_char(ab.ctc_la, 'YYYY-MM-DD HH24:MI') AS ctc_la,
              to_char(ab.predat_depozit_la, 'YYYY-MM-DD HH24:MI') AS predat_depozit_la,
              to_char(${ETA}, 'YYYY-MM-DD') AS eta, (cl.data_ceruta - ${ETA})::int AS marja_zile,
              ((SELECT sum(cantitate) FROM alimentare_cantitate WHERE alimentare_id = ab.id) * ab.timp_min_buc / 60.0)
                ::numeric(10,1)::text AS ore_om
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
