import type { PoolClient } from 'pg';
import { caFirma } from './db';
import { inregistreazaLot, Refuz } from './croit';
import { incheiePlanificare } from './planificare';
import { firmaCurenta, interogare } from './sesiune';

/**
 * Croitul pe taiere (0016). Planificarea trimite comenzile la croit; din „rămas de
 * croit" șefa de croit face taierile — ce se taie odată: o parte dintr-un PSF, un
 * PSF cu alt PSF, un PSF cu un PSC de pe același model. Bucata fiecărei comenzi
 * dintr-o taiere e un lot. Pe taiere se scriu operațiile (cine, de la ce oră la ce
 * oră), metrii și defectele pe fiecare culoare, apoi croitul efectiv.
 */

export const OPERATII = {
  intins: 'Întins',
  taiat: 'Tăiat',
  termocolat: 'Termocolat',
  imperecheat: 'Împerecheat, separat pe culori, pregătit pentru lucru',
} as const;
export type Operatie = keyof typeof OPERATII;

/** Un refuz în mijlocul tranzacției: aruncat, ca ce s-a scris deja să se anuleze. */
class Oprit extends Error {}
const opreste = (m: string): never => { throw new Oprit(m); };
async function cuOprire<T>(f: () => Promise<T>): Promise<T | string> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof Oprit || e instanceof Refuz) return e.message;
    throw e;
  }
}

// ---------------------------------------------------------------- rămas de croit

export type RamasDeCroit = {
  planificare_id: string;
  cod: string;
  comanda: string;
  tip: string;
  prioritate: number;
  data_ceruta: string;
  produs: string;
  model_cheie: string;
  model: string;
  fara_model: boolean;        // fără model nu se poate tăia cu alte culori
  ordine: number | null;
  in_taieri: number;          // bucăți puse deja în taieri încă necroite
  marimi: { marime_id: string; marime: string; planificat: number; croit: number; in_taieri: number; disponibil: number }[];
  disponibil: number;
};

/**
 * Ce a trimis planificarea la croit și încă n-a intrat în nicio taiere: pe mărimi,
 * planificat minus croit minus ce stă deja în taieri necroite. Un PSF tăiat
 * parțial rămâne aici cu restul, până se croiește sau până îl închide croitul.
 * Ordinea e cea pusă de planificare.
 */
export async function ramasDeCroit(planificari?: string[]): Promise<RamasDeCroit[]> {
  const randuri = await interogare<Omit<RamasDeCroit, 'marimi' | 'disponibil' | 'in_taieri'> & RamasDeCroit['marimi'][number]>(
    `WITH deschis AS (
         SELECT lc.planificare_id, lq.marime_id, sum(lq.cantitate)::int AS q
           FROM lot_croit lc JOIN lot_croit_cantitate lq ON lq.lot_id = lc.id
          WHERE lc.croit_la IS NULL GROUP BY lc.planificare_id, lq.marime_id)
     SELECT r.planificare_id, c.numar || '/P' || pl.numar_transa AS cod, c.numar AS comanda, c.tip::text AS tip,
            c.prioritate, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta, p.denumire AS produs,
            coalesce(p.model_id, p.id)::text AS model_cheie, coalesce(mo.denumire, p.denumire) AS model,
            p.model_id IS NULL AS fara_model, pl.ordine_croit AS ordine,
            r.marime_id, m.cod AS marime, r.planificat, r.croit, coalesce(d.q, 0) AS in_taieri,
            greatest(r.rest - coalesce(d.q, 0), 0)::int AS disponibil
       FROM planificare_rest_de_croit r
       JOIN planificare pl   ON pl.id = r.planificare_id
       JOIN comanda_linie cl ON cl.id = pl.linie_id
       JOIN comanda c        ON c.id = cl.comanda_id
       JOIN produs p         ON p.id = cl.produs_id
       LEFT JOIN model mo    ON mo.id = p.model_id
       JOIN marime m         ON m.id = r.marime_id
       LEFT JOIN deschis d   ON d.planificare_id = r.planificare_id AND d.marime_id = r.marime_id
      WHERE pl.stadiu IN ('lansat_spre_croit', 'in_croit')
        AND ($1::uuid[] IS NULL OR pl.id = ANY ($1::uuid[]))
      ORDER BY pl.ordine_croit NULLS LAST, c.prioritate, cl.data_ceruta, c.numar, pl.numar_transa, m.ordine`,
    [planificari ?? null],
  );
  const pe = new Map<string, RamasDeCroit>();
  for (const { marime_id, marime, planificat, croit, in_taieri, disponibil, ...r } of randuri) {
    const x = pe.get(r.planificare_id) ?? { ...r, marimi: [], disponibil: 0, in_taieri: 0 };
    x.marimi.push({ marime_id, marime, planificat, croit, in_taieri, disponibil });
    x.disponibil += disponibil;
    x.in_taieri += in_taieri;
    pe.set(r.planificare_id, x);
  }
  return [...pe.values()].filter((r) => planificari || r.disponibil > 0);
}

// ---------------------------------------------------------------- facerea taierilor

/** Taierile care încă se pot schimba: niciun lot croit. */
export async function taieriDeschise(modelCheie: string): Promise<{ id: string; cod: string }[]> {
  return interogare(
    `SELECT DISTINCT t.id, 'T' || t.numar AS cod, t.numar
       FROM taiere t
       JOIN lot_croit lc     ON lc.taiere_id = t.id
       JOIN planificare pl   ON pl.id = lc.planificare_id
       JOIN comanda_linie cl ON cl.id = pl.linie_id
       JOIN produs p         ON p.id = cl.produs_id
      WHERE coalesce(p.model_id, p.id)::text = $1
        AND NOT EXISTS (SELECT 1 FROM lot_croit x WHERE x.taiere_id = t.id AND x.croit_la IS NOT NULL)
      ORDER BY t.numar`, [modelCheie]);
}

/** Toate taierile încă necroite, cu modelul lor: unde se mai poate adăuga. */
export async function taieriDeschiseToate(): Promise<{ id: string; cod: string; model_cheie: string }[]> {
  return interogare(
    `SELECT DISTINCT ON (t.id) t.id, 'T' || t.numar AS cod, coalesce(p.model_id, p.id)::text AS model_cheie
       FROM taiere t
       JOIN lot_croit lc     ON lc.taiere_id = t.id
       JOIN planificare pl   ON pl.id = lc.planificare_id
       JOIN comanda_linie cl ON cl.id = pl.linie_id
       JOIN produs p         ON p.id = cl.produs_id
      WHERE NOT EXISTS (SELECT 1 FROM lot_croit x WHERE x.taiere_id = t.id AND x.croit_la IS NOT NULL)
      ORDER BY t.id`);
}

export type Alocare = { planificareId: string; marimi: Map<string, number> };

async function taiereNoua(c: PoolClient): Promise<string> {
  // Numărul se ia sub blocare: două taieri simultane ar primi același T.
  await c.query(`LOCK TABLE taiere IN SHARE ROW EXCLUSIVE MODE`);
  const { rows: [{ id }] } = await c.query<{ id: string }>(
    `INSERT INTO taiere (firma_id, numar, ordine, trimis_la, trimis_de)
     VALUES (firma_curenta(), (SELECT coalesce(max(numar), 0) + 1 FROM taiere),
             (SELECT coalesce(max(ordine), 0) + 1 FROM taiere), now(), utilizator_curent())
     RETURNING id`);
  return id;
}

/**
 * Face o taiere — sau adaugă la una încă necroită — din bucăți ale comenzilor
 * rămase de croit: fiecare comandă primește un lot cu mărimile alese. Nu se poate
 * pune mai mult decât a rămas; baza refuză două modele în aceeași taiere.
 */
export async function puneInTaiere(alocari: Alocare[], taiereId?: string): Promise<{ id: string } | string> {
  const alese = alocari
    .map((a) => ({ ...a, marimi: [...a.marimi].filter(([, q]) => q !== 0) }))
    .filter((a) => a.marimi.length > 0);
  if (alese.length === 0) return 'Taierea nu are nicio bucată.';
  const ramas = await ramasDeCroit(alese.map((a) => a.planificareId));
  for (const a of alese) {
    const r = ramas.find((x) => x.planificare_id === a.planificareId);
    if (!r) return 'O comandă nu mai e de croit.';
    for (const [marime, q] of a.marimi) {
      const m = r.marimi.find((x) => x.marime_id === marime);
      if (!m || !Number.isInteger(q) || q < 0) return `${r.cod}: cantitate nevalidă.`;
      if (q > m.disponibil) return `${r.cod}: la ${m.marime} au rămas de croit doar ${m.disponibil}.`;
    }
  }
  if (new Set(ramas.map((r) => r.model_cheie)).size > 1) return 'Împreună se taie doar comenzi de pe același model.';

  return cuOprire(() => caFirma(firmaCurenta(), async (c) => {
    let id = taiereId;
    if (id) {
      const { rows: [t] } = await c.query<{ croita: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM lot_croit WHERE taiere_id = t.id AND croit_la IS NOT NULL) AS croita
           FROM taiere t WHERE t.id = $1 FOR UPDATE`, [id]);
      if (!t) opreste('Taierea nu există.');
      if (t.croita) opreste('Taierea e deja croită: fă una nouă.');
    } else {
      id = await taiereNoua(c);
    }
    for (const a of alese) {
      // Aceeași comandă de două ori în aceeași taiere: bucățile se adună în lotul ei.
      const { rows: [existent] } = await c.query<{ id: string }>(
        `SELECT id FROM lot_croit WHERE taiere_id = $1 AND planificare_id = $2 AND croit_la IS NULL`, [id, a.planificareId]);
      let lot = existent?.id;
      if (!lot) {
        await c.query(`SELECT 1 FROM planificare WHERE id = $1 FOR UPDATE`, [a.planificareId]);
        try {
          ({ rows: [{ id: lot }] } = await c.query<{ id: string }>(
            `INSERT INTO lot_croit (firma_id, planificare_id, numar_lot, taiere_id)
             VALUES (firma_curenta(), $1, (SELECT coalesce(max(numar_lot), 0) + 1 FROM lot_croit WHERE planificare_id = $1), $2)
             RETURNING id`, [a.planificareId, id]));
        } catch (e) {
          if ((e as { code?: string }).code === '23514') opreste('Împreună se taie doar comenzi de pe același model.');
          throw e;
        }
      }
      for (const [marime, q] of a.marimi) {
        await c.query(
          `INSERT INTO lot_croit_cantitate (firma_id, lot_id, marime_id, cantitate)
           VALUES (firma_curenta(), $1, $2, $3)
           ON CONFLICT (lot_id, marime_id) DO UPDATE SET cantitate = lot_croit_cantitate.cantitate + EXCLUDED.cantitate`,
          [lot, marime, q]);
      }
    }
    return { id: id! };
  }));
}

/**
 * Scoate o comandă dintr-o taiere încă neîncepută; bucățile ei redevin de croit.
 * Taierea rămasă goală dispare.
 */
export async function scoateDinTaiere(taiereId: string, lotId: string): Promise<string | null> {
  return cuOprire(() => caFirma(firmaCurenta(), async (c) => {
    const { rows: [l] } = await c.query<{ croit: boolean }>(
      `SELECT croit_la IS NOT NULL AS croit FROM lot_croit WHERE id = $1 AND taiere_id = $2 FOR UPDATE`, [lotId, taiereId]);
    if (!l) opreste('Comanda nu e în taierea asta.');
    if (l.croit) opreste('Comanda e deja croită.');
    if ((await c.query(`SELECT 1 FROM taiere_operatie WHERE taiere_id = $1 LIMIT 1`, [taiereId])).rowCount) {
      opreste('Taierea a început (întins, tăiat): nu se mai scot comenzi din ea.');
    }
    await c.query(`DELETE FROM lot_croit WHERE id = $1`, [lotId]);
    await c.query(`DELETE FROM taiere WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM lot_croit WHERE taiere_id = $1)`, [taiereId]);
    return null;
  }));
}

/**
 * Stinge o comandă din „rămas de croit": ce n-a fost croit nu se mai croiește —
 * n-a ajuns materialul, s-a renunțat la o mărime. Doar cu motiv și observații.
 */
export async function inchideComanda(planificareId: string, motivId: string | null, observatii: string): Promise<string | null> {
  if (!motivId) return 'Alege motivul.';
  if (!observatii.trim()) return 'Scrie observațiile: ce s-a întâmplat.';
  return caFirma(firmaCurenta(), (c) => incheiePlanificare(c, planificareId, motivId, observatii));
}

// ---------------------------------------------------------------- lista taierilor

export type VedereCroit = 'toate' | 'taieri' | 'croite';

export type TaiereLaCroit = {
  id: string;
  cod: string;
  model: string;
  comenzi: string;
  facuta_la: string;
  croit_la: string | null;    // ultimul lot croit, când nu mai e niciunul deschis
  cerut: number;
  croit: number;
  loturi_deschise: number;
  componente: number;
  intinse: number;
  taiate: number;
  imperecheat: boolean;
};

/** Taierile: în lucru (necroite încă, cele mai vechi sus) și croite (cele mai noi sus). */
export async function taieriLaCroit(vedere: VedereCroit): Promise<TaiereLaCroit[]> {
  const toate = await interogare<TaiereLaCroit>(
    `WITH l AS (
         SELECT lc.taiere_id,
                count(*) FILTER (WHERE lc.croit_la IS NULL)::int AS deschise,
                max(lc.croit_la) AS croit_la,
                sum((SELECT coalesce(sum(cantitate), 0) FROM lot_croit_cantitate WHERE lot_id = lc.id))::int AS cerut,
                sum((SELECT coalesce(sum(cantitate), 0) FROM lot_croit_efectiv WHERE lot_id = lc.id))::int AS croit,
                string_agg(DISTINCT c.numar, ', ') AS comenzi,
                min(coalesce(mo.denumire, p.denumire)) AS model,
                min(p.model_id::text)::uuid AS model_id
           FROM lot_croit lc
           JOIN planificare pl   ON pl.id = lc.planificare_id
           JOIN comanda_linie cl ON cl.id = pl.linie_id
           JOIN comanda c        ON c.id = cl.comanda_id
           JOIN produs p         ON p.id = cl.produs_id
           LEFT JOIN model mo    ON mo.id = p.model_id
          WHERE pl.stadiu <> 'anulat'
          GROUP BY lc.taiere_id)
     SELECT t.id, 'T' || t.numar AS cod, l.model, l.comenzi,
            to_char(coalesce(t.trimis_la, t.creat_la), 'YYYY-MM-DD') AS facuta_la,
            CASE WHEN l.deschise = 0 THEN to_char(l.croit_la, 'YYYY-MM-DD') END AS croit_la,
            l.cerut, l.croit, l.deschise AS loturi_deschise,
            (SELECT count(*) FROM model_componenta mc WHERE mc.model_id = l.model_id AND mc.tip = 'materie_prima')::int AS componente,
            (SELECT count(*) FROM taiere_operatie o WHERE o.taiere_id = t.id AND o.operatie = 'intins' AND o.terminat_la IS NOT NULL)::int AS intinse,
            (SELECT count(*) FROM taiere_operatie o WHERE o.taiere_id = t.id AND o.operatie = 'taiat' AND o.terminat_la IS NOT NULL)::int AS taiate,
            EXISTS (SELECT 1 FROM taiere_operatie o WHERE o.taiere_id = t.id AND o.operatie = 'imperecheat' AND o.terminat_la IS NOT NULL) AS imperecheat
       FROM taiere t JOIN l ON l.taiere_id = t.id
      ORDER BY l.deschise = 0, CASE WHEN l.deschise > 0 THEN t.numar END, l.croit_la DESC, t.numar DESC`,
  );
  return toate.filter((t) => vedere === 'toate' || (vedere === 'taieri') === (t.loturi_deschise > 0));
}

// ---------------------------------------------------------------- fișa taierii

export type OperatieScrisa = {
  id: string;
  componenta_id: string | null;
  operatie: Operatie;
  operator_id: string;
  operator: string;
  inceput_la: string;      // YYYY-MM-DDTHH:MI, pentru datetime-local
  terminat_la: string | null;
  fata_verificata: boolean;
  observatii: string | null;
};

/** Ce se întinde dintr-o componentă pe o culoare: materialul ei, cât ar trebui, cât s-a folosit. */
export type CuloareInTaiere = {
  componenta_id: string;
  produs_id: string;
  culoare: string;
  material_id: string;
  material: string;
  unitate: string;
  teoretic: string;        // bucăți × consum
  metri: string | null;
  defecte: string | null;
};

export type LotInTaiere = {
  id: string;
  cod: string;
  comanda: string;
  tip: string;
  prioritate: number;
  produs: string;
  croit_la: string | null;
  marimi: { marime_id: string; marime: string; cerut: number; croit: number | null }[];
};

export type FisaTaiere = {
  taiere: { id: string; cod: string; model: string; model_cheie: string; facuta_la: string | null };
  componente: { id: string; nume: string; principal: boolean }[];
  operatii: OperatieScrisa[];
  culori: CuloareInTaiere[];
  loturi: LotInTaiere[];
  oameni: { id: string; nume: string }[];
  rest_deschis: number;    // bucăți necroite din comenzile încă deschise ale taierii
};

export async function fisaTaiere(id: string): Promise<FisaTaiere | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [taiere] } = await c.query<FisaTaiere['taiere'] & { model_id: string | null }>(
      `SELECT t.id, 'T' || t.numar AS cod, to_char(coalesce(t.trimis_la, t.creat_la), 'YYYY-MM-DD HH24:MI') AS facuta_la,
              x.model, x.model_cheie, x.model_id
         FROM taiere t
         LEFT JOIN LATERAL (
              SELECT coalesce(mo.denumire, p.denumire) AS model, coalesce(p.model_id, p.id)::text AS model_cheie, p.model_id
                FROM lot_croit lc JOIN planificare pl ON pl.id = lc.planificare_id
                JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN produs p ON p.id = cl.produs_id
                LEFT JOIN model mo ON mo.id = p.model_id
               WHERE lc.taiere_id = t.id LIMIT 1) x ON true
        WHERE t.id = $1`, [id]);
    if (!taiere) return null;
    const { rows: componente } = await c.query<FisaTaiere['componente'][number]>(
      `SELECT id, nume, principal FROM model_componenta
        WHERE model_id = $1 AND tip = 'materie_prima' ORDER BY principal DESC, nume`, [taiere.model_id]);
    const { rows: operatii } = await c.query<OperatieScrisa>(
      `SELECT o.id, o.componenta_id, o.operatie::text AS operatie, o.operator_id, u.nume AS operator,
              to_char(o.inceput_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD"T"HH24:MI') AS inceput_la,
              to_char(o.terminat_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD"T"HH24:MI') AS terminat_la,
              o.fata_verificata, o.observatii
         FROM taiere_operatie o JOIN utilizator u ON u.id = o.operator_id
        WHERE o.taiere_id = $1`, [id]);
    // Pe fiecare componentă care se croiește, câte un rând pe culoare (produs), cu materialul ei.
    const { rows: culori } = await c.query<CuloareInTaiere>(
      `WITH buc AS (
           SELECT cl.produs_id,
                  sum(coalesce((SELECT sum(cantitate) FROM lot_croit_efectiv WHERE lot_id = lc.id),
                               (SELECT sum(cantitate) FROM lot_croit_cantitate WHERE lot_id = lc.id))) AS q
             FROM lot_croit lc JOIN planificare pl ON pl.id = lc.planificare_id
             JOIN comanda_linie cl ON cl.id = pl.linie_id
            WHERE lc.taiere_id = $1 GROUP BY cl.produs_id)
       SELECT pm.componenta_id, b.produs_id, coalesce(cu.nume, p.denumire) AS culoare,
              m.id AS material_id, m.denumire AS material, m.unitate::text AS unitate,
              (b.q * mc.consum)::numeric(12,2)::text AS teoretic,
              tm.metri::text AS metri, tm.defecte
         FROM buc b
         JOIN produs p            ON p.id = b.produs_id
         LEFT JOIN culoare cu     ON cu.id = p.culoare_id
         JOIN produs_material pm  ON pm.produs_id = b.produs_id
         JOIN model_componenta mc ON mc.id = pm.componenta_id AND mc.tip = 'materie_prima'
         JOIN material m          ON m.id = pm.material_id
         LEFT JOIN taiere_material tm ON tm.taiere_id = $1 AND tm.componenta_id = pm.componenta_id AND tm.produs_id = b.produs_id
        ORDER BY coalesce(cu.nume, p.denumire)`, [id]);
    const { rows: lot } = await c.query<Omit<LotInTaiere, 'marimi'> & LotInTaiere['marimi'][number]>(
      `SELECT lc.id, c.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot AS cod, c.numar AS comanda,
              c.tip::text AS tip, c.prioritate, p.denumire AS produs,
              to_char(lc.croit_la, 'YYYY-MM-DD HH24:MI') AS croit_la,
              lq.marime_id, m.cod AS marime, lq.cantitate AS cerut, le.cantitate AS croit
         FROM lot_croit lc
         JOIN planificare pl   ON pl.id = lc.planificare_id
         JOIN comanda_linie cl ON cl.id = pl.linie_id
         JOIN comanda c        ON c.id = cl.comanda_id
         JOIN produs p         ON p.id = cl.produs_id
         JOIN lot_croit_cantitate lq ON lq.lot_id = lc.id
         JOIN marime m         ON m.id = lq.marime_id
         LEFT JOIN lot_croit_efectiv le ON le.lot_id = lc.id AND le.marime_id = lq.marime_id
        WHERE lc.taiere_id = $1 AND pl.stadiu <> 'anulat'
        ORDER BY c.prioritate, c.numar, p.denumire, lc.numar_lot, m.ordine`, [id]);
    const loturi = new Map<string, LotInTaiere>();
    for (const { marime_id, marime, cerut, croit, ...l } of lot) {
      const x = loturi.get(l.id) ?? { ...l, marimi: [] };
      x.marimi.push({ marime_id, marime, cerut, croit });
      loturi.set(l.id, x);
    }
    const { rows: oameni } = await c.query<{ id: string; nume: string }>(
      `SELECT id, nume FROM utilizator
        WHERE activ AND roluri && ARRAY['croit', 'operator_croit']::rol[] ORDER BY nume`);
    const { rows: [{ rest }] } = await c.query<{ rest: number }>(
      `SELECT coalesce(sum(r.rest), 0)::int AS rest FROM planificare_rest_de_croit r
         JOIN planificare pl ON pl.id = r.planificare_id
        WHERE pl.stadiu NOT IN ('anulat', 'incheiat')
          AND pl.id IN (SELECT planificare_id FROM lot_croit WHERE taiere_id = $1)`, [id]);
    const { model_id: _, ...t } = taiere;
    return { taiere: t, componente, operatii, culori, loturi: [...loturi.values()], oameni, rest_deschis: rest };
  });
}

// ---------------------------------------------------------------- operații

/** Începe o operație acum: cine o face și pe ce material. */
export async function incepe(taiereId: string, componentaId: string | null, operatie: Operatie, operatorId: string): Promise<string | null> {
  if (!operatorId) return 'Alege cine lucrează.';
  try {
    await interogare(
      `INSERT INTO taiere_operatie (firma_id, taiere_id, componenta_id, operatie, operator_id, inceput_la)
       VALUES (firma_curenta(), $1, $2, $3, $4, now())`,
      [taiereId, operatie === 'imperecheat' ? null : componentaId, operatie, operatorId]);
    return null;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return 'Operația e deja începută.';
    throw e;
  }
}

/** Termină o operație acum. Întinsul se termină doar cu fața materialului verificată. */
export async function termina(id: string, fataVerificata: boolean): Promise<string | null> {
  const [o] = await interogare<{ operatie: string; terminat: boolean }>(
    `SELECT operatie::text, terminat_la IS NOT NULL AS terminat FROM taiere_operatie WHERE id = $1`, [id]);
  if (!o) return 'Operația nu există.';
  if (o.terminat) return 'Operația e deja terminată.';
  if (o.operatie === 'intins' && !fataVerificata) return 'Bifează că ai verificat fața materialului.';
  await interogare(
    `UPDATE taiere_operatie SET terminat_la = now(), fata_verificata = fata_verificata OR $2 WHERE id = $1`,
    [id, fataVerificata]);
  return null;
}

/** Corectura șefei de croit: omul, orele, fața; o operație fără început se șterge. */
export async function corecteaza(
  id: string, operatorId: string, inceput: string, terminat: string, fata: boolean, observatii: string,
): Promise<string | null> {
  if (!inceput) {
    await interogare(`DELETE FROM taiere_operatie WHERE id = $1`, [id]);
    return null;
  }
  try {
    await interogare(
      `UPDATE taiere_operatie
          SET operator_id = $2, inceput_la = $3::timestamp AT TIME ZONE 'Europe/Bucharest',
              terminat_la = nullif($4, '')::timestamp AT TIME ZONE 'Europe/Bucharest',
              fata_verificata = $5, observatii = nullif($6, '')
        WHERE id = $1`, [id, operatorId, inceput, terminat, fata, observatii.trim()]);
    return null;
  } catch (e) {
    if ((e as { code?: string }).code === '23514') return 'Sfârșitul e înaintea începutului, sau întinsul n-are fața verificată.';
    throw e;
  }
}

/** Metrii folosiți și defectele de țesătură dintr-o componentă, pe o culoare. */
export async function scrieMetri(
  taiereId: string, componentaId: string, produsId: string, metri: number | null, defecte: string,
): Promise<string | null> {
  if (metri !== null && !(metri >= 0)) return 'Metrii nu sunt un număr valid.';
  const [t] = await interogare<{ croita: boolean }>(
    `SELECT NOT EXISTS (SELECT 1 FROM lot_croit WHERE taiere_id = $1 AND croit_la IS NULL) AS croita
       FROM taiere WHERE id = $1`, [taiereId]);
  if (!t) return 'Taierea nu există.';
  if (t.croita) return 'Croitul taierii e înregistrat: metrii au scăzut deja din stoc.';
  const rez = await interogare(
    `INSERT INTO taiere_material (firma_id, taiere_id, componenta_id, produs_id, material_id, metri, defecte)
     SELECT firma_curenta(), $1, $2, $3, pm.material_id, $4, nullif($5, '')
       FROM produs_material pm WHERE pm.produs_id = $3 AND pm.componenta_id = $2
     ON CONFLICT (taiere_id, componenta_id, produs_id)
     DO UPDATE SET metri = EXCLUDED.metri, defecte = EXCLUDED.defecte, material_id = EXCLUDED.material_id,
                   scris_de = utilizator_curent(), scris_la = now()
     RETURNING id`,
    [taiereId, componentaId, produsId, metri, defecte.trim()]);
  return rez.length ? null : 'Culoarea n-are material ales pentru componenta asta, în rețetă.';
}

// ---------------------------------------------------------------- croitul efectiv

export type CroitTaiere = {
  taiereId: string;
  croit: Map<string, Map<string, number>>;   // lot → mărime → bucăți
  motivId: string | null;
  incheie: boolean;
  motivIncheiereId: string | null;
  observatiiIncheiere: string;
};

/**
 * Înregistrează croitul tuturor loturilor deschise ale taierii, într-o singură
 * tranzacție. Metrii scriși pe o culoare se împart pe comenzile de pe culoarea
 * aceea (un PSF și un PSC pe Negru), după bucățile croite de fiecare.
 */
export async function inregistreazaCroitTaiere(d: CroitTaiere): Promise<string | null> {
  return cuOprire(() => caFirma(firmaCurenta(), async (c) => {
    const { rows: deschise } = await c.query<{ id: string; cod: string; produs_id: string }>(
      `SELECT lc.id, cm.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot AS cod, cl.produs_id
         FROM lot_croit lc
         JOIN planificare pl   ON pl.id = lc.planificare_id
         JOIN comanda_linie cl ON cl.id = pl.linie_id
         JOIN comanda cm       ON cm.id = cl.comanda_id
        WHERE lc.taiere_id = $1 AND lc.croit_la IS NULL AND pl.stadiu <> 'anulat'
        FOR UPDATE OF lc`, [d.taiereId]);
    if (deschise.length === 0) return 'Nu mai e nimic de croit în taierea asta.';

    const bucati = (lot: string) => [...(d.croit.get(lot)?.values() ?? [])].reduce((s, q) => s + Math.max(0, q), 0);
    const { rows: masurat } = await c.query<{ produs_id: string; material_id: string; metri: string }>(
      `SELECT produs_id, material_id, sum(metri)::text AS metri FROM taiere_material
        WHERE taiere_id = $1 AND metri IS NOT NULL GROUP BY produs_id, material_id`, [d.taiereId]);

    for (const lot of deschise) {
      const consum = new Map<string, number>();
      const total = deschise.filter((l) => l.produs_id === lot.produs_id).reduce((s, l) => s + bucati(l.id), 0);
      for (const m of masurat.filter((x) => x.produs_id === lot.produs_id)) {
        if (total > 0) consum.set(m.material_id, Number((Number(m.metri) * bucati(lot.id) / total).toFixed(3)));
      }
      await inregistreazaLot(c, {
        lotId: lot.id, croit: d.croit.get(lot.id) ?? new Map(), motivId: d.motivId, consumMasurat: consum,
        incheie: d.incheie, motivIncheiereId: d.motivIncheiereId, observatiiIncheiere: d.observatiiIncheiere,
      }, lot.cod);
    }
    return null;
  }));
}
