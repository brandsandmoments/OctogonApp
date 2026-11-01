import { caFirma } from './db';
import { firmaCurenta, interogare } from './sesiune';

export type Material = {
  id: string;
  tip: 'materie_prima' | 'accesoriu';
  cod: string;
  denumire: string;
  culoare: string | null;
  unitate: string;
  furnizor: string | null;
};

export type ModelRezumat = {
  id: string;
  cod: string;
  denumire: string;
  brand: string;
  produse: number;
  componente: number;
  nealocate: number;
  operatii: number;
  timp_min: string | null;   // minute pe bucată, din procesul tehnologic
  cauta: string;             // denumirile și SKU-urile produselor, pentru căutare
};

export type Operatie = { id: string; ordine: number; denumire: string; utilaj: string | null; timp_min: string; observatii: string | null };

export type Componenta = {
  id: string;
  nume: string;
  tip: 'materie_prima' | 'accesoriu';
  unitate: string;
  consum: string;
};

export type ProdusModel = {
  id: string;
  denumire: string;
  cod_sku: string;
  culoare: string | null;
  materiale: Record<string, string>; // componenta_id → material_id
};

export type DetaliiModel = {
  model: { id: string; cod: string; denumire: string; brand_id: string; brand: string; timp_min_buc: string | null };
  componente: Componenta[];
  operatii: Operatie[];
  produse: ProdusModel[];
  libere: { id: string; denumire: string; cod_sku: string }[];
  materiale: Material[];
};

export const UNITATI = ['m', 'kg', 'buc', 'set', 'm2'] as const;

export async function materiale(): Promise<Material[]> {
  return interogare<Material>(
    `SELECT m.id, m.tip::text AS tip, m.cod, m.denumire, c.nume AS culoare,
            m.unitate::text AS unitate, m.furnizor
       FROM material m LEFT JOIN culoare c ON c.id = m.culoare_id
      WHERE m.activ
      ORDER BY m.tip, m.denumire`,
  );
}

export async function culori(): Promise<{ id: string; nume: string }[]> {
  return interogare(`SELECT id, nume FROM culoare ORDER BY nume`);
}

export async function adaugaMaterial(d: {
  tip: string; cod: string; denumire: string; culoareId: string; unitate: string; furnizor: string;
}): Promise<string | null> {
  if (!d.cod.trim() || !d.denumire.trim()) return 'Codul și denumirea sunt obligatorii.';
  try {
    await interogare(
      `INSERT INTO material (firma_id, tip, cod, denumire, culoare_id, unitate, furnizor)
       VALUES (firma_curenta(), $1, $2, $3, nullif($4, '')::uuid, $5, nullif($6, ''))`,
      [d.tip, d.cod.trim().toUpperCase(), d.denumire.trim(), d.culoareId, d.unitate, d.furnizor.trim()],
    );
    return null;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return `Codul ${d.cod.trim().toUpperCase()} există deja.`;
    throw e;
  }
}

export async function modele(): Promise<ModelRezumat[]> {
  return interogare<ModelRezumat>(
    `SELECT mo.id, mo.cod, mo.denumire, b.nume AS brand,
            (SELECT count(*) FROM produs p WHERE p.model_id = mo.id)::int AS produse,
            (SELECT count(*) FROM model_componenta mc WHERE mc.model_id = mo.id)::int AS componente,
            (SELECT count(*) FROM produs p JOIN model_componenta mc ON mc.model_id = p.model_id
               LEFT JOIN produs_material pm ON pm.produs_id = p.id AND pm.componenta_id = mc.id
              WHERE p.model_id = mo.id AND pm.material_id IS NULL)::int AS nealocate,
            (SELECT count(*) FROM model_operatie o WHERE o.model_id = mo.id)::int AS operatii,
            mo.timp_min_buc::text AS timp_min,
            coalesce((SELECT string_agg(p.denumire || ' ' || p.cod_sku, ' ') FROM produs p WHERE p.model_id = mo.id), '') AS cauta
       FROM model mo JOIN brand b ON b.id = mo.brand_id
      WHERE mo.activ
      ORDER BY b.nume, mo.denumire`,
  );
}

export async function adaugaModel(d: { brandId: string; cod: string; denumire: string }): Promise<string | null> {
  if (!d.brandId || !d.cod.trim() || !d.denumire.trim()) return 'Brandul, codul și denumirea sunt obligatorii.';
  try {
    await interogare(
      `INSERT INTO model (firma_id, brand_id, cod, denumire) VALUES (firma_curenta(), $1, $2, $3)`,
      [d.brandId, d.cod.trim().toLowerCase(), d.denumire.trim()],
    );
    return null;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return `Modelul ${d.cod.trim().toLowerCase()} există deja la brandul ăsta.`;
    throw e;
  }
}

export async function detaliiModel(id: string): Promise<DetaliiModel | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [model] } = await c.query<DetaliiModel['model']>(
      `SELECT mo.id, mo.cod, mo.denumire, mo.brand_id, b.nume AS brand, mo.timp_min_buc::text AS timp_min_buc
         FROM model mo JOIN brand b ON b.id = mo.brand_id WHERE mo.id = $1`,
      [id],
    );
    if (!model) return null;
    // Una după alta, nu Promise.all: o conexiune execută o singură interogare
    // odată, iar toate stau în aceeași tranzacție (vezi caFirma).
    const componente = await c.query<Componenta>(
      `SELECT id, nume, tip::text AS tip, unitate::text AS unitate, consum::text AS consum
         FROM model_componenta WHERE model_id = $1 ORDER BY ordine, nume`, [id]);
    const operatii = await c.query<Operatie>(
      `SELECT id, ordine, denumire, utilaj, timp_min::text AS timp_min, observatii
         FROM model_operatie WHERE model_id = $1 ORDER BY ordine`, [id]);
    const produse = await c.query<Omit<ProdusModel, 'materiale'>>(
      `SELECT p.id, p.denumire, p.cod_sku, cu.nume AS culoare
         FROM produs p LEFT JOIN culoare cu ON cu.id = p.culoare_id
        WHERE p.model_id = $1 ORDER BY p.denumire`, [id]);
    const alocari = await c.query<{ produs_id: string; componenta_id: string; material_id: string }>(
      `SELECT produs_id, componenta_id, material_id FROM produs_material WHERE model_id = $1`, [id]);
    const libere = await c.query<DetaliiModel['libere'][number]>(
      `SELECT id, denumire, cod_sku FROM produs
        WHERE brand_id = $1 AND model_id IS NULL AND activ ORDER BY denumire`, [model.brand_id]);
    const mat = await c.query<Material>(
      `SELECT m.id, m.tip::text AS tip, m.cod, m.denumire, cu.nume AS culoare,
              m.unitate::text AS unitate, m.furnizor
         FROM material m LEFT JOIN culoare cu ON cu.id = m.culoare_id
        WHERE m.activ ORDER BY m.denumire`);
    return {
      model,
      componente: componente.rows,
      operatii: operatii.rows,
      produse: produse.rows.map((p) => ({
        ...p,
        materiale: Object.fromEntries(
          alocari.rows.filter((a) => a.produs_id === p.id).map((a) => [a.componenta_id, a.material_id]),
        ),
      })),
      libere: libere.rows,
      materiale: mat.rows,
    };
  });
}

export async function adaugaComponenta(modelId: string, d: {
  nume: string; tip: string; unitate: string; consum: number;
}): Promise<string | null> {
  if (!d.nume.trim()) return 'Scrie numele componentei.';
  if (!(d.consum > 0)) return 'Consumul trebuie să fie mai mare ca zero.';
  try {
    await interogare(
      `INSERT INTO model_componenta (firma_id, model_id, nume, tip, unitate, consum, ordine)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5,
               (SELECT coalesce(max(ordine), 0) + 1 FROM model_componenta WHERE model_id = $1))`,
      [modelId, d.nume.trim(), d.tip, d.unitate, d.consum],
    );
    return null;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return `Componenta „${d.nume.trim()}" există deja.`;
    throw e;
  }
}

export async function schimbaConsum(componentaId: string, consum: number): Promise<string | null> {
  if (!(consum > 0)) return 'Consumul trebuie să fie mai mare ca zero.';
  await interogare(`UPDATE model_componenta SET consum = $2 WHERE id = $1`, [componentaId, consum]);
  return null;
}

export async function stergeComponenta(componentaId: string): Promise<void> {
  // Alocările de material cad odată cu ea (ON DELETE CASCADE): fără componentă n-au sens.
  await interogare(`DELETE FROM model_componenta WHERE id = $1`, [componentaId]);
}

export async function legaProduse(modelId: string, produse: string[]): Promise<void> {
  if (produse.length === 0) return;
  await interogare(
    `UPDATE produs SET model_id = $1
      WHERE id = ANY($2::uuid[]) AND model_id IS NULL
        AND brand_id = (SELECT brand_id FROM model WHERE id = $1)`,
    [modelId, produse],
  );
}

/**
 * Alocările unui model, toate odată, din grila produse × componente. Tipul și
 * unitatea se copiază din componentă; cheile compuse din 0006 refuză orice
 * material care nu se potrivește, deci o eroare aici e o greșeală de date reală.
 */
export async function salveazaAlocari(
  modelId: string,
  alocari: { produsId: string; componentaId: string; materialId: string }[],
): Promise<void> {
  await caFirma(firmaCurenta(), async (c) => {
    for (const a of alocari) {
      if (!a.materialId) {
        await c.query(`DELETE FROM produs_material WHERE produs_id = $1 AND componenta_id = $2`,
          [a.produsId, a.componentaId]);
        continue;
      }
      await c.query(
        `INSERT INTO produs_material (firma_id, produs_id, model_id, componenta_id, material_id, tip, unitate)
         SELECT firma_curenta(), $1, $2, mc.id, $4, mc.tip, mc.unitate
           FROM model_componenta mc WHERE mc.id = $3
         ON CONFLICT (produs_id, componenta_id) DO UPDATE SET material_id = EXCLUDED.material_id`,
        [a.produsId, modelId, a.componentaId, a.materialId],
      );
    }
  });
}

// ---------------------------------------------------------------- procesul tehnologic

/** Timpul modelului pe bucată ține pasul cu procesul: suma timpilor operațiilor. Fără operații, rămâne cel scris de mână. */
async function recalculeazaTimp(modelId: string) {
  await interogare(
    `UPDATE model SET timp_min_buc = (SELECT sum(timp_min) FROM model_operatie WHERE model_id = $1)
      WHERE id = $1 AND EXISTS (SELECT 1 FROM model_operatie WHERE model_id = $1)`, [modelId]);
}

type OperatieNoua = { denumire: string; utilaj: string; timp: number; observatii: string };

function verifica(d: OperatieNoua): string | null {
  if (!d.denumire.trim()) return 'Scrie denumirea operației.';
  if (!Number.isFinite(d.timp) || d.timp < 0) return 'Timpul e în minute pe bucată, de ex. 2,5.';
  return null;
}

export async function adaugaOperatie(modelId: string, d: OperatieNoua): Promise<string | null> {
  const e = verifica(d);
  if (e) return e;
  await interogare(
    `INSERT INTO model_operatie (firma_id, model_id, ordine, denumire, utilaj, timp_min, observatii)
     VALUES (firma_curenta(), $1, coalesce((SELECT max(ordine) FROM model_operatie WHERE model_id = $1), 0) + 1,
             $2, nullif($3, ''), $4, nullif($5, ''))`,
    [modelId, d.denumire.trim(), d.utilaj.trim(), d.timp, d.observatii.trim()]);
  await recalculeazaTimp(modelId);
  return null;
}

export async function schimbaOperatie(modelId: string, id: string, d: OperatieNoua): Promise<string | null> {
  const e = verifica(d);
  if (e) return e;
  await interogare(
    `UPDATE model_operatie SET denumire = $3, utilaj = nullif($4, ''), timp_min = $5, observatii = nullif($6, '')
      WHERE id = $2 AND model_id = $1`, [modelId, id, d.denumire.trim(), d.utilaj.trim(), d.timp, d.observatii.trim()]);
  await recalculeazaTimp(modelId);
  return null;
}

export async function stergeOperatie(modelId: string, id: string): Promise<void> {
  await caFirma(firmaCurenta(), async (c) => {
    await c.query(`DELETE FROM model_operatie WHERE id = $2 AND model_id = $1`, [modelId, id]);
    // Ordinea rămâne fără găuri: 1, 2, 3…
    await c.query(
      `UPDATE model_operatie o SET ordine = n.r FROM (SELECT id, row_number() OVER (ORDER BY ordine) AS r
          FROM model_operatie WHERE model_id = $1) n WHERE o.id = n.id`, [modelId]);
  });
  await recalculeazaTimp(modelId);
}

/** Mută o operație cu un loc mai sus sau mai jos, schimbând locul cu vecina ei. */
export async function mutaOperatie(modelId: string, id: string, pas: -1 | 1): Promise<void> {
  await caFirma(firmaCurenta(), async (c) => {
    const { rows: [o] } = await c.query<{ ordine: number }>(`SELECT ordine FROM model_operatie WHERE id = $2 AND model_id = $1`, [modelId, id]);
    if (!o) return;
    const { rows: [v] } = await c.query<{ id: string }>(
      `SELECT id FROM model_operatie WHERE model_id = $1 AND ordine = $2`, [modelId, o.ordine + pas]);
    if (!v) return;
    await c.query(`UPDATE model_operatie SET ordine = $2 WHERE id = $1`, [v.id, o.ordine]);
    await c.query(`UPDATE model_operatie SET ordine = $2 WHERE id = $1`, [id, o.ordine + pas]);
  });
}
