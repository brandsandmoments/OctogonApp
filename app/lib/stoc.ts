import { caFirma } from './db';
import { firmaCurenta, interogare } from './sesiune';
import { cantitate } from './format';

export type RandStoc = {
  id: string;
  tip: 'materie_prima' | 'accesoriu';
  cod: string;
  denumire: string;
  familie: string | null;
  unitate: string;
  stoc: string;
  rezervat: string;
  neplanificat: string;
  de_aprovizionat: string;
  pe_modele: string;       // ce rămâne pus deoparte pentru modele (rezervare_model, minus consumul lor)
};

export type FiltreStoc = { tip?: string; familie?: string; cauta?: string; lipsa?: boolean };

/**
 * Starea fiecărui material, în patru cifre:
 *
 *   stoc          — suma fișei de magazie
 *   rezervat      — ce mai e de croit din planificările active × consum
 *   neplanificat  — ce cer comenzile deschise și încă n-a intrat în planificare × consum
 *   de aprovizionat — rezervat + neplanificat, minus stocul
 */
/**
 * Rezervările pe modele, cu ce a rămas din fiecare: cantitatea pusă deoparte minus ce s-a consumat
 * la croit din materialul ăla pe produsele modelului, de la rezervare încoace.
 */
const REZERVARI_MODEL = `
  SELECT rm.id, rm.material_id, rm.model_id, rm.cantitate, rm.observatii, rm.creat_la, rm.creat_de,
         coalesce((SELECT -sum(ms.cantitate) FROM miscare_stoc ms
                     JOIN lot_croit lc ON lc.id = ms.lot_id JOIN planificare pl ON pl.id = lc.planificare_id
                     JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN produs p ON p.id = cl.produs_id
                    WHERE ms.material_id = rm.material_id AND ms.tip = 'consum_croit' AND p.model_id = rm.model_id
                      AND ms.creat_la >= rm.creat_la), 0) AS consumat,
         greatest(rm.cantitate - coalesce((SELECT -sum(ms.cantitate) FROM miscare_stoc ms
                     JOIN lot_croit lc ON lc.id = ms.lot_id JOIN planificare pl ON pl.id = lc.planificare_id
                     JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN produs p ON p.id = cl.produs_id
                    WHERE ms.material_id = rm.material_id AND ms.tip = 'consum_croit' AND p.model_id = rm.model_id
                      AND ms.creat_la >= rm.creat_la), 0), 0) AS ramas
    FROM rezervare_model rm`;

export async function listaStoc(f: FiltreStoc): Promise<RandStoc[]> {
  return interogare<RandStoc>(
    `WITH rezervat AS (
         SELECT material_id, sum(rezervat) AS q FROM rezervare_material GROUP BY material_id),
     pe_modele AS (
         SELECT material_id, sum(ramas) AS q FROM (${REZERVARI_MODEL}) x GROUP BY material_id),
     planificat AS (
         SELECT linie_id, marime_id, cantitate AS q FROM planificat_pe_pozitie),
     neplanificat AS (
         SELECT pm.material_id,
                sum(greatest(cc.cantitate - coalesce(p.q, 0), 0) * mc.consum) AS q
           FROM comanda c
           JOIN comanda_linie cl     ON cl.comanda_id = c.id
           JOIN comanda_cantitate cc ON cc.linie_id = cl.id
           LEFT JOIN planificat p    ON p.linie_id = cl.id AND p.marime_id = cc.marime_id
           JOIN produs_material pm   ON pm.produs_id = cl.produs_id
           JOIN model_componenta mc  ON mc.id = pm.componenta_id
          WHERE c.stare IN ('lansata', 'in_productie')
          GROUP BY pm.material_id)
     SELECT m.id, m.tip::text AS tip, m.cod, m.denumire, m.familie, m.unitate::text AS unitate,
            s.stoc::text AS stoc,
            coalesce(r.q, 0)::numeric(12,3)::text AS rezervat,
            coalesce(n.q, 0)::numeric(12,3)::text AS neplanificat,
            greatest(coalesce(r.q, 0) + coalesce(n.q, 0) - s.stoc, 0)
              ::numeric(12,3)::text AS de_aprovizionat,
            coalesce(pm.q, 0)::numeric(12,3)::text AS pe_modele
       FROM material m
       JOIN stoc_material s  ON s.material_id = m.id
       LEFT JOIN rezervat r  ON r.material_id = m.id
       LEFT JOIN neplanificat n ON n.material_id = m.id
       LEFT JOIN pe_modele pm ON pm.material_id = m.id
      WHERE m.activ
        AND ($1::text IS NULL OR m.tip::text = $1)
        AND ($2::text IS NULL OR m.familie = $2)
        AND ($3::text IS NULL OR m.cod ILIKE '%' || $3 || '%' OR m.denumire ILIKE '%' || $3 || '%')
        AND (NOT $4 OR coalesce(r.q, 0) + coalesce(n.q, 0) > s.stoc)
      ORDER BY m.tip, m.denumire`,
    [f.tip || null, f.familie || null, f.cauta?.trim() || null, Boolean(f.lipsa)],
  );
}

export async function familii(): Promise<string[]> {
  return (await interogare<{ familie: string }>(
    `SELECT DISTINCT familie FROM material WHERE familie IS NOT NULL AND activ ORDER BY familie`,
  )).map((r) => r.familie);
}

// ---------------------------------------------------------------- fișa unui material

export type Miscare = {
  id: string;
  data: string;
  tip: string;
  cantitate: string;
  sold: string;
  furnizor: string | null;
  document: string | null;
  pret_unitar: string | null;
  referinta: string | null;
  observatii: string | null;
};

export type Rezervare = { planificare: string; comanda: string; produs: string; rezervat: string };

export type FisaMaterial = {
  material: { id: string; tip: string; cod: string; denumire: string; familie: string | null;
              unitate: string; furnizor: string | null; pret_referinta: string | null };
  stoc: string;
  miscari: Miscare[];
  rezervari: Rezervare[];
};

/** Fișa de magazie: fiecare mișcare cu soldul de după ea, cea mai nouă sus. */
export async function fisaMaterial(id: string): Promise<FisaMaterial | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [material] } = await c.query<FisaMaterial['material']>(
      `SELECT id, tip::text AS tip, cod, denumire, familie, unitate::text AS unitate, furnizor,
              pret_referinta::text AS pret_referinta
         FROM material WHERE id = $1`, [id]);
    if (!material) return null;
    const { rows: [{ stoc }] } = await c.query<{ stoc: string }>(
      `SELECT stoc::text FROM stoc_material WHERE material_id = $1`, [id]);
    const { rows: miscari } = await c.query<Miscare>(
      `SELECT ms.id, to_char(ms.data, 'YYYY-MM-DD') AS data, ms.tip::text AS tip,
              ms.cantitate::text AS cantitate,
              (sum(ms.cantitate) OVER (ORDER BY ms.data, ms.creat_la, ms.id))::numeric(12,3)::text AS sold,
              ms.furnizor, ms.document, ms.pret_unitar::text AS pret_unitar,
              coalesce(lc_ref.ref, ab_ref.ref, 'inventar ' || to_char(i.data, 'YYYY-MM-DD')) AS referinta,
              ms.observatii
         FROM miscare_stoc ms
         LEFT JOIN inventar i ON i.id = ms.inventar_id
         LEFT JOIN LATERAL (
              SELECT c.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot AS ref
                FROM lot_croit lc JOIN planificare pl ON pl.id = lc.planificare_id
                JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN comanda c ON c.id = cl.comanda_id
               WHERE lc.id = ms.lot_id) lc_ref ON true
         LEFT JOIN LATERAL (
              SELECT c.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot || '/B' || ab.numar AS ref
                FROM alimentare_banda ab JOIN lot_croit lc ON lc.id = ab.lot_id
                JOIN planificare pl ON pl.id = lc.planificare_id
                JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN comanda c ON c.id = cl.comanda_id
               WHERE ab.id = ms.alimentare_id) ab_ref ON true
        WHERE ms.material_id = $1
        ORDER BY ms.data DESC, ms.creat_la DESC, ms.id DESC`, [id]);
    const { rows: rezervari } = await c.query<Rezervare>(
      `SELECT c.numar || '/P' || pl.numar_transa AS planificare, c.numar AS comanda,
              p.denumire AS produs, r.rezervat::text AS rezervat
         FROM rezervare_material r
         JOIN planificare pl   ON pl.id = r.planificare_id
         JOIN comanda_linie cl ON cl.id = pl.linie_id
         JOIN comanda c        ON c.id = cl.comanda_id
         JOIN produs p         ON p.id = cl.produs_id
        WHERE r.material_id = $1
        ORDER BY c.numar, pl.numar_transa`, [id]);
    return { material, stoc, miscari, rezervari };
  });
}

/** Un material scris de mână la intrare, când nu e în listă: se creează odată cu intrarea. */
export type MaterialNou = { tip: 'materie_prima' | 'accesoriu'; familie: string; culoare: string; unitate: string };

export type IntrareNoua = {
  materialId: string;
  nou?: MaterialNou;
  // Pus deoparte pentru un model, din cantitatea intrată (toată, dacă nu se spune alta).
  rezervaModelId?: string;
  rezervaCantitate?: number | null;
  tip: 'intrare' | 'iesire' | 'retur_furnizor';
  cantitate: number;
  data: string;
  furnizor: string;
  document: string;
  pret: number | null;
  observatii: string;
};

/**
 * O intrare de la furnizor, o ieșire sau un retur. Cantitatea se scrie pozitiv de
 * către om; semnul îl pune aplicația după tip, iar baza verifică (miscare_stoc_semn).
 * O ieșire mai mare decât stocul e refuzată: stocul negativ înseamnă că lipsește
 * o intrare, și e mai ușor de găsit acum decât la inventar.
 */
export async function adaugaMiscare(m: IntrareNoua): Promise<string | null> {
  const nou = m.tip === 'intrare' && !m.materialId && m.nou && (m.nou.familie.trim() || m.nou.culoare.trim()) ? m.nou : null;
  if (!m.materialId && !nou) return 'Alege materialul (sau scrie unul nou: familia și culoarea).';
  if (!(m.cantitate > 0)) return 'Cantitatea trebuie să fie mai mare ca zero.';
  if (m.tip === 'intrare' && !m.furnizor.trim()) return 'Scrie furnizorul.';
  if (m.rezervaModelId && m.rezervaCantitate != null && !(m.rezervaCantitate > 0)) return 'Cantitatea pusă deoparte trebuie să fie mai mare ca zero.';
  if (m.rezervaModelId && (m.rezervaCantitate ?? m.cantitate) > m.cantitate) return 'Nu se poate pune deoparte mai mult decât a intrat.';
  return caFirma(firmaCurenta(), async (c) => {
    if (nou) m.materialId = await creeazaMaterial(c, nou);
    if (m.tip !== 'intrare') {
      // Blocăm materialul cât verificăm stocul, ca două ieșiri simultane să nu treacă amândouă.
      await c.query(`SELECT 1 FROM material WHERE id = $1 FOR UPDATE`, [m.materialId]);
      const { rows: [{ stoc }] } = await c.query<{ stoc: string }>(
        `SELECT stoc::text FROM stoc_material WHERE material_id = $1`, [m.materialId]);
      if (Number(stoc) < m.cantitate) return `În stoc sunt doar ${cantitate(stoc)}. Nu poate ieși mai mult.`;
    }
    await c.query(
      `INSERT INTO miscare_stoc (firma_id, material_id, tip, cantitate, data, furnizor, document, pret_unitar, observatii)
       VALUES (firma_curenta(), $1, $2, $3, coalesce(nullif($4, '')::date, CURRENT_DATE),
               nullif($5, ''), nullif($6, ''), $7, nullif($8, ''))`,
      [m.materialId, m.tip, m.tip === 'intrare' ? m.cantitate : -m.cantitate, m.data,
       m.furnizor.trim(), m.document.trim(), m.pret, m.observatii.trim()],
    );
    if (m.tip === 'intrare' && m.rezervaModelId) {
      await c.query(
        `INSERT INTO rezervare_model (firma_id, material_id, model_id, cantitate, observatii) VALUES (firma_curenta(), $1, $2, $3, $4)`,
        [m.materialId, m.rezervaModelId, m.rezervaCantitate ?? m.cantitate, `la intrarea din ${m.data || 'azi'}${m.document.trim() ? `, ${m.document.trim()}` : ''}`]);
    }
    return null;
  });
}

const slugCod = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Creează materialul scris de mână, după obiceiul nomenclatorului: denumirea „FAMILIE · CULOARE",
 * codul MP- (materie primă) sau AC- (accesoriu) cu familia și culoarea, culoarea din nomenclator.
 */
async function creeazaMaterial(c: import('pg').PoolClient, n: MaterialNou): Promise<string> {
  const familie = n.familie.trim().replace(/\s+/g, ' ');
  const culoare = n.culoare.trim().replace(/\s+/g, ' ');
  const denumire = [familie.toUpperCase(), culoare.toUpperCase()].filter(Boolean).join(' · ');
  const { rows: [existent] } = await c.query<{ id: string }>(`SELECT id FROM material WHERE lower(denumire) = lower($1) AND tip = $2 LIMIT 1`, [denumire, n.tip]);
  if (existent) return existent.id;
  const baza = `${n.tip === 'accesoriu' ? 'AC' : 'MP'}-${slugCod([familie, culoare].filter(Boolean).join(' '))}`.slice(0, 50);
  const { rows: [{ cod }] } = await c.query<{ cod: string }>(
    `SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM material WHERE cod = $1) THEN $1
                 ELSE $1 || '-' || (SELECT count(*) + 1 FROM material WHERE cod LIKE $1 || '%') END AS cod`, [baza]);
  let culoareId: string | null = null;
  if (culoare) {
    culoareId = (await c.query<{ id: string }>(`SELECT id FROM culoare WHERE lower(nume) = lower($1) LIMIT 1`, [culoare])).rows[0]?.id
      ?? (await c.query<{ id: string }>(`INSERT INTO culoare (firma_id, nume) VALUES (firma_curenta(), $1) RETURNING id`, [culoare])).rows[0].id;
  }
  const unitate = ['m', 'kg', 'buc', 'set', 'm2'].includes(n.unitate) ? n.unitate : 'm';
  const { rows: [mat] } = await c.query<{ id: string }>(
    `INSERT INTO material (firma_id, tip, cod, denumire, culoare_id, unitate, familie)
     VALUES (firma_curenta(), $1, $2, $3, $4, $5, nullif($6, '')) RETURNING id`,
    [n.tip, cod, denumire, culoareId, unitate, familie]);
  return mat.id;
}

export type RezervareModel = { id: string; model: string; brand: string; cantitate: number; consumat: number; ramas: number; observatii: string | null; creat_la: string; creat_de: string | null };

/** Rezervările pe modele ale unui material, cu ce s-a consumat și ce a rămas pus deoparte. */
export async function rezervariMaterial(materialId: string): Promise<RezervareModel[]> {
  return interogare<RezervareModel>(
    `SELECT r.id, mo.denumire AS model, b.nume AS brand, r.cantitate::float AS cantitate, r.consumat::float AS consumat, r.ramas::float AS ramas,
            r.observatii, to_char(r.creat_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM.YYYY') AS creat_la, u.nume AS creat_de
       FROM (${REZERVARI_MODEL}) r JOIN model mo ON mo.id = r.model_id JOIN brand b ON b.id = mo.brand_id
       LEFT JOIN utilizator u ON u.id = r.creat_de
      WHERE r.material_id = $1 ORDER BY r.creat_la DESC`, [materialId]);
}

/** Pune deoparte, din stocul materialului, o cantitate pentru un model (cât e liber în stoc). */
export async function rezervaPentruModel(materialId: string, modelId: string, q: number, observatii: string): Promise<string | null> {
  if (!modelId) return 'Alege modelul.';
  if (!(q > 0)) return 'Cantitatea trebuie să fie mai mare ca zero.';
  return caFirma(firmaCurenta(), async (c) => {
    await c.query(`SELECT 1 FROM material WHERE id = $1 FOR UPDATE`, [materialId]);
    const { rows: [{ stoc, pus }] } = await c.query<{ stoc: number; pus: number }>(
      `SELECT (SELECT stoc FROM stoc_material WHERE material_id = $1)::float AS stoc,
              coalesce((SELECT sum(ramas) FROM (${REZERVARI_MODEL}) x WHERE x.material_id = $1), 0)::float AS pus`, [materialId]);
    if (q > stoc - pus) return `Liber în stoc sunt doar ${cantitate(String(Math.max(stoc - pus, 0)))}: restul e deja pus deoparte pentru alte modele.`;
    await c.query(`INSERT INTO rezervare_model (firma_id, material_id, model_id, cantitate, observatii) VALUES (firma_curenta(), $1, $2, $3, nullif($4, ''))`,
      [materialId, modelId, q, observatii.trim()]);
    return null;
  });
}

export async function stergeRezervareModel(id: string): Promise<void> {
  await interogare(`DELETE FROM rezervare_model WHERE id = $1`, [id]);
}

/** Modelele, cu brandul, pentru alegerea celui pentru care se pune deoparte materialul. */
export async function modelePentruRezervare(): Promise<{ id: string; nume: string }[]> {
  return interogare<{ id: string; nume: string }>(
    `SELECT mo.id, b.nume || ' · ' || mo.denumire AS nume FROM model mo JOIN brand b ON b.id = mo.brand_id WHERE mo.activ ORDER BY b.nume, mo.denumire`);
}

export async function materialeSelect(): Promise<{ id: string; tip: string; cod: string; denumire: string; unitate: string }[]> {
  return interogare(
    `SELECT id, tip::text AS tip, cod, denumire, unitate::text AS unitate
       FROM material WHERE activ ORDER BY tip, denumire`,
  );
}

// ---------------------------------------------------------------- inventar

export type InventarRezumat = {
  id: string; data: string; descriere: string | null; inchis: boolean; linii: number; diferente: number;
};

export async function inventare(): Promise<InventarRezumat[]> {
  return interogare<InventarRezumat>(
    `SELECT i.id, to_char(i.data, 'YYYY-MM-DD') AS data, i.descriere, i.inchis_la IS NOT NULL AS inchis,
            (SELECT count(*) FROM inventar_linie il WHERE il.inventar_id = i.id)::int AS linii,
            (SELECT count(*) FROM miscare_stoc ms WHERE ms.inventar_id = i.id)::int AS diferente
       FROM inventar i ORDER BY i.deschis_la DESC`,
  );
}

export async function deschideInventar(descriere: string): Promise<string> {
  const [r] = await interogare<{ id: string }>(
    `INSERT INTO inventar (firma_id, descriere) VALUES (firma_curenta(), nullif($1, '')) RETURNING id`,
    [descriere.trim()],
  );
  return r.id;
}

export type LinieInventar = {
  material_id: string; tip: string; cod: string; denumire: string; familie: string | null; unitate: string;
  scriptic: string; numarat: string | null; scriptic_la_inchidere: string | null;
};

export type DetaliiInventar = {
  inventar: { id: string; data: string; descriere: string | null; inchis: boolean };
  linii: LinieInventar[];
};

/**
 * Lista de numărare: toate materialele active, cu stocul scriptic de acum și ce
 * s-a numărat. Pe un inventar închis, scripticul arătat e cel de la închidere —
 * cel față de care s-a calculat diferența.
 */
export async function detaliiInventar(id: string, familie?: string): Promise<DetaliiInventar | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [inventar] } = await c.query<DetaliiInventar['inventar']>(
      `SELECT id, to_char(data, 'YYYY-MM-DD') AS data, descriere, inchis_la IS NOT NULL AS inchis
         FROM inventar WHERE id = $1`, [id]);
    if (!inventar) return null;
    const { rows: linii } = await c.query<LinieInventar>(
      `SELECT m.id AS material_id, m.tip::text AS tip, m.cod, m.denumire, m.familie, m.unitate::text AS unitate,
              s.stoc::text AS scriptic, il.cantitate_numarata::text AS numarat,
              il.stoc_scriptic::text AS scriptic_la_inchidere
         FROM material m
         JOIN stoc_material s ON s.material_id = m.id
         LEFT JOIN inventar_linie il ON il.material_id = m.id AND il.inventar_id = $1
        WHERE (m.activ OR il.material_id IS NOT NULL)
          AND ($2::text IS NULL OR m.familie = $2)
          AND (NOT $3 OR il.material_id IS NOT NULL)
        ORDER BY m.tip, m.familie NULLS LAST, m.denumire`,
      [id, familie || null, inventar.inchis]);
    return { inventar, linii };
  });
}

/**
 * Salvează numărătorile. Un câmp gol înseamnă „nenumărat", nu zero: un inventar
 * parțial (doar stofele, doar raftul 3) nu trebuie să golească restul stocului.
 */
export async function salveazaNumaratori(id: string, numaratori: Map<string, string>): Promise<string | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [inv] } = await c.query<{ inchis: boolean }>(
      `SELECT inchis_la IS NOT NULL AS inchis FROM inventar WHERE id = $1 FOR UPDATE`, [id]);
    if (!inv) return 'Inventarul nu există.';
    if (inv.inchis) return 'Inventarul e închis; numărătorile nu se mai schimbă.';
    for (const [materialId, brut] of numaratori) {
      const t = brut.trim().replace(',', '.');
      if (t === '') {
        await c.query(`DELETE FROM inventar_linie WHERE inventar_id = $1 AND material_id = $2`, [id, materialId]);
        continue;
      }
      const q = Number(t);
      if (!Number.isFinite(q) || q < 0) return `Cantitate nevalidă: „${brut}".`;
      await c.query(
        `INSERT INTO inventar_linie (firma_id, inventar_id, material_id, cantitate_numarata)
         VALUES (firma_curenta(), $1, $2, $3)
         ON CONFLICT (inventar_id, material_id)
         DO UPDATE SET cantitate_numarata = EXCLUDED.cantitate_numarata, numarat_la = now()`,
        [id, materialId, q]);
    }
    return null;
  });
}

/**
 * Închide inventarul: pentru fiecare material numărat, diferența dintre ce s-a
 * numărat și fișa de magazie de acum devine o mișcare de ajustare. Scripticul se
 * citește la închidere, sub blocare, ca o intrare înregistrată în timpul numărării
 * să nu fie ștearsă de ajustare. După închidere nimic nu se mai schimbă.
 */
export async function inchideInventar(id: string): Promise<string | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [inv] } = await c.query<{ inchis: boolean; data: string }>(
      `SELECT inchis_la IS NOT NULL AS inchis, data::text FROM inventar WHERE id = $1 FOR UPDATE`, [id]);
    if (!inv) return 'Inventarul nu există.';
    if (inv.inchis) return 'Inventarul e deja închis.';
    const { rows: linii } = await c.query<{ material_id: string; numarat: string }>(
      `SELECT material_id, cantitate_numarata::text AS numarat FROM inventar_linie WHERE inventar_id = $1`, [id]);
    if (linii.length === 0) return 'Nu s-a numărat nimic.';
    await c.query(
      `SELECT 1 FROM material WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [linii.map((l) => l.material_id)]);
    for (const l of linii) {
      const { rows: [{ stoc }] } = await c.query<{ stoc: string }>(
        `SELECT stoc::text FROM stoc_material WHERE material_id = $1`, [l.material_id]);
      await c.query(
        `UPDATE inventar_linie SET stoc_scriptic = $3 WHERE inventar_id = $1 AND material_id = $2`,
        [id, l.material_id, stoc]);
      const diferenta = Number((Number(l.numarat) - Number(stoc)).toFixed(3));
      if (diferenta !== 0) {
        await c.query(
          `INSERT INTO miscare_stoc (firma_id, material_id, tip, cantitate, data, inventar_id)
           VALUES (firma_curenta(), $1, 'ajustare_inventar', $2, $3, $4)`,
          [l.material_id, diferenta, inv.data, id]);
      }
    }
    await c.query(`UPDATE inventar SET inchis_la = now(), inchis_de = utilizator_curent() WHERE id = $1`, [id]);
    return null;
  });
}

// ---------------------------------------------------------------- lista de cumpărături

export type DeCumparat = RandStoc & { furnizor: string | null; pret: string | null; produse: string[] };

/**
 * Ce trebuie cumpărat ca să ajungă stocul pentru tot ce e planificat și tot ce
 * cer comenzile deschise, pe furnizori. Unde materialul n-are furnizor, rămâne
 * tipul lui, denumirea și produsele care îl cer — cu ele se caută unul.
 */
export async function listaCumparaturi(): Promise<DeCumparat[]> {
  const lipsa = await listaStoc({ lipsa: true });
  if (lipsa.length === 0) return [];
  const extra = await interogare<{ id: string; furnizor: string | null; pret: string | null; produse: string[] }>(
    `SELECT m.id, m.furnizor, m.pret_referinta::text AS pret,
            coalesce((SELECT array_agg(DISTINCT p.denumire ORDER BY p.denumire)
                        FROM produs_material pm
                        JOIN produs p         ON p.id = pm.produs_id
                        JOIN comanda_linie cl ON cl.produs_id = p.id
                        JOIN comanda c        ON c.id = cl.comanda_id AND c.stare IN ('lansata', 'in_productie')
                       WHERE pm.material_id = m.id), '{}') AS produse
       FROM material m WHERE m.id = ANY ($1::uuid[])`, [lipsa.map((r) => r.id)]);
  const pe = new Map(extra.map((x) => [x.id, x]));
  return lipsa.map((r) => ({ ...r, furnizor: pe.get(r.id)?.furnizor ?? null, pret: pe.get(r.id)?.pret ?? null,
                             produse: pe.get(r.id)?.produse ?? [] }));
}
