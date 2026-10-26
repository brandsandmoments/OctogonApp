import { interogare } from './sesiune';
import { vecina, type Perioada } from './perioade';

/**
 * Eficiența Asigură stoc: livrează producția ce a cerut KAM-ul, la data cerută?
 *
 * Măsura e pe linia de comandă (un produs, toate mărimile), față de data cerută
 * de KAM pe linie. Linia e livrată în ziua în care s-a stins ultima ei poziție —
 * a intrat tot în depozit sau s-a închis. Intrările sunt recepțiile din depozit;
 * pentru liniile care n-au nicio recepție încă (istoricul din dashboard), predările
 * de pe bandă la depozit țin locul lor.
 *
 * Pe perioadă (liniile cu data cerută în ea):
 *   la timp     = livrate până la data cerută, inclusiv
 *   mai devreme = câte zile înainte, în medie
 *   întârziate  = livrate după data cerută, și cu câte zile
 *   restante    = încă nelivrate, cu data cerută trecută
 *   bucăți la termen = câte bucăți au intrat până la data cerută, din cât s-a cerut
 *   lipsă la închidere = bucăți care nu mai vin, pe motive (rebut, defect de țesătură…)
 */

export type LinieLivrare = {
  linie_id: string;
  comanda: string;
  tip: string;
  produs: string;
  data_ceruta: string;
  cerut: number;
  intrat: number;
  la_termen: number;          // bucăți intrate până la data cerută
  livrata_la: string | null;  // ziua în care s-a stins ultima poziție
  zile: number | null;        // livrata_la − data_ceruta; negativ = mai devreme
  restanta_zile: number | null; // nelivrată, cu data cerută trecută: de câte zile
  lipsa_inchisa: number;      // bucăți care nu mai vin
  motive: string | null;
  din_banda: boolean;         // fără recepții: predările de pe bandă
};

const LINII = `
  WITH receptii AS (
      SELECT e.linie_id, e.marime_id, (r.scanat_la AT TIME ZONE 'Europe/Bucharest')::date AS la,
             r.cantitate AS q, r.inchide_pozitia AS inchide, mo.nume AS motiv
        FROM receptie r JOIN eticheta e ON e.id = r.eticheta_id LEFT JOIN motiv mo ON mo.id = r.motiv_id),
  banda AS (
      SELECT pl.linie_id, ac.marime_id, (ab.predat_depozit_la AT TIME ZONE 'Europe/Bucharest')::date AS la,
             ac.cantitate AS q, false AS inchide, NULL::text AS motiv
        FROM alimentare_banda ab
        JOIN alimentare_cantitate ac ON ac.alimentare_id = ab.id
        JOIN lot_croit lc   ON lc.id = ab.lot_id
        JOIN planificare pl ON pl.id = lc.planificare_id
       WHERE ab.predat_depozit_la IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM receptii x WHERE x.linie_id = pl.linie_id)),
  ev AS (SELECT *, false AS din_banda FROM receptii UNION ALL SELECT *, true FROM banda),
  cumulat AS (
      SELECT ev.*, sum(q) OVER (PARTITION BY linie_id, marime_id ORDER BY la, inchide ROWS UNBOUNDED PRECEDING) AS cum
        FROM ev),
  pozitie AS (
      SELECT cc.linie_id, cc.marime_id, cc.cantitate AS cerut,
             coalesce(sum(cu.q), 0)::int AS intrat,
             coalesce(sum(cu.q) FILTER (WHERE cu.la <= cl.data_ceruta), 0)::int AS la_termen,
             least(min(cu.la) FILTER (WHERE cu.cum >= cc.cantitate), min(cu.la) FILTER (WHERE cu.inchide)) AS stinsa_la,
             bool_or(cu.inchide) AS inchisa,
             string_agg(DISTINCT cu.motiv, ', ') AS motive,
             bool_or(cu.din_banda) AS din_banda
        FROM comanda_cantitate cc
        JOIN comanda_linie cl ON cl.id = cc.linie_id
        LEFT JOIN cumulat cu  ON cu.linie_id = cc.linie_id AND cu.marime_id = cc.marime_id
       GROUP BY cc.linie_id, cc.marime_id, cc.cantitate)
  SELECT cl.id AS linie_id, c.numar AS comanda, c.tip::text AS tip, p.denumire AS produs,
         to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
         sum(po.cerut)::int AS cerut, sum(po.intrat)::int AS intrat,
         sum(least(po.la_termen, po.cerut))::int AS la_termen,
         to_char(CASE WHEN bool_and(po.stinsa_la IS NOT NULL) THEN max(po.stinsa_la) END, 'YYYY-MM-DD') AS livrata_la,
         CASE WHEN bool_and(po.stinsa_la IS NOT NULL) THEN max(po.stinsa_la) - cl.data_ceruta END AS zile,
         CASE WHEN NOT bool_and(po.stinsa_la IS NOT NULL) AND cl.data_ceruta < current_date
              THEN current_date - cl.data_ceruta END AS restanta_zile,
         sum(CASE WHEN po.inchisa THEN greatest(po.cerut - po.intrat, 0) ELSE 0 END)::int AS lipsa_inchisa,
         string_agg(DISTINCT po.motive, ', ') AS motive,
         coalesce(bool_or(po.din_banda), false) AS din_banda
    FROM comanda_linie cl
    JOIN comanda c  ON c.id = cl.comanda_id
    JOIN produs p   ON p.id = cl.produs_id
    JOIN pozitie po ON po.linie_id = cl.id
   WHERE c.stare NOT IN ('ciorna', 'anulata')
     AND cl.data_ceruta BETWEEN $1::date AND $2::date
   GROUP BY cl.id, c.numar, c.tip, p.denumire, cl.data_ceruta
   ORDER BY cl.data_ceruta, c.numar, p.denumire`;

export type Rezumat = {
  linii: number;
  livrate: number;
  la_timp: number;
  devreme: number;
  devreme_zile: number | null;   // media zilelor înainte, la cele livrate mai devreme
  intarziate: number;
  intarziere_zile: number | null; // media zilelor de întârziere
  restante: number;
  cerut: number;
  la_termen: number;
  lipsa_inchisa: number;
};

export function rezuma(linii: LinieLivrare[]): Rezumat {
  const livrate = linii.filter((l) => l.zile !== null);
  const devreme = livrate.filter((l) => l.zile! < 0);
  const tarziu = livrate.filter((l) => l.zile! > 0);
  const medie = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
  return {
    linii: linii.length,
    livrate: livrate.length,
    la_timp: livrate.filter((l) => l.zile! <= 0).length,
    devreme: devreme.length,
    devreme_zile: medie(devreme.map((l) => -l.zile!)),
    intarziate: tarziu.length,
    intarziere_zile: medie(tarziu.map((l) => l.zile!)),
    restante: linii.filter((l) => l.restanta_zile !== null).length,
    cerut: linii.reduce((s, l) => s + l.cerut, 0),
    la_termen: linii.reduce((s, l) => s + l.la_termen, 0),
    lipsa_inchisa: linii.reduce((s, l) => s + l.lipsa_inchisa, 0),
  };
}

export const liniiInPerioada = (p: Perioada) => interogare<LinieLivrare>(LINII, [p.de_la, p.pana_la]);

/** Perioada aleasă, cu liniile ei, și ultimele 8 perioade de același fel, ca să se vadă direcția. */
export async function eficientaAsiguraStoc(p: Perioada) {
  const linii = await liniiInPerioada(p);
  const perioade = [p];
  while (perioade.length < 8) perioade.unshift(vecina(perioade[0], -1));
  const istoric = [];
  for (const x of perioade) istoric.push({ perioada: x, ...rezuma(x === p ? linii : await liniiInPerioada(x)) });
  return { linii, rezumat: rezuma(linii), istoric };
}
