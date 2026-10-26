import { esteAdmin, poate } from './acces';
import { caFirma } from './db';
import { cere, firmaCurenta, interogare } from './sesiune';

/**
 * Dezvoltarea de produs: cererea de tipar (marketing, KAM), drumul ei prin
 * atelierul de tipare (pași, în ordine) și aprobarea mostrei de KAM-ul care a
 * cerut-o. La aprobare, modelul intră în catalog cu culorile lui.
 */

export const STARI: Record<string, string> = {
  de_facut: 'de făcut', inceput: 'în lucru', proba: 'la probă', corecturi: 'corecturi',
  tipar_gata: 'tipar gata', mostra_gata: 'mostră gata — de aprobat', aprobat: 'aprobat', anulat: 'anulat',
};
export const PASI: Record<string, string> = {
  inceput: 'Început', proba: 'Probă', corecturi: 'Corecturi', tipar_gata: 'Tipar gata',
  mostra_gata: 'Mostră gata', fisa_gata: 'Fișă de produs', aprobat: 'Aprobat', anulat: 'Anulat',
};
export const TIPURI: Record<string, string> = {
  tipar_nou: 'Tipar nou', modificare_tipar: 'Modificare tipar', gradare_marimi: 'Gradare mărimi', variatie_model: 'Variație model',
};

export const SECTIUNI = {
  de_facut: { nume: 'Tipare de făcut', stari: ['de_facut'] },
  in_lucru: { nume: 'În lucru', stari: ['inceput', 'proba', 'corecturi', 'tipar_gata'] },
  mostre: { nume: 'Mostre gata', stari: ['mostra_gata'] },
  aprobate: { nume: 'Aprobate', stari: ['aprobat'] },
} as const;
export type Sectiune = keyof typeof SECTIUNI;

export type RandDezvoltare = {
  id: string; model: string; brand: string; categorie: string | null; culori: string[]; tip: string;
  prioritate: number; termen: string | null; intarziat: boolean; kam: string | null; stare: string;
  ultimul_pas_la: string | null; marimi: string | null; fisa_gata: boolean;
};

const SELECT = `
  SELECT d.id, d.model, b.nume AS brand, k.nume AS categorie, d.culori, d.tip::text AS tip, d.prioritate,
         to_char(d.termen, 'YYYY-MM-DD') AS termen,
         d.termen < CURRENT_DATE AND s.stare NOT IN ('aprobat', 'anulat', 'mostra_gata') AS intarziat,
         u.nume AS kam, s.stare, to_char(s.ultimul_pas_la, 'YYYY-MM-DD') AS ultimul_pas_la,
         CASE WHEN d.marime_de_la IS NOT NULL THEN m1.cod || ' – ' || m2.cod END AS marimi,
         coalesce(s.fisa_gata, false) AS fisa_gata
    FROM dezvoltare d
    JOIN dezvoltare_stare s ON s.dezvoltare_id = d.id
    JOIN brand b ON b.id = d.brand_id
    LEFT JOIN categorie k ON k.id = d.categorie_id
    LEFT JOIN utilizator u ON u.id = d.kam_id
    LEFT JOIN marime m1 ON m1.id = d.marime_de_la
    LEFT JOIN marime m2 ON m2.id = d.marime_pana_la`;

export async function lista(sectiune: Sectiune): Promise<RandDezvoltare[]> {
  return interogare<RandDezvoltare>(
    `${SELECT} WHERE s.stare = ANY($1)
      ORDER BY d.prioritate, d.termen NULLS LAST, b.nume, d.model`, [[...SECTIUNI[sectiune].stari]]);
}

export async function numarePeSectiuni(): Promise<Record<string, number>> {
  const r = await interogare<{ stare: string; n: number }>(
    `SELECT stare, count(*)::int AS n FROM dezvoltare_stare GROUP BY stare`);
  const pe = Object.fromEntries(r.map((x) => [x.stare, x.n]));
  return Object.fromEntries(Object.entries(SECTIUNI).map(([k, v]) => [k, v.stari.reduce((s, st) => s + (pe[st] ?? 0), 0)]));
}

export type Detalii = RandDezvoltare & {
  brand_id: string; categorie_id: string | null; marime_de_la: string | null; marime_pana_la: string | null;
  kam_id: string | null; link_poze: string | null; link_fisa: string | null; observatii: string | null;
  model_id: string | null; tipar_gata: boolean; mostra_gata: boolean;
  pasi: { pas: string; la: string; de: string | null; observatii: string | null }[];
};

export async function detalii(id: string): Promise<Detalii | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [d] } = await c.query<Detalii>(
      `${SELECT.replace('SELECT d.id,', `SELECT d.id, d.brand_id, d.categorie_id, d.marime_de_la, d.marime_pana_la, d.kam_id,
              d.link_poze, d.link_fisa, d.observatii, d.model_id,
              coalesce(s.tipar_gata, false) AS tipar_gata, coalesce(s.mostra_gata, false) AS mostra_gata,`)}
        WHERE d.id = $1`, [id]);
    if (!d) return null;
    const { rows: pasi } = await c.query<Detalii['pasi'][number]>(
      `SELECT p.pas::text AS pas, to_char(p.la, 'YYYY-MM-DD HH24:MI') AS la, u.nume AS de, p.observatii
         FROM dezvoltare_pas p LEFT JOIN utilizator u ON u.id = p.de
        WHERE p.dezvoltare_id = $1 ORDER BY p.la DESC, p.id`, [id]);
    return { ...d, pasi };
  });
}

export type Cerere = {
  brandId: string; model: string; culori: string; categorieId: string; tip: string;
  marimeDeLa: string; marimePanaLa: string; prioritate: number; termen: string; kamId: string;
  linkPoze: string; linkFisa: string; observatii: string;
};

const culoriDinText = (t: string) => t.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

/** Cine poate crea o cerere: dezvoltarea de produs, sau un KAM (cine dă PSF-uri). */
async function cerePentruCerere() {
  const u = await cere(['dezvoltare', 'comenzi'], 'vede');
  if (!poate(u, 'dezvoltare', 'modifica') && !poate(u, 'comenzi', 'modifica')) {
    return { u, eroare: 'Cererile de tipar le fac dezvoltarea de produs și KAM-ii.' };
  }
  return { u, eroare: null };
}

export async function creeaza(d: Cerere): Promise<{ id: string } | { eroare: string }> {
  const { u, eroare } = await cerePentruCerere();
  if (eroare) return { eroare };
  if (!d.brandId || !d.model.trim()) return { eroare: 'Brandul și modelul sunt obligatorii.' };
  try {
    const [r] = await interogare<{ id: string }>(
      `INSERT INTO dezvoltare (firma_id, brand_id, model, culori, categorie_id, tip, marime_de_la, marime_pana_la,
                               prioritate, termen, kam_id, link_poze, link_fisa, observatii)
       VALUES (firma_curenta(), $1, $2, $3, nullif($4, '')::uuid, $5, nullif($6, '')::uuid, nullif($7, '')::uuid,
               $8, nullif($9, '')::date, coalesce(nullif($10, '')::uuid, $14), nullif($11, ''), nullif($12, ''), nullif($13, ''))
       RETURNING id`,
      [d.brandId, d.model.trim(), culoriDinText(d.culori), d.categorieId, d.tip || 'tipar_nou', d.marimeDeLa, d.marimePanaLa,
       d.prioritate || 3, d.termen, d.kamId, d.linkPoze.trim(), d.linkFisa.trim(), d.observatii.trim(),
       // Fără KAM ales, cererea e a celui care o face, dacă e KAM: el va aproba mostra.
       u.roluri.includes('kam') ? u.id : null]);
    return { id: r.id };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return { eroare: `Modelul „${d.model.trim()}" există deja la brandul ăsta.` };
    throw e;
  }
}

export async function actualizeaza(id: string, d: Cerere): Promise<string | null> {
  await cere('dezvoltare', 'modifica');
  try {
    await interogare(
      `UPDATE dezvoltare SET brand_id = $2, model = $3, culori = $4, categorie_id = nullif($5, '')::uuid, tip = $6,
              marime_de_la = nullif($7, '')::uuid, marime_pana_la = nullif($8, '')::uuid, prioritate = $9,
              termen = nullif($10, '')::date, kam_id = nullif($11, '')::uuid, link_poze = nullif($12, ''),
              link_fisa = nullif($13, ''), observatii = nullif($14, '')
        WHERE id = $1`,
      [id, d.brandId, d.model.trim(), culoriDinText(d.culori), d.categorieId, d.tip, d.marimeDeLa, d.marimePanaLa,
       d.prioritate, d.termen, d.kamId, d.linkPoze.trim(), d.linkFisa.trim(), d.observatii.trim()]);
    return null;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return 'Modelul există deja la brandul ăsta.';
    throw e;
  }
}

/**
 * Pașii de lucru, în ordine: nu există probă fără început, nici mostră fără tipar.
 * Corecturile pot veni oricând după început și cer motivul; după mostră, le poate
 * cere și KAM-ul care aprobă. Un model aprobat sau anulat nu mai primește pași.
 */
export async function adaugaPas(id: string, pas: string, observatii: string): Promise<string | null> {
  const u = await cere(['dezvoltare', 'comenzi'], 'vede');
  const d = await detalii(id);
  if (!d) return 'Nu există.';
  const atelier = poate(u, 'dezvoltare', 'modifica');
  const kamulEi = esteAdmin(u) || d.kam_id === u.id;
  if (['aprobat', 'anulat'].includes(d.stare)) return 'Modelul e închis; nu mai primește pași.';
  const inceput = d.stare !== 'de_facut';
  const reguli: Record<string, [boolean, string]> = {
    inceput: [atelier && !inceput, 'Lucrul a început deja.'],
    proba: [atelier && inceput, 'Proba vine după început.'],
    tipar_gata: [atelier && inceput, 'Tiparul e gata după ce a început.'],
    mostra_gata: [atelier && d.tipar_gata, 'Mostra vine după tiparul gata.'],
    fisa_gata: [atelier && inceput, 'Fișa de produs vine după început.'],
    corecturi: [inceput && (atelier || (kamulEi && d.stare === 'mostra_gata')), 'Corecturile se cer după început, de atelier sau, la mostră, de KAM-ul care o aprobă.'],
    anulat: [atelier || kamulEi, 'Anulează atelierul sau KAM-ul care a cerut-o.'],
  };
  const r = reguli[pas];
  if (!r) return 'Pas necunoscut.';
  if (!r[0]) return atelier || kamulEi ? r[1] : 'Nu ai drept să modifici dezvoltarea de produs.';
  if (pas === 'corecturi' && !observatii.trim()) return 'Scrie ce trebuie corectat.';
  await interogare(
    `INSERT INTO dezvoltare_pas (firma_id, dezvoltare_id, pas, observatii) VALUES (firma_curenta(), $1, $2, nullif($3, ''))`,
    [id, pas, observatii.trim()]);
  return null;
}

/** Propunerea de SKU: prefixul brandului (cel mai des folosit în catalog) + model + culoare. */
export async function propuneri(d: Detalii): Promise<{ culoare: string; denumire: string; sku: string }[]> {
  const [p] = await interogare<{ prefix: string | null }>(
    `SELECT split_part(cod_sku, '-', 1) AS prefix FROM produs WHERE brand_id = $1
      GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`, [d.brand_id]);
  const mare = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return d.culori.map((culoare) => ({
    culoare,
    denumire: [d.categorie, d.model, culoare].filter(Boolean).join(' '),
    sku: [p?.prefix, mare(d.model), mare(culoare)].filter(Boolean).join('-'),
  }));
}

/**
 * Aprobă mostra: doar KAM-ul care a cerut-o (sau un cont master), doar o mostră
 * gata. Într-o singură tranzacție: modelul intră în catalog (sau se leagă de cel
 * existent, după cod), fiecare culoare devine produs cu denumirea și SKU-ul
 * confirmate de KAM — cele din Shopify, ca vânzările să se lege —, iar pasul
 * „aprobat" se scrie în jurnal. Rețeta modelului urmează, în „Modele și rețete".
 */
export async function aproba(
  id: string, produse: { culoare: string; denumire: string; sku: string }[],
): Promise<string | null> {
  const u = await cere(['dezvoltare', 'comenzi'], 'vede');
  const d = await detalii(id);
  if (!d) return 'Nu există.';
  if (!esteAdmin(u) && d.kam_id !== u.id) return 'Mostra o aprobă KAM-ul care a cerut-o.';
  if (d.stare !== 'mostra_gata') return 'Se aprobă doar o mostră gata.';
  const alese = produse.filter((p) => p.sku.trim() && p.denumire.trim());
  if (alese.length === 0) return 'Fiecare culoare are nevoie de denumire și SKU.';
  try {
    return await caFirma(firmaCurenta(), async (c) => {
      const cod = d.model.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const { rows: [m] } = await c.query<{ id: string }>(
        `INSERT INTO model (firma_id, brand_id, cod, denumire, categorie_id)
         VALUES (firma_curenta(), $1, $2, $3, $4)
         ON CONFLICT (firma_id, brand_id, cod) DO UPDATE SET categorie_id = coalesce(model.categorie_id, EXCLUDED.categorie_id)
         RETURNING id`, [d.brand_id, cod, d.model, d.categorie_id]);
      for (const p of alese) {
        // Culoarea din listă, dacă există (fără majuscule); altfel una nouă.
        const { rows: [cul] } = await c.query<{ id: string }>(
          `WITH gasita AS (SELECT id FROM culoare WHERE lower(nume) = lower($1) LIMIT 1),
                noua AS (INSERT INTO culoare (firma_id, nume) SELECT firma_curenta(), $1
                          WHERE NOT EXISTS (SELECT 1 FROM gasita) RETURNING id)
           SELECT id FROM gasita UNION ALL SELECT id FROM noua`, [p.culoare.trim()]);
        await c.query(
          `INSERT INTO produs (firma_id, cod_sku, denumire, brand_id, culoare_id, categorie_id, model_id)
           VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6)`,
          [p.sku.trim().toUpperCase(), p.denumire.trim(), d.brand_id, cul.id, d.categorie_id, m.id]);
      }
      await c.query(`UPDATE dezvoltare SET model_id = $2 WHERE id = $1`, [id, m.id]);
      await c.query(`INSERT INTO dezvoltare_pas (firma_id, dezvoltare_id, pas) VALUES (firma_curenta(), $1, 'aprobat')`, [id]);
      return null;
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return 'Un SKU sau o denumire există deja în catalog.';
    throw e;
  }
}

export async function nomenclatoare() {
  const [branduri, categorii, marimi, kami] = await Promise.all([
    interogare<{ id: string; nume: string }>(`SELECT id, nume FROM brand WHERE activ ORDER BY nume`),
    interogare<{ id: string; nume: string }>(`SELECT id, nume FROM categorie ORDER BY nume`),
    interogare<{ id: string; cod: string }>(`SELECT id, cod FROM marime ORDER BY ordine`),
    interogare<{ id: string; nume: string }>(`SELECT id, nume FROM utilizator WHERE activ AND 'kam' = ANY (roluri) ORDER BY nume`),
  ]);
  return { branduri, categorii, marimi, kami };
}
