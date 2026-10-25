import { caFirma, firmaCurenta, interogare } from './db';
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
};

export type FiltreStoc = { tip?: string; familie?: string; cauta?: string; lipsa?: boolean };

/**
 * Starea fiecărui material, în patru cifre:
 *
 *   stoc          — suma fișei de magazie
 *   rezervat      — ce mai e de croit din planificările active × consum
 *   neplanificat  — ce cer comenzile deschise și încă n-a intrat în planificare × consum
 *   de aprovizionat — (rezervat + neplanificat) cu pierderile firmei, minus stocul
 *
 * Pierderile (parametru: pierderi_tehnologice, defecte_material,
 * neconformitati_productie) se adaugă doar la aprovizionare, nu la rezervare:
 * rezervarea spune cât e promis, aprovizionarea cât trebuie cumpărat ca să ajungă.
 */
export async function listaStoc(f: FiltreStoc): Promise<RandStoc[]> {
  return interogare<RandStoc>(
    `WITH pierderi AS (
         SELECT 1 + coalesce(sum(valoare), 0) AS factor FROM parametru
          WHERE cheie IN ('pierderi_tehnologice', 'defecte_material', 'neconformitati_productie')),
     rezervat AS (
         SELECT material_id, sum(rezervat) AS q FROM rezervare_material GROUP BY material_id),
     planificat AS (
         SELECT pl.linie_id, pc.marime_id, sum(pc.cantitate) AS q
           FROM planificare pl JOIN planificare_cantitate pc ON pc.planificare_id = pl.id
          WHERE pl.stadiu <> 'anulat'
          GROUP BY pl.linie_id, pc.marime_id),
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
            greatest((coalesce(r.q, 0) + coalesce(n.q, 0)) * (SELECT factor FROM pierderi) - s.stoc, 0)
              ::numeric(12,3)::text AS de_aprovizionat
       FROM material m
       JOIN stoc_material s  ON s.material_id = m.id
       LEFT JOIN rezervat r  ON r.material_id = m.id
       LEFT JOIN neplanificat n ON n.material_id = m.id
      WHERE m.activ
        AND ($1::text IS NULL OR m.tip::text = $1)
        AND ($2::text IS NULL OR m.familie = $2)
        AND ($3::text IS NULL OR m.cod ILIKE '%' || $3 || '%' OR m.denumire ILIKE '%' || $3 || '%')
        AND (NOT $4 OR (coalesce(r.q, 0) + coalesce(n.q, 0)) * (SELECT factor FROM pierderi) > s.stoc)
      ORDER BY m.tip, m.denumire`,
    [f.tip || null, f.familie || null, f.cauta?.trim() || null, Boolean(f.lipsa)],
  );
}

export async function familii(): Promise<string[]> {
  return (await interogare<{ familie: string }>(
    `SELECT DISTINCT familie FROM material WHERE familie IS NOT NULL AND activ ORDER BY familie`,
  )).map((r) => r.familie);
}

export async function factorPierderi(): Promise<number> {
  const [r] = await interogare<{ factor: string }>(
    `SELECT (1 + coalesce(sum(valoare), 0))::text AS factor FROM parametru
      WHERE cheie IN ('pierderi_tehnologice', 'defecte_material', 'neconformitati_productie')`,
  );
  return Number(r.factor);
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
              coalesce(lc_ref.ref, 'inventar ' || to_char(i.data, 'YYYY-MM-DD')) AS referinta,
              ms.observatii
         FROM miscare_stoc ms
         LEFT JOIN inventar i ON i.id = ms.inventar_id
         LEFT JOIN LATERAL (
              SELECT c.numar || '/P' || pl.numar_transa || '/C' || lc.numar_lot AS ref
                FROM lot_croit lc JOIN planificare pl ON pl.id = lc.planificare_id
                JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN comanda c ON c.id = cl.comanda_id
               WHERE lc.id = ms.lot_id) lc_ref ON true
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

export type IntrareNoua = {
  materialId: string;
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
  if (!m.materialId) return 'Alege materialul.';
  if (!(m.cantitate > 0)) return 'Cantitatea trebuie să fie mai mare ca zero.';
  if (m.tip === 'intrare' && !m.furnizor.trim()) return 'Scrie furnizorul.';
  return caFirma(firmaCurenta(), async (c) => {
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
    return null;
  });
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
    await c.query(`UPDATE inventar SET inchis_la = now() WHERE id = $1`, [id]);
    return null;
  });
}
