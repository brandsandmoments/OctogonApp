import { caFirma } from './db';
import {
  acoperire, actualizeazaStadiuMateriale, insereazaPlanificare, lanseaza, taiereNoua, type AcoperireMaterial,
} from './planificare';
import { firmaCurenta, interogare } from './sesiune';

/**
 * Taierile: una sau mai multe PSF și PSC pe același model, tăiate împreună
 * (0015). Planificatorul le face din ce e de planificat, le pune în ordine și le
 * trimite la croit; fiecare comandă își păstrează planificarea ei (…/P1), deci
 * după tăiere bucățile se împart înapoi pe comenzi.
 */

export type PlanificareInTaiere = {
  id: string;
  cod: string;
  comanda: string;
  tip: string;
  prioritate: number;
  data_ceruta: string;
  produs: string;
  stadiu: string;
  planificat: number;
  croit: number;
};

export type Taiere = {
  id: string;
  cod: string;
  ordine: number;
  model: string;
  model_cheie: string;
  trimis_la: string | null;
  observatii: string | null;
  planificari: PlanificareInTaiere[];
  bucati: number;
  termen: string;          // cel mai apropiat termen din comenzile ei
  stofa_lipsa: boolean;
  alte_lipsa: number;
};

const PLANIFICARI = `
  SELECT pl.taiere_id, pl.id, c.numar || '/P' || pl.numar_transa AS cod, c.numar AS comanda, c.tip::text AS tip,
         c.prioritate, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta, p.denumire AS produs,
         pl.stadiu::text AS stadiu, coalesce(mo.denumire, p.denumire) AS model,
         coalesce(p.model_id, p.id)::text AS model_cheie,
         (SELECT coalesce(sum(cantitate), 0) FROM planificare_cantitate WHERE planificare_id = pl.id)::int AS planificat,
         (SELECT coalesce(sum(le.cantitate), 0) FROM lot_croit lc JOIN lot_croit_efectiv le ON le.lot_id = lc.id
           WHERE lc.planificare_id = pl.id)::int AS croit
    FROM planificare pl
    JOIN comanda_linie cl ON cl.id = pl.linie_id
    JOIN comanda c        ON c.id = cl.comanda_id
    JOIN produs p         ON p.id = cl.produs_id
    LEFT JOIN model mo    ON mo.id = p.model_id
   WHERE pl.stadiu <> 'anulat'`;

/** Taierile încă în planificare, în ordinea în care pleacă la croit. */
export async function taieriInPlanificare(): Promise<Taiere[]> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: taieri } = await c.query<Pick<Taiere, 'id' | 'cod' | 'ordine' | 'trimis_la' | 'observatii'>>(
      `SELECT id, 'T' || numar AS cod, ordine, to_char(trimis_la, 'YYYY-MM-DD HH24:MI') AS trimis_la, observatii
         FROM taiere WHERE trimis_la IS NULL ORDER BY ordine`);
    const { rows: pl } = await c.query<PlanificareInTaiere & { taiere_id: string; model: string; model_cheie: string }>(
      `${PLANIFICARI} AND pl.taiere_id IN (SELECT id FROM taiere WHERE trimis_la IS NULL)
       ORDER BY c.prioritate, cl.data_ceruta, c.numar`);
    const rez: Taiere[] = [];
    for (const t of taieri) {
      const ale = pl.filter((p) => p.taiere_id === t.id);
      if (ale.length === 0) continue;
      const mat = await materiale(c, ale.map((p) => p.id));
      rez.push({
        ...t, planificari: ale, model: ale[0].model, model_cheie: ale[0].model_cheie,
        bucati: ale.reduce((s, p) => s + p.planificat, 0),
        termen: ale.map((p) => p.data_ceruta).sort()[0],
        stofa_lipsa: mat.some((m) => m.principal && !m.acoperit),
        alte_lipsa: mat.filter((m) => !m.principal && !m.acoperit).length,
      });
    }
    return rez;
  });
}

export type MaterialTaiere = Omit<AcoperireMaterial, 'inaintea_ei'>;

/**
 * Necesarul taierii: materialele tuturor planificărilor ei, adunate. Un material e
 * acoperit doar dacă e acoperit pentru fiecare planificare — stocul se alocă în
 * ordinea priorității, deci o comandă urgentă din altă taiere poate trece înainte.
 */
async function materiale(c: import('pg').PoolClient, planificari: string[]): Promise<MaterialTaiere[]> {
  const pe = new Map<string, MaterialTaiere>();
  for (const id of planificari) {
    for (const a of await acoperire(c, id)) {
      const x = pe.get(a.material_id);
      if (!x) { pe.set(a.material_id, { ...a }); continue; }
      x.necesar = String(Number(x.necesar) + Number(a.necesar));
      x.acoperit &&= a.acoperit;
    }
  }
  return [...pe.values()].sort((a, b) => Number(b.principal) - Number(a.principal) || a.denumire.localeCompare(b.denumire));
}

export type DetaliiTaiere = Taiere & { materiale: MaterialTaiere[] };

export async function detaliiTaiere(id: string): Promise<DetaliiTaiere | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [t] } = await c.query<Pick<Taiere, 'id' | 'cod' | 'ordine' | 'trimis_la' | 'observatii'>>(
      `SELECT id, 'T' || numar AS cod, ordine, to_char(trimis_la, 'YYYY-MM-DD HH24:MI') AS trimis_la, observatii
         FROM taiere WHERE id = $1`, [id]);
    if (!t) return null;
    const { rows: pl } = await c.query<PlanificareInTaiere & { model: string; model_cheie: string }>(
      `SELECT * FROM (${PLANIFICARI} AND pl.taiere_id = $1) x ORDER BY x.prioritate, x.data_ceruta, x.comanda`, [id]);
    const mat = await materiale(c, pl.map((p) => p.id));
    return {
      ...t, planificari: pl, model: pl[0]?.model ?? '—', model_cheie: pl[0]?.model_cheie ?? '',
      bucati: pl.reduce((s, p) => s + p.planificat, 0),
      termen: pl.map((p) => p.data_ceruta).sort()[0] ?? '',
      stofa_lipsa: mat.some((m) => m.principal && !m.acoperit),
      alte_lipsa: mat.filter((m) => !m.principal && !m.acoperit).length,
      materiale: mat,
    };
  });
}

/** Taierile încă neplecate pe un model: unde se mai poate adăuga o comandă. */
export async function taieriDeschisePeModel(modelCheie: string): Promise<{ id: string; cod: string }[]> {
  return interogare(
    `SELECT DISTINCT t.id, 'T' || t.numar AS cod, t.ordine
       FROM taiere t
       JOIN planificare pl   ON pl.taiere_id = t.id AND pl.stadiu <> 'anulat'
       JOIN comanda_linie cl ON cl.id = pl.linie_id
       JOIN produs p         ON p.id = cl.produs_id
      WHERE t.trimis_la IS NULL AND coalesce(p.model_id, p.id)::text = $1
      ORDER BY t.ordine`, [modelCheie]);
}

/**
 * Pune liniile într-o taiere — nouă sau una existentă, încă neplecată —, fiecare
 * cu tot ce i-a rămas de planificat. Toate sau niciuna: o taiere pe jumătate
 * făcută ar trimite la croit doar o parte din ce s-a hotărât să se taie împreună.
 */
export async function grupeaza(linii: string[], taiereId?: string): Promise<{ id: string } | { eroare: string }> {
  if (linii.length === 0) return { eroare: 'Alege cel puțin o comandă.' };
  return caFirma(firmaCurenta(), async (c) => {
    const { rows } = await c.query<{ linie_id: string; cheie: string; are_reteta: boolean; comanda: string; produs: string }>(
      `SELECT cl.id AS linie_id, coalesce(p.model_id, p.id)::text AS cheie, c.numar AS comanda, p.denumire AS produs,
              EXISTS (SELECT 1 FROM model_componenta mc WHERE mc.model_id = p.model_id) AS are_reteta
         FROM comanda_linie cl JOIN comanda c ON c.id = cl.comanda_id JOIN produs p ON p.id = cl.produs_id
        WHERE cl.id = ANY ($1::uuid[])`, [linii]);
    if (rows.length !== linii.length) return { eroare: 'O linie nu mai există.' };
    if (new Set(rows.map((r) => r.cheie)).size > 1) return { eroare: 'Împreună se taie doar comenzi de pe același model.' };
    const fara = rows.find((r) => !r.are_reteta);
    if (fara) return { eroare: `${fara.produs} nu are rețetă: completează întâi rețeta modelului.` };

    let id = taiereId;
    if (id) {
      const { rows: [t] } = await c.query<{ trimis: boolean }>(
        `SELECT trimis_la IS NOT NULL AS trimis FROM taiere WHERE id = $1 FOR UPDATE`, [id]);
      if (!t) return { eroare: 'Taierea nu există.' };
      if (t.trimis) return { eroare: 'Taierea a plecat deja la croit.' };
    } else {
      id = await taiereNoua(c);
    }
    for (const r of rows) {
      await c.query(`SELECT 1 FROM comanda WHERE numar = $1 FOR UPDATE`, [r.comanda]);
      const { rows: rest } = await c.query<{ marime_id: string; q: number }>(
        `SELECT cc.marime_id, greatest(cc.cantitate - coalesce(pp.cantitate, 0), 0)::int AS q
           FROM comanda_cantitate cc
           LEFT JOIN planificat_pe_pozitie pp ON pp.linie_id = cc.linie_id AND pp.marime_id = cc.marime_id
          WHERE cc.linie_id = $1`, [r.linie_id]);
      const alese = rest.filter((m) => m.q > 0);
      if (alese.length === 0) return { eroare: `${r.comanda} · ${r.produs}: nu a rămas nimic de planificat.` };
      const pl = await insereazaPlanificare(c, r.linie_id, alese, '', id);
      await actualizeazaStadiuMateriale(c, pl);
    }
    return { id };
  });
}

/**
 * Scoate o comandă dintr-o taiere încă neplecată: planificarea ei se anulează, iar
 * bucățile redevin de planificat. Taierea rămasă goală dispare.
 */
export async function scoate(taiereId: string, planificareId: string): Promise<string | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [t] } = await c.query<{ trimis: boolean }>(
      `SELECT trimis_la IS NOT NULL AS trimis FROM taiere WHERE id = $1 FOR UPDATE`, [taiereId]);
    if (!t) return 'Taierea nu există.';
    if (t.trimis) return 'Taierea a plecat deja la croit: ce se croiește hotărăște croitul.';
    const { rowCount } = await c.query(
      `UPDATE planificare SET stadiu = 'anulat', taiere_id = NULL
        WHERE id = $1 AND taiere_id = $2 AND NOT EXISTS (SELECT 1 FROM lot_croit WHERE planificare_id = $1)`,
      [planificareId, taiereId]);
    if (!rowCount) return 'Comanda nu e în taierea asta.';
    await c.query(
      `DELETE FROM taiere WHERE id = $1
          AND NOT EXISTS (SELECT 1 FROM planificare WHERE taiere_id = $1)`, [taiereId]);
    return null;
  });
}

/** Mută taierea cu un loc mai sus (-1) sau mai jos (+1) în coada spre croit. */
export async function muta(id: string, pas: -1 | 1): Promise<void> {
  await caFirma(firmaCurenta(), async (c) => {
    await c.query(`LOCK TABLE taiere IN SHARE ROW EXCLUSIVE MODE`);
    const { rows: [vecina] } = await c.query<{ id: string; ordine: number }>(
      `SELECT v.id, v.ordine FROM taiere v, taiere t
        WHERE t.id = $1 AND v.trimis_la IS NULL AND v.id <> t.id
          AND (CASE WHEN $2 < 0 THEN v.ordine < t.ordine ELSE v.ordine > t.ordine END)
        ORDER BY CASE WHEN $2 < 0 THEN -v.ordine ELSE v.ordine END LIMIT 1`, [id, pas]);
    if (!vecina) return;
    await c.query(
      `UPDATE taiere SET ordine = CASE WHEN id = $1 THEN $3 ELSE (SELECT ordine FROM taiere WHERE id = $1) END
        WHERE id IN ($1, $2)`, [id, vecina.id, vecina.ordine]);
  });
}

/**
 * Trimite taierea la croit: fiecare planificare din ea primește lotul ei, cu tot
 * ce i-a rămas de croit. Toate sau niciuna — o comandă blocată de stofă oprește
 * toată taierea, ca să nu se întindă masa pe jumătate.
 */
export async function trimiteLaCroit(id: string): Promise<string | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [t] } = await c.query<{ trimis: boolean }>(
      `SELECT trimis_la IS NOT NULL AS trimis FROM taiere WHERE id = $1 FOR UPDATE`, [id]);
    if (!t) return 'Taierea nu există.';
    if (t.trimis) return 'Taierea a plecat deja la croit.';
    const { rows: pl } = await c.query<{ id: string; cod: string }>(
      `SELECT pl.id, c.numar || '/P' || pl.numar_transa AS cod
         FROM planificare pl JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN comanda c ON c.id = cl.comanda_id
        WHERE pl.taiere_id = $1 AND pl.stadiu NOT IN ('anulat', 'incheiat')`, [id]);
    if (pl.length === 0) return 'Taierea nu are nicio comandă.';
    for (const p of pl) {
      const eroare = await lanseaza(c, p.id);
      if (eroare) throw new EroareTaiere(`${p.cod}: ${eroare}`);
    }
    await c.query(`UPDATE taiere SET trimis_la = now(), trimis_de = utilizator_curent() WHERE id = $1`, [id]);
    return null;
  }).catch((e) => {
    if (e instanceof EroareTaiere) return e.message;
    throw e;
  });
}

/** Aruncată ca tranzacția să se anuleze: loturile deja create pentru taiere nu rămân. */
class EroareTaiere extends Error {}
