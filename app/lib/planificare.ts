import type { PoolClient } from 'pg';
import { caFirma } from './db';
import { firmaCurenta, interogare } from './sesiune';

/** Câte o cantitate pe mărime, în ordinea grilei: [{ marime, cantitate }]. */
export type PeMarimi = { marime_id: string; marime: string; cantitate: number }[];

export type LinieDePlanificat = {
  linie_id: string;
  comanda: string;
  tip: string;
  prioritate: number;
  data_ceruta: string;
  produs: string;
  cod_sku: string;
  model_cheie: string;   // modelul, sau produsul când n-are model: ce se poate tăia împreună
  model: string;
  are_reteta: boolean;
  cerut: number;
  planificat: number;
  rest: number;
};

/**
 * Pozițiile care mai au ceva de planificat: cerut minus ce acoperă deja
 * planificările (planificat_pe_pozitie: activele cu planul, încheiatele cu croitul). Ordinea e cea în care trebuie luate: urgența întâi,
 * apoi termenul. O comandă ciornă, închisă sau anulată nu se planifică.
 */
export async function deplanificat(cauta?: string): Promise<LinieDePlanificat[]> {
  return interogare<LinieDePlanificat>(
    `WITH planificat AS (
         SELECT linie_id, marime_id, cantitate AS q FROM planificat_pe_pozitie)
     SELECT cl.id AS linie_id, c.numar AS comanda, c.tip::text AS tip, c.prioritate,
            to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
            p.denumire AS produs, p.cod_sku,
            coalesce(p.model_id, p.id)::text AS model_cheie, coalesce(mo.denumire, p.denumire) AS model,
            EXISTS (SELECT 1 FROM model_componenta mc WHERE mc.model_id = p.model_id) AS are_reteta,
            sum(cc.cantitate)::int AS cerut,
            sum(least(coalesce(pl.q, 0), cc.cantitate))::int AS planificat,
            sum(greatest(cc.cantitate - coalesce(pl.q, 0), 0))::int AS rest
       FROM comanda_linie cl
       JOIN comanda c            ON c.id = cl.comanda_id
       JOIN produs p             ON p.id = cl.produs_id
       LEFT JOIN model mo        ON mo.id = p.model_id
       JOIN comanda_cantitate cc ON cc.linie_id = cl.id
       LEFT JOIN planificat pl   ON pl.linie_id = cl.id AND pl.marime_id = cc.marime_id
      WHERE c.stare IN ('lansata', 'in_productie')
        AND ($1::text IS NULL OR c.numar ILIKE '%' || $1 || '%' OR p.denumire ILIKE '%' || $1 || '%')
      GROUP BY cl.id, c.numar, c.tip, c.prioritate, cl.data_ceruta, p.id, p.denumire, p.cod_sku, p.model_id, mo.denumire
     HAVING sum(greatest(cc.cantitate - coalesce(pl.q, 0), 0)) > 0
      ORDER BY coalesce(mo.denumire, p.denumire), c.prioritate, cl.data_ceruta, c.numar, p.denumire`,
    [cauta?.trim() || null],
  );
}

// ---------------------------------------------------------------- acoperirea cu materiale

/**
 * Pentru fiecare planificare activă și fiecare material: cât îi trebuie și dacă
 * stocul o acoperă. Stocul se alocă în ordinea priorității comenzii, apoi a datei
 * planificării: o planificare e acoperită dacă tot ce cer ea și cele dinaintea ei
 * încape în stoc. Când stofa nu ajunge pentru toți, urgentele trec primele.
 *
 * Doar stofa principală oprește lansarea; restul materialelor dau avertisment.
 * Așa face și dashboard-ul (Status materie primă separat de Status accesorii), și
 * așa trebuie cât timp stocul de ață și etichete nu e încă ținut în aplicație:
 * altfel nicio planificare n-ar putea pleca la croit.
 */
const ACOPERIRE = `
  SELECT r.planificare_id, r.material_id, r.rezervat,
         s.stoc,
         EXISTS (SELECT 1 FROM produs_material pm
                   JOIN model_componenta mc ON mc.id = pm.componenta_id AND mc.principal
                  WHERE pm.produs_id = cl.produs_id AND pm.material_id = r.material_id) AS principal,
         sum(r.rezervat) OVER (PARTITION BY r.material_id
                               ORDER BY c.prioritate, pl.data_planificare, pl.id) AS cumulat
    FROM rezervare_material r
    JOIN planificare pl   ON pl.id = r.planificare_id
    JOIN comanda_linie cl ON cl.id = pl.linie_id
    JOIN comanda c        ON c.id = cl.comanda_id
    JOIN stoc_material s  ON s.material_id = r.material_id`;

export type AcoperireMaterial = {
  material_id: string;
  cod: string;
  denumire: string;
  unitate: string;
  principal: boolean;
  necesar: string;
  stoc: string;
  inaintea_ei: string; // ce au rezervat planificările cu prioritate mai mare
  acoperit: boolean;
};

export async function acoperire(c: PoolClient, planificareId: string): Promise<AcoperireMaterial[]> {
  const { rows } = await c.query<AcoperireMaterial>(
    `WITH a AS (${ACOPERIRE})
     SELECT m.id AS material_id, m.cod, m.denumire, m.unitate::text AS unitate, a.principal,
            a.rezervat::text AS necesar, a.stoc::text AS stoc,
            (a.cumulat - a.rezervat)::numeric(12,3)::text AS inaintea_ei,
            a.cumulat <= a.stoc AS acoperit
       FROM a JOIN material m ON m.id = a.material_id
      WHERE a.planificare_id = $1
      ORDER BY a.principal DESC, a.cumulat <= a.stoc, m.denumire`,
    [planificareId],
  );
  return rows;
}

// ---------------------------------------------------------------- planificări

export type PlanificareRezumat = {
  id: string;
  cod: string;
  comanda: string;
  prioritate: number;
  data_ceruta: string;
  produs: string;
  stadiu: string;
  planificat: number;
  croit: number;
  loturi_deschise: number;
  stofa_lipsa: boolean;
  alte_lipsa: number;
  ordine_croit: number | null;
};

/** Planificările care încă lucrează: neanulate și neîncheiate. */
export async function planificariActive(): Promise<PlanificareRezumat[]> {
  return interogare<PlanificareRezumat>(
    `WITH a AS (${ACOPERIRE})
     SELECT pl.id, c.numar || '/P' || pl.numar_transa AS cod, c.numar AS comanda, c.prioritate,
            to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta, p.denumire AS produs,
            pl.stadiu::text AS stadiu,
            (SELECT coalesce(sum(cantitate), 0) FROM planificare_cantitate WHERE planificare_id = pl.id)::int AS planificat,
            (SELECT coalesce(sum(le.cantitate), 0) FROM lot_croit lc JOIN lot_croit_efectiv le ON le.lot_id = lc.id
              WHERE lc.planificare_id = pl.id)::int AS croit,
            (SELECT count(*) FROM lot_croit lc WHERE lc.planificare_id = pl.id AND lc.croit_la IS NULL)::int AS loturi_deschise,
            EXISTS (SELECT 1 FROM a WHERE a.planificare_id = pl.id AND a.principal AND a.cumulat > a.stoc) AS stofa_lipsa,
            (SELECT count(*) FROM a WHERE a.planificare_id = pl.id AND NOT a.principal AND a.cumulat > a.stoc)::int AS alte_lipsa,
            pl.ordine_croit
       FROM planificare pl
       JOIN comanda_linie cl ON cl.id = pl.linie_id
       JOIN comanda c        ON c.id = cl.comanda_id
       JOIN produs p         ON p.id = cl.produs_id
      WHERE pl.stadiu NOT IN ('anulat', 'incheiat')
      ORDER BY pl.ordine_croit NULLS LAST, c.prioritate, cl.data_ceruta, c.numar, pl.numar_transa`,
  );
}

export type LiniePlanificare = {
  linie: { id: string; comanda: string; tip: string; prioritate: number; data_ceruta: string;
           produs: string; cod_sku: string; are_reteta: boolean; model_cheie: string };
  marimi: { marime_id: string; marime: string; cerut: number; planificat: number; rest: number }[];
};

export async function liniePentruPlanificare(linieId: string): Promise<LiniePlanificare | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [linie] } = await c.query<LiniePlanificare['linie']>(
      `SELECT cl.id, c.numar AS comanda, c.tip::text AS tip, c.prioritate,
              to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta, p.denumire AS produs, p.cod_sku,
              EXISTS (SELECT 1 FROM model_componenta mc WHERE mc.model_id = p.model_id) AS are_reteta,
              coalesce(p.model_id, p.id)::text AS model_cheie
         FROM comanda_linie cl JOIN comanda c ON c.id = cl.comanda_id JOIN produs p ON p.id = cl.produs_id
        WHERE cl.id = $1`, [linieId]);
    if (!linie) return null;
    const { rows: marimi } = await c.query<LiniePlanificare['marimi'][number]>(
      `SELECT cc.marime_id, m.cod AS marime, cc.cantitate AS cerut,
              coalesce((SELECT pp.cantitate FROM planificat_pe_pozitie pp
                         WHERE pp.linie_id = cc.linie_id AND pp.marime_id = cc.marime_id), 0)::int AS planificat,
              0 AS rest
         FROM comanda_cantitate cc JOIN marime m ON m.id = cc.marime_id
        WHERE cc.linie_id = $1 ORDER BY m.ordine`, [linieId]);
    return { linie, marimi: marimi.map((m) => ({ ...m, rest: Math.max(0, m.cerut - m.planificat) })) };
  });
}

/**
 * O planificare nouă pe o linie. Nu se poate planifica mai mult decât a rămas
 * neplanificat: un plan peste comandă înseamnă bucăți croite pe care nu le-a
 * cerut nimeni. Stadiul iese din acoperirea cu materiale, calculată după ce
 * planificarea există (abia atunci are rezervarea ei).
 */
export async function creeazaPlanificare(
  linieId: string, cantitati: Map<string, number>, observatii: string,
): Promise<{ id: string } | { eroare: string }> {
  const date = await liniePentruPlanificare(linieId);
  if (!date) return { eroare: 'Linia nu există.' };
  if (!date.linie.are_reteta) return { eroare: 'Produsul nu are rețetă: nu se poate verifica materialul. Completează întâi rețeta modelului.' };
  const alese = date.marimi
    .map((m) => ({ ...m, q: cantitati.get(m.marime_id) ?? 0 }))
    .filter((m) => m.q !== 0);
  if (alese.length === 0) return { eroare: 'Planificarea nu are nicio cantitate.' };
  for (const m of alese) {
    if (!Number.isInteger(m.q) || m.q < 0) return { eroare: `Cantitate nevalidă la ${m.marime}.` };
    if (m.q > m.rest) return { eroare: `La ${m.marime} au rămas de planificat doar ${m.rest}.` };
  }

  return caFirma(firmaCurenta(), async (c) => {
    const id = await insereazaPlanificare(c, linieId, alese.map((m) => ({ marime_id: m.marime_id, q: m.q })), observatii);
    await actualizeazaStadiuMateriale(c, id);
    return { id };
  });
}

/**
 * Planifică tot ce a rămas pe liniile alese, câte o planificare pe linie. Pentru
 * alte cantități, planificarea unei singure linii.
 */
export async function planificaTot(linii: string[]): Promise<string | null> {
  if (linii.length === 0) return 'Bifează cel puțin o comandă.';
  return caFirma(firmaCurenta(), async (c) => {
    for (const linieId of linii) {
      const { rows } = await c.query<{ marime_id: string; q: number; are_reteta: boolean; cod: string }>(
        `SELECT cc.marime_id, greatest(cc.cantitate - coalesce(pp.cantitate, 0), 0)::int AS q,
                EXISTS (SELECT 1 FROM model_componenta mc WHERE mc.model_id = p.model_id) AS are_reteta,
                c.numar || ' · ' || p.denumire AS cod
           FROM comanda_cantitate cc
           JOIN comanda_linie cl ON cl.id = cc.linie_id
           JOIN comanda c        ON c.id = cl.comanda_id
           JOIN produs p         ON p.id = cl.produs_id
           LEFT JOIN planificat_pe_pozitie pp ON pp.linie_id = cc.linie_id AND pp.marime_id = cc.marime_id
          WHERE cc.linie_id = $1`, [linieId]);
      if (rows.length && !rows[0].are_reteta) throw new Refuzat(`${rows[0].cod}: produsul nu are rețetă.`);
      const alese = rows.filter((m) => m.q > 0);
      if (alese.length === 0) continue;
      const id = await insereazaPlanificare(c, linieId, alese, '');
      await actualizeazaStadiuMateriale(c, id);
    }
    return null;
  }).catch((e) => {
    if (e instanceof Refuzat) return e.message;
    throw e;
  });
}

/** Aruncat ca tranzacția să se anuleze: toate liniile alese sau niciuna. */
class Refuzat extends Error {}

/** Scrie planificarea și cantitățile ei; cine cheamă a verificat deja cantitățile. */
export async function insereazaPlanificare(
  c: PoolClient, linieId: string, alese: { marime_id: string; q: number }[], observatii: string,
): Promise<string> {
  {
    // Numerotarea e pe comandă, nu pe linie, ca în dashboard: psf-ms-sep-1/P1 e
    // Mada Ivoire, /P2 Mada Maro. Pe linie, două culori ar purta același cod pe
    // fișa tipărită. Comanda se blochează cât se numerotează, ca două planificări
    // simultane să nu primească același număr.
    await c.query(
      `SELECT 1 FROM comanda WHERE id = (SELECT comanda_id FROM comanda_linie WHERE id = $1) FOR UPDATE`,
      [linieId]);
    const { rows: [{ id }] } = await c.query<{ id: string }>(
      `INSERT INTO planificare (firma_id, linie_id, numar_transa, stadiu, observatii)
       VALUES (firma_curenta(), $1,
               (SELECT coalesce(max(pl.numar_transa), 0) + 1
                  FROM planificare pl JOIN comanda_linie cl ON cl.id = pl.linie_id
                 WHERE cl.comanda_id = (SELECT comanda_id FROM comanda_linie WHERE id = $1)),
               'gata_de_lansat', nullif($2, ''))
       RETURNING id`, [linieId, observatii.trim()]);
    for (const m of alese) {
      await c.query(
        `INSERT INTO planificare_cantitate (firma_id, planificare_id, marime_id, cantitate)
         VALUES (firma_curenta(), $1, $2, $3)`, [id, m.marime_id, m.q]);
    }
    return id;
  }
}

/** gata_de_lansat ↔ blocat_materiale, după acoperirea stofei principale. Stadiile de după lansare nu se ating. */
export async function actualizeazaStadiuMateriale(c: PoolClient, id: string) {
  const lipsa = (await acoperire(c, id)).some((a) => a.principal && !a.acoperit);
  await c.query(
    `UPDATE planificare SET stadiu = $2
      WHERE id = $1 AND stadiu IN ('gata_de_lansat', 'blocat_materiale', 'fara_cantitate')`,
    [id, lipsa ? 'blocat_materiale' : 'gata_de_lansat']);
}

export type DetaliiPlanificare = {
  plan: { id: string; cod: string; comanda: string; tip: string; prioritate: number; data_ceruta: string;
          produs: string; cod_sku: string; stadiu: string; data_planificare: string; observatii: string | null;
          motiv_incheiere: string | null };
  marimi: { marime: string; planificat: number; croit: number; rest: number }[];
  loturi: { id: string; cod: string; cerut: number; croit: number | null; croit_la: string | null;
            taiere_id: string | null; taiere: string | null }[];
  materiale: AcoperireMaterial[];
};

export async function detaliiPlanificare(id: string): Promise<DetaliiPlanificare | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [plan] } = await c.query<DetaliiPlanificare['plan']>(
      `SELECT pl.id, c.numar || '/P' || pl.numar_transa AS cod, c.numar AS comanda, c.tip::text AS tip,
              c.prioritate, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
              p.denumire AS produs, p.cod_sku, pl.stadiu::text AS stadiu,
              to_char(pl.data_planificare, 'YYYY-MM-DD') AS data_planificare, pl.observatii,
              mo.nume || coalesce(': ' || pl.observatii_incheiere, '') AS motiv_incheiere
         FROM planificare pl
         JOIN comanda_linie cl ON cl.id = pl.linie_id
         JOIN comanda c        ON c.id = cl.comanda_id
         JOIN produs p         ON p.id = cl.produs_id
         LEFT JOIN motiv mo    ON mo.id = pl.motiv_incheiere_id
        WHERE pl.id = $1`, [id]);
    if (!plan) return null;
    const { rows: marimi } = await c.query<DetaliiPlanificare['marimi'][number]>(
      `SELECT m.cod AS marime, pc.cantitate AS planificat,
              coalesce((SELECT sum(le.cantitate) FROM lot_croit lc JOIN lot_croit_efectiv le ON le.lot_id = lc.id
                         WHERE lc.planificare_id = pc.planificare_id AND le.marime_id = pc.marime_id), 0)::int AS croit,
              0 AS rest
         FROM planificare_cantitate pc JOIN marime m ON m.id = pc.marime_id
        WHERE pc.planificare_id = $1 ORDER BY m.ordine`, [id]);
    const { rows: loturi } = await c.query<DetaliiPlanificare['loturi'][number]>(
      `SELECT lc.id, $2 || '/C' || lc.numar_lot AS cod,
              (SELECT coalesce(sum(cantitate), 0) FROM lot_croit_cantitate WHERE lot_id = lc.id)::int AS cerut,
              (SELECT sum(cantitate) FROM lot_croit_efectiv WHERE lot_id = lc.id)::int AS croit,
              to_char(lc.croit_la, 'YYYY-MM-DD HH24:MI') AS croit_la, lc.taiere_id, 'T' || t.numar AS taiere
         FROM lot_croit lc LEFT JOIN taiere t ON t.id = lc.taiere_id
        WHERE lc.planificare_id = $1 ORDER BY lc.numar_lot`, [id, plan.cod]);
    return {
      plan,
      marimi: marimi.map((m) => ({ ...m, rest: Math.max(0, m.planificat - m.croit) })),
      loturi,
      materiale: await acoperire(c, id),
    };
  });
}

/**
 * Trimite planificarea la croit, la coada celor trimise. Croitul hotărăște apoi ce
 * taie odată: toată, o parte, sau împreună cu alte comenzi pe același model.
 * Se refuză dacă stofa principală nu ajunge.
 */
export async function trimiteLaCroit(id: string): Promise<string | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [pl] } = await c.query<{ stadiu: string }>(
      `SELECT stadiu::text FROM planificare WHERE id = $1 FOR UPDATE`, [id]);
    if (!pl) return 'Planificarea nu există.';
    if (!['gata_de_lansat', 'blocat_materiale'].includes(pl.stadiu)) return 'Planificarea e deja la croit sau închisă.';
    const lipsa = (await acoperire(c, id)).filter((a) => a.principal && !a.acoperit);
    if (lipsa.length > 0) return `Nu ajunge stofa: ${lipsa.map((a) => a.denumire).join(', ')}.`;
    await c.query(`LOCK TABLE planificare IN SHARE ROW EXCLUSIVE MODE`);
    await c.query(
      `UPDATE planificare SET stadiu = 'lansat_spre_croit',
              ordine_croit = (SELECT coalesce(max(ordine_croit), 0) + 1 FROM planificare)
        WHERE id = $1`, [id]);
    return null;
  });
}

/** Mută planificarea cu un loc mai sus (-1) sau mai jos (+1) în ordinea spre croit. */
export async function mutaLaCroit(id: string, pas: -1 | 1): Promise<void> {
  await caFirma(firmaCurenta(), async (c) => {
    await c.query(`LOCK TABLE planificare IN SHARE ROW EXCLUSIVE MODE`);
    const { rows: [vecina] } = await c.query<{ id: string; ordine: number }>(
      `SELECT v.id, v.ordine_croit AS ordine FROM planificare v, planificare t
        WHERE t.id = $1 AND v.id <> t.id AND v.stadiu IN ('lansat_spre_croit', 'in_croit')
          AND (CASE WHEN $2 < 0 THEN v.ordine_croit < t.ordine_croit ELSE v.ordine_croit > t.ordine_croit END)
        ORDER BY CASE WHEN $2 < 0 THEN -v.ordine_croit ELSE v.ordine_croit END LIMIT 1`, [id, pas]);
    if (!vecina) return;
    await c.query(
      `UPDATE planificare SET ordine_croit = CASE WHEN id = $1 THEN $3 ELSE (SELECT ordine_croit FROM planificare WHERE id = $1) END
        WHERE id IN ($1, $2)`, [id, vecina.id, vecina.ordine]);
  });
}

/** O planificare fără niciun lot se poate anula; după lansare, se încheie. */
export async function anuleazaPlanificare(id: string): Promise<string | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [{ loturi }] } = await c.query<{ loturi: number }>(
      `SELECT count(*)::int AS loturi FROM lot_croit WHERE planificare_id = $1`, [id]);
    if (loturi > 0) return 'Planificarea are loturi de croit: nu se mai anulează, se încheie.';
    await c.query(`UPDATE planificare SET stadiu = 'anulat' WHERE id = $1`, [id]);
    return null;
  });
}

/**
 * Încheie planificarea: ce nu s-a croit nu se mai croiește, iar rezervarea de
 * material se eliberează. Cu bucăți rămase necroite, motivul e obligatoriu.
 */
export async function incheiePlanificare(
  c: PoolClient, id: string, motivId: string | null, observatii = '',
): Promise<string | null> {
  const { rows: [{ deschise, rest }] } = await c.query<{ deschise: number; rest: number }>(
    `SELECT (SELECT count(*) FROM lot_croit WHERE planificare_id = $1 AND croit_la IS NULL)::int AS deschise,
            (SELECT coalesce(sum(rest), 0) FROM planificare_rest_de_croit WHERE planificare_id = $1)::int AS rest`,
    [id]);
  if (deschise > 0) return 'Un lot e încă la croit. Înregistrează întâi croitul.';
  if (rest > 0 && !motivId) return `Au rămas ${rest} bucăți necroite: alege motivul.`;
  if (rest > 0 && !observatii.trim()) return `Au rămas ${rest} bucăți necroite: scrie observațiile (ce s-a întâmplat).`;
  await c.query(
    `UPDATE planificare SET stadiu = 'incheiat', incheiat_la = now(), motiv_incheiere_id = $2,
            observatii_incheiere = $3 WHERE id = $1`,
    [id, rest > 0 ? motivId : null, rest > 0 ? observatii.trim() : null]);
  return null;
}


export async function motiveCroit(): Promise<{ id: string; nume: string }[]> {
  return interogare(`SELECT id, nume FROM motiv WHERE activ AND 'croit' = ANY (contexte) ORDER BY nume`);
}
