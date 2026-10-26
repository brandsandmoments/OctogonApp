import { caFirma, firmaCurenta, interogare } from './db';
import { incheiePlanificare } from './planificare';

export type Vedere = 'toate' | 'croite';

export type LotRezumat = {
  id: string;
  cod: string;
  comanda: string;
  prioritate: number;
  data_ceruta: string;
  produs: string;
  stofa: string | null;
  cerut: number;
  croit: number | null;
  primit_la: string;
  croit_la: string | null;
  etape: number;
  etape_total: number;
};

/**
 * Loturile din croit. „Croite" sunt cele înregistrate, cele mai noi sus.
 * „Toate" le pune împreună: întâi cele necroite, în ordinea în care trebuie
 * luate (urgența, apoi termenul), apoi cele croite.
 */
export async function loturi(vedere: Vedere): Promise<LotRezumat[]> {
  return interogare<LotRezumat>(
    `SELECT lc.id, c.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot AS cod,
            c.numar AS comanda, c.prioritate, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
            p.denumire AS produs,
            (SELECT m.denumire FROM produs_material pm
               JOIN model_componenta mc ON mc.id = pm.componenta_id AND mc.principal
               JOIN material m ON m.id = pm.material_id
              WHERE pm.produs_id = p.id LIMIT 1) AS stofa,
            (SELECT coalesce(sum(cantitate), 0) FROM lot_croit_cantitate WHERE lot_id = lc.id)::int AS cerut,
            (SELECT sum(cantitate) FROM lot_croit_efectiv WHERE lot_id = lc.id)::int AS croit,
            to_char(lc.data_primire, 'YYYY-MM-DD') AS primit_la,
            to_char(lc.croit_la, 'YYYY-MM-DD HH24:MI') AS croit_la,
            (SELECT count(*) FROM lot_etapa le WHERE le.lot_id = lc.id)::int AS etape,
            (SELECT count(*) FROM etapa_croit)::int AS etape_total
       FROM lot_croit lc
       JOIN planificare pl   ON pl.id = lc.planificare_id
       JOIN comanda_linie cl ON cl.id = pl.linie_id
       JOIN comanda c        ON c.id = cl.comanda_id
       JOIN produs p         ON p.id = cl.produs_id
      WHERE pl.stadiu <> 'anulat'
        AND ($1 = 'toate' OR lc.croit_la IS NOT NULL)
      ORDER BY lc.croit_la IS NOT NULL,
               CASE WHEN lc.croit_la IS NULL THEN c.prioritate END,
               CASE WHEN lc.croit_la IS NULL THEN cl.data_ceruta END,
               lc.croit_la DESC, c.numar`,
    [vedere],
  );
}

export type RamasDeCroit = {
  planificare_id: string;
  cod: string;
  comanda: string;
  prioritate: number;
  data_ceruta: string;
  produs: string;
  stadiu: string;
  lot_deschis: string | null; // lotul lansat și necroit, dacă există
  marimi: { marime: string; rest: number }[];
  rest: number;
};

/**
 * Rămas de croit: tot ce încă așteaptă foarfeca, pe mărimi. Din fiecare
 * planificare lansată, planificat minus croit — adică loturile lansate și
 * necroite, plus diferențele loturilor croite incomplet, până se încheie
 * planificarea. Loturile necroite vin primele: pe ele se lucrează acum.
 */
export async function ramasDeCroit(): Promise<RamasDeCroit[]> {
  const randuri = await interogare<Omit<RamasDeCroit, 'marimi' | 'rest'> & { marime: string; rest: number }>(
    `SELECT r.planificare_id, c.numar || '/P' || pl.numar_transa AS cod, c.numar AS comanda, c.prioritate,
            to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta, p.denumire AS produs, pl.stadiu::text AS stadiu,
            (SELECT lc.id FROM lot_croit lc WHERE lc.planificare_id = pl.id AND lc.croit_la IS NULL LIMIT 1) AS lot_deschis,
            m.cod AS marime, r.rest
       FROM planificare_rest_de_croit r
       JOIN planificare pl   ON pl.id = r.planificare_id
       JOIN comanda_linie cl ON cl.id = pl.linie_id
       JOIN comanda c        ON c.id = cl.comanda_id
       JOIN produs p         ON p.id = cl.produs_id
       JOIN marime m         ON m.id = r.marime_id
      WHERE r.rest > 0 AND pl.stadiu IN ('lansat_spre_croit', 'in_croit')
      ORDER BY NOT EXISTS (SELECT 1 FROM lot_croit lc WHERE lc.planificare_id = pl.id AND lc.croit_la IS NULL),
               c.prioritate, cl.data_ceruta, c.numar, pl.numar_transa, m.ordine`,
  );
  const pe = new Map<string, RamasDeCroit>();
  for (const { marime, rest, ...r } of randuri) {
    const x = pe.get(r.planificare_id) ?? { ...r, marimi: [], rest: 0 };
    x.marimi.push({ marime, rest });
    x.rest += rest;
    pe.set(r.planificare_id, x);
  }
  return [...pe.values()];
}

// ---------------------------------------------------------------- un lot

export type DetaliiLot = {
  lot: { id: string; cod: string; planificare_id: string; comanda: string; prioritate: number;
         data_ceruta: string; produs: string; cod_sku: string; primit_la: string; croit_la: string | null;
         observatii: string | null };
  marimi: { marime_id: string; marime: string; cerut: number; croit: number | null; motiv: string | null }[];
  etape: { id: string; nume: string; ordine: number; bifat_la: string | null }[];
  consum: { material_id: string; denumire: string; unitate: string; principal: boolean;
            tip: 'materie_prima' | 'accesoriu'; teoretic: string; consumat: string | null }[];
};

export async function detaliiLot(id: string): Promise<DetaliiLot | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [lot] } = await c.query<DetaliiLot['lot']>(
      `SELECT lc.id, c.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot AS cod, pl.id AS planificare_id,
              c.numar AS comanda, c.prioritate, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
              p.denumire AS produs, p.cod_sku, to_char(lc.data_primire, 'YYYY-MM-DD') AS primit_la,
              to_char(lc.croit_la, 'YYYY-MM-DD HH24:MI') AS croit_la, lc.observatii
         FROM lot_croit lc
         JOIN planificare pl   ON pl.id = lc.planificare_id
         JOIN comanda_linie cl ON cl.id = pl.linie_id
         JOIN comanda c        ON c.id = cl.comanda_id
         JOIN produs p         ON p.id = cl.produs_id
        WHERE lc.id = $1`, [id]);
    if (!lot) return null;
    const { rows: marimi } = await c.query<DetaliiLot['marimi'][number]>(
      `SELECT lq.marime_id, m.cod AS marime, lq.cantitate AS cerut, le.cantitate AS croit, mo.nume AS motiv
         FROM lot_croit_cantitate lq
         JOIN marime m ON m.id = lq.marime_id
         LEFT JOIN lot_croit_efectiv le ON le.lot_id = lq.lot_id AND le.marime_id = lq.marime_id
         LEFT JOIN motiv mo ON mo.id = le.motiv_id
        WHERE lq.lot_id = $1 ORDER BY m.ordine`, [id]);
    const { rows: etape } = await c.query<DetaliiLot['etape'][number]>(
      `SELECT e.id, e.nume, e.ordine, to_char(le.bifat_la, 'YYYY-MM-DD HH24:MI') AS bifat_la
         FROM etapa_croit e LEFT JOIN lot_etapa le ON le.etapa_id = e.id AND le.lot_id = $1
        ORDER BY e.ordine`, [id]);
    // Consumul teoretic: bucăți (croite, dacă lotul s-a croit; altfel cerute) × consumul din rețetă.
    const { rows: consum } = await c.query<DetaliiLot['consum'][number]>(
      `WITH bucati AS (
           SELECT lq.marime_id, coalesce(le.cantitate, lq.cantitate) AS q
             FROM lot_croit_cantitate lq
             LEFT JOIN lot_croit_efectiv le ON le.lot_id = lq.lot_id AND le.marime_id = lq.marime_id
            WHERE lq.lot_id = $1)
       SELECT m.id AS material_id, m.denumire, m.unitate::text AS unitate, bool_or(mc.principal) AS principal,
              m.tip::text AS tip,
              ((SELECT sum(q) FROM bucati) * sum(mc.consum))::numeric(12,3)::text AS teoretic,
              (SELECT (-sum(ms.cantitate))::numeric(12,3)::text FROM miscare_stoc ms
                WHERE ms.lot_id = $1 AND ms.material_id = m.id) AS consumat
         FROM lot_croit lc
         JOIN planificare pl       ON pl.id = lc.planificare_id
         JOIN comanda_linie cl     ON cl.id = pl.linie_id
         JOIN produs_material pm   ON pm.produs_id = cl.produs_id
         JOIN model_componenta mc  ON mc.id = pm.componenta_id
         JOIN material m           ON m.id = pm.material_id
        WHERE lc.id = $1
        GROUP BY m.id, m.denumire, m.unitate, m.tip
        ORDER BY m.tip, bool_or(mc.principal) DESC, m.denumire`, [id]);
    return { lot, marimi, etape, consum };
  });
}

/** Bifează sau debifează o etapă. După ce lotul s-a croit, etapele de dinainte rămân cum sunt. */
export async function bifeazaEtapa(lotId: string, etapaId: string, bifat: boolean): Promise<void> {
  if (bifat) {
    await interogare(
      `INSERT INTO lot_etapa (firma_id, lot_id, etapa_id) VALUES (firma_curenta(), $1, $2)
       ON CONFLICT (lot_id, etapa_id) DO NOTHING`, [lotId, etapaId]);
  } else {
    await interogare(`DELETE FROM lot_etapa WHERE lot_id = $1 AND etapa_id = $2`, [lotId, etapaId]);
  }
}

export type CroitNou = {
  lotId: string;
  croit: Map<string, number>;          // marime_id → bucăți croite
  motivId: string | null;              // când croitul diferă de cerut
  consumPrincipal: number | null;      // metri măsurați pentru stofa principală; gol = teoretic
  incheie: boolean;                    // restul nu se mai croiește
  motivIncheiereId: string | null;
};

/**
 * Înregistrează croitul unui lot, într-o singură tranzacție:
 *
 * 1. bucățile croite pe mărimi; dacă diferă de cerut, motivul din listă e obligatoriu;
 * 2. consumul de materie primă scade din stoc: teoretic (bucăți croite × rețetă),
 *    iar pentru stofa principală, metrii măsurați dacă s-au scris — acolo
 *    diferența contează și se vede la inventar. Accesoriile (etichete, pungi,
 *    stickere) NU scad aici: ele pleacă din depozit la alimentarea benzii;
 * 3. etapa „Croit" se bifează, iar lotul primește ora croirii;
 * 4. planificarea trece în croit, sau se încheie — singură, dacă nu mai e nimic de
 *    croit, ori la cerere, cu motiv, dacă restul nu mai vine.
 *
 * Consumul nu se oprește când stocul ar ieși negativ: stofa a fost tăiată, deci a
 * existat. Un stoc negativ arată o intrare neînregistrată și se vede pe /stoc.
 */
export async function inregistreazaCroit(d: CroitNou): Promise<string | null> {
  try {
    return await inregistreaza(d);
  } catch (e) {
    if (e instanceof Refuz) return e.message;
    throw e;
  }
}

/**
 * Un refuz apărut după ce s-a scris ceva. Aruncat, nu întors: caFirma confirmă
 * tranzacția la return și o anulează la excepție, iar un croit pe jumătate
 * înregistrat (bucăți fără consum, consum fără bucăți) e mai rău decât niciunul.
 */
class Refuz extends Error {}

async function inregistreaza(d: CroitNou): Promise<string | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [lot] } = await c.query<{ croit_la: string | null; planificare_id: string }>(
      `SELECT croit_la, planificare_id FROM lot_croit WHERE id = $1 FOR UPDATE`, [d.lotId]);
    if (!lot) return 'Lotul nu există.';
    if (lot.croit_la) return 'Lotul a fost deja croit.';

    const { rows: cerute } = await c.query<{ marime_id: string; marime: string; cerut: number }>(
      `SELECT lq.marime_id, m.cod AS marime, lq.cantitate AS cerut
         FROM lot_croit_cantitate lq JOIN marime m ON m.id = lq.marime_id WHERE lq.lot_id = $1`, [d.lotId]);
    let diferit = false;
    for (const r of cerute) {
      const q = d.croit.get(r.marime_id);
      if (q === undefined || !Number.isInteger(q) || q < 0) return `Scrie câte s-au croit la ${r.marime}.`;
      if (q !== r.cerut) diferit = true;
    }
    if (diferit && !d.motivId) return 'Croitul diferă de cerut: alege motivul.';

    for (const r of cerute) {
      const q = d.croit.get(r.marime_id)!;
      await c.query(
        `INSERT INTO lot_croit_efectiv (firma_id, lot_id, marime_id, cantitate, motiv_id)
         VALUES (firma_curenta(), $1, $2, $3, $4)`,
        [d.lotId, r.marime_id, q, q !== r.cerut ? d.motivId : null]);
    }

    // Consumul, din bucățile tocmai scrise.
    const { rows: consum } = await c.query<{ material_id: string; principal: boolean; teoretic: string }>(
      `SELECT pm.material_id, bool_or(mc.principal) AS principal,
              (sum(mc.consum) * (SELECT sum(cantitate) FROM lot_croit_efectiv WHERE lot_id = $1))::numeric(12,3)::text AS teoretic
         FROM lot_croit lc
         JOIN planificare pl      ON pl.id = lc.planificare_id
         JOIN comanda_linie cl    ON cl.id = pl.linie_id
         JOIN produs_material pm  ON pm.produs_id = cl.produs_id
         JOIN model_componenta mc ON mc.id = pm.componenta_id
        WHERE lc.id = $1 AND pm.tip = 'materie_prima'
        GROUP BY pm.material_id`, [d.lotId]);
    for (const m of consum) {
      const q = m.principal && d.consumPrincipal != null ? d.consumPrincipal : Number(m.teoretic);
      if (!(q > 0)) continue;
      await c.query(
        `INSERT INTO miscare_stoc (firma_id, material_id, tip, cantitate, lot_id, observatii)
         VALUES (firma_curenta(), $1, 'consum_croit', $2, $3, $4)`,
        [m.material_id, -q, d.lotId,
         m.principal && d.consumPrincipal != null ? `măsurat; teoretic ${Number(m.teoretic)}` : null]);
    }

    await c.query(
      `INSERT INTO lot_etapa (firma_id, lot_id, etapa_id)
       SELECT firma_curenta(), $1, id FROM etapa_croit WHERE cod = 'croit'
       ON CONFLICT (lot_id, etapa_id) DO NOTHING`, [d.lotId]);
    await c.query(`UPDATE lot_croit SET croit_la = now() WHERE id = $1`, [d.lotId]);

    const { rows: [{ rest }] } = await c.query<{ rest: number }>(
      `SELECT coalesce(sum(rest), 0)::int AS rest FROM planificare_rest_de_croit WHERE planificare_id = $1`,
      [lot.planificare_id]);
    if (rest === 0 || d.incheie) {
      const e = await incheiePlanificare(c, lot.planificare_id, d.incheie ? d.motivIncheiereId ?? d.motivId : null);
      if (e) throw new Refuz(e);
    } else {
      await c.query(`UPDATE planificare SET stadiu = 'in_croit' WHERE id = $1`, [lot.planificare_id]);
    }
    return null;
  });
}
