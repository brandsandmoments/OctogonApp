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
};

export type Componenta = {
  id: string;
  nume: string;
  tip: 'materie_prima' | 'accesoriu';
  unitate: string;
  consum: string;
  se_croieste: boolean;
};

export type ProdusModel = {
  id: string;
  denumire: string;
  cod_sku: string;
  culoare: string | null;
  materiale: Record<string, string>; // componenta_id → material_id
};

export type DetaliiModel = {
  model: { id: string; cod: string; denumire: string; brand_id: string; brand: string };
  componente: Componenta[];
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
              WHERE p.model_id = mo.id AND pm.material_id IS NULL)::int AS nealocate
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
      `SELECT mo.id, mo.cod, mo.denumire, mo.brand_id, b.nume AS brand
         FROM model mo JOIN brand b ON b.id = mo.brand_id WHERE mo.id = $1`,
      [id],
    );
    if (!model) return null;
    // Una după alta, nu Promise.all: o conexiune execută o singură interogare
    // odată, iar toate stau în aceeași tranzacție (vezi caFirma).
    const componente = await c.query<Componenta>(
      `SELECT id, nume, tip::text AS tip, unitate::text AS unitate, consum::text AS consum, se_croieste
         FROM model_componenta WHERE model_id = $1 ORDER BY ordine, nume`, [id]);
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
      // O materie primă în metri se întinde și se taie, de obicei; se schimbă din rețetă.
      `INSERT INTO model_componenta (firma_id, model_id, nume, tip, unitate, consum, ordine, se_croieste)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5,
               (SELECT coalesce(max(ordine), 0) + 1 FROM model_componenta WHERE model_id = $1),
               $3 = 'materie_prima' AND $4 IN ('m', 'm2'))`,
      [modelId, d.nume.trim(), d.tip, d.unitate, d.consum],
    );
    return null;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return `Componenta „${d.nume.trim()}" există deja.`;
    throw e;
  }
}

/** Consumul pe bucată și dacă se întinde și se taie pe masă (stofă, căptușeală, termo). */
export async function schimbaConsum(componentaId: string, consum: number, seCroieste: boolean): Promise<string | null> {
  if (!(consum > 0)) return 'Consumul trebuie să fie mai mare ca zero.';
  await interogare(
    `UPDATE model_componenta SET consum = $2, se_croieste = $3 AND tip = 'materie_prima' WHERE id = $1`,
    [componentaId, consum, seCroieste]);
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
