import type { PoolClient } from 'pg';
import { caFirma } from './db';
import { firmaCurenta, interogare } from './sesiune';

/**
 * Referințele unei cereri de tipar și fișa de produs (0017). Fișa o face
 * dezvoltarea: componente cu furnizor, cod, consum și preț; materialul fiecărei
 * culori; tabelul de mărimi; manopera. Costul pe bucată se calculează, nu se scrie.
 */

// ---------------------------------------------------------------- referințe

export type Referinta = {
  id: string;
  tip: 'link' | 'nota' | 'poza';
  text: string | null;
  url: string | null;
  culoare: string | null;
  creat_la: string;
  cine: string | null;
};

export const referinte = (dezvoltareId: string) => interogare<Referinta>(
  `SELECT r.id, r.tip::text AS tip, r.text, r.url, r.culoare,
          to_char(r.creat_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI') AS creat_la, u.nume AS cine
     FROM dezvoltare_referinta r LEFT JOIN utilizator u ON u.id = r.creat_de
    WHERE r.dezvoltare_id = $1 ORDER BY r.creat_la`, [dezvoltareId]);

export type ReferintaNoua =
  | { tip: 'link'; url: string; text: string }
  | { tip: 'nota'; text: string }
  | { tip: 'poza'; fisier: Buffer; mime: string; text: string; culoare: string };

export async function adaugaReferinta(dezvoltareId: string, r: ReferintaNoua): Promise<string | null> {
  if (r.tip === 'link' && !/^https?:\/\//i.test(r.url.trim())) return 'Linkul trebuie să înceapă cu https://';
  if (r.tip === 'nota' && !r.text.trim()) return 'Scrie observația.';
  if (r.tip === 'poza') {
    if (!r.mime.startsWith('image/')) return 'Se pot încărca doar poze. Clipurile se pun ca link de Drive.';
    if (r.fisier.length === 0) return 'Alege poza.';
    if (r.fisier.length > 8 * 1024 * 1024) return 'Poza e prea mare (peste 8 MB).';
  }
  await interogare(
    `INSERT INTO dezvoltare_referinta (firma_id, dezvoltare_id, tip, text, url, fisier, mime, culoare)
     VALUES (firma_curenta(), $1, $2, nullif($3, ''), nullif($4, ''), $5, $6, nullif($7, ''))`,
    [dezvoltareId, r.tip, r.text.trim(), r.tip === 'link' ? r.url.trim() : '',
     r.tip === 'poza' ? r.fisier : null, r.tip === 'poza' ? r.mime : null, r.tip === 'poza' ? r.culoare.trim() : '']);
  return null;
}

export async function stergeReferinta(id: string): Promise<void> {
  await interogare(`DELETE FROM dezvoltare_referinta WHERE id = $1`, [id]);
}

/** O poză, pentru afișare și pentru fișa descărcată. */
export async function poza(id: string): Promise<{ fisier: Buffer; mime: string } | null> {
  const [p] = await interogare<{ fisier: Buffer; mime: string }>(
    `SELECT fisier, mime FROM dezvoltare_referinta WHERE id = $1 AND tip = 'poza'`, [id]);
  return p ?? null;
}

// ---------------------------------------------------------------- fișa

export type ComponentaFisa = {
  id: string;
  ordine: number;
  nume: string;
  tip: 'materie_prima' | 'accesoriu';
  unitate: string;
  consum: string;
  principal: boolean;
  se_croieste: boolean;
  furnizor: string | null;
  cod: string | null;
  material_id: string | null;
  material: string | null;
  pret: string | null;           // pe unitate: scris pe fișă, altfel prețul de referință al materialului
  culori: { culoare: string; material_id: string | null; material: string | null; cod: string | null;
            denumire: string | null; pret: string | null }[];
};

export type Fisa = {
  dezvoltare: { id: string; model: string; brand: string; categorie: string | null; culori: string[];
                manopera: string | null; stare: string; model_id: string | null };
  marimi: string[];
  componente: ComponentaFisa[];
  masuri: { id: string; nume: string; valori: Record<string, string> }[];
  poze: { id: string; culoare: string | null; text: string | null }[];
  materiale: { id: string; cod: string; denumire: string; tip: string; unitate: string; pret: string | null }[];
};

export async function fisa(id: string): Promise<Fisa | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [d] } = await c.query<Fisa['dezvoltare'] & { de_la: number | null; pana_la: number | null }>(
      `SELECT d.id, d.model, b.nume AS brand, ca.nume AS categorie, d.culori, d.manopera::text AS manopera,
              s.stare, d.model_id, md.ordine AS de_la, mp.ordine AS pana_la
         FROM dezvoltare d
         JOIN brand b ON b.id = d.brand_id
         JOIN dezvoltare_stare s ON s.dezvoltare_id = d.id
         LEFT JOIN categorie ca ON ca.id = d.categorie_id
         LEFT JOIN marime md ON md.id = d.marime_de_la
         LEFT JOIN marime mp ON mp.id = d.marime_pana_la
        WHERE d.id = $1`, [id]);
    if (!d) return null;
    const { rows: marimi } = await c.query<{ cod: string }>(
      `SELECT cod FROM marime WHERE ($1::int IS NULL OR ordine >= $1) AND ($2::int IS NULL OR ordine <= $2)
        ORDER BY ordine`, [d.de_la, d.pana_la]);
    const { rows: comp } = await c.query<Omit<ComponentaFisa, 'culori'>>(
      `SELECT fc.id, fc.ordine, fc.nume, fc.tip::text AS tip, fc.unitate::text AS unitate, fc.consum::text AS consum,
              fc.principal, fc.se_croieste, fc.furnizor, fc.cod, fc.material_id, m.denumire AS material,
              coalesce(fc.pret, m.pret_referinta)::text AS pret
         FROM fisa_componenta fc LEFT JOIN material m ON m.id = fc.material_id
        WHERE fc.dezvoltare_id = $1 ORDER BY fc.tip, fc.ordine`, [id]);
    const { rows: cul } = await c.query<ComponentaFisa['culori'][number] & { componenta_id: string }>(
      `SELECT cm.componenta_id, cm.culoare, cm.material_id, m.denumire AS material, coalesce(cm.cod, m.cod) AS cod,
              cm.denumire, coalesce(cm.pret, m.pret_referinta)::text AS pret
         FROM fisa_culoare_material cm
         JOIN fisa_componenta fc ON fc.id = cm.componenta_id
         LEFT JOIN material m ON m.id = cm.material_id
        WHERE fc.dezvoltare_id = $1`, [id]);
    const { rows: masuri } = await c.query<Fisa['masuri'][number]>(
      `SELECT id, nume, valori FROM fisa_masura WHERE dezvoltare_id = $1 ORDER BY ordine`, [id]);
    const { rows: poze } = await c.query<Fisa['poze'][number]>(
      `SELECT id, culoare, text FROM dezvoltare_referinta WHERE dezvoltare_id = $1 AND tip = 'poza' ORDER BY creat_la`, [id]);
    const { rows: materiale } = await c.query<Fisa['materiale'][number]>(
      `SELECT id, cod, denumire, tip::text AS tip, unitate::text AS unitate, pret_referinta::text AS pret
         FROM material WHERE activ ORDER BY denumire`);
    const { de_la: _a, pana_la: _b, ...dez } = d;
    return {
      dezvoltare: dez,
      marimi: marimi.map((m) => m.cod),
      componente: comp.map((x) => ({ ...x, culori: cul.filter((y) => y.componenta_id === x.id) })),
      masuri, poze, materiale,
    };
  });
}

/** Prețul pe unitate al unei componente pe o culoare: al culorii, dacă are; altfel al componentei. */
export const pretPeCuloare = (c: ComponentaFisa, culoare: string): number | null => {
  const x = c.culori.find((y) => y.culoare === culoare);
  const p = x?.pret ?? c.pret;
  return p === null || p === undefined ? null : Number(p);
};

/** Costul pe bucată, pe culoare: materii prime, accesorii, manoperă. Ce n-are preț nu se adună, dar se numără. */
export function cost(f: Fisa, culoare: string) {
  let materie = 0, accesorii = 0, faraPret = 0;
  for (const c of f.componente) {
    const p = pretPeCuloare(c, culoare);
    if (p === null) { faraPret++; continue; }
    if (c.tip === 'materie_prima') materie += Number(c.consum) * p; else accesorii += Number(c.consum) * p;
  }
  const manopera = Number(f.dezvoltare.manopera ?? 0);
  return { materie, accesorii, manopera, total: materie + accesorii + manopera, faraPret };
}

export type ComponentaNoua = {
  id?: string;
  nume: string;
  tip: string;
  unitate: string;
  consum: number;
  principal: boolean;
  seCroieste: boolean;
  furnizor: string;
  cod: string;
  materialId: string;
  pret: number | null;
};

export async function salveazaComponenta(dezvoltareId: string, x: ComponentaNoua): Promise<string | null> {
  if (!x.nume.trim()) return 'Scrie numele componentei (ex. Material de bază 1, Căptușeală).';
  if (!(x.consum > 0)) return 'Consumul pe bucată trebuie să fie mai mare ca zero.';
  if (x.pret !== null && !(x.pret >= 0)) return 'Prețul nu e un număr valid.';
  try {
    return await caFirma(firmaCurenta(), async (c) => {
      if (x.materialId) {
        const { rows: [m] } = await c.query<{ tip: string; unitate: string }>(
          `SELECT tip::text, unitate::text FROM material WHERE id = $1`, [x.materialId]);
        if (!m) return 'Materialul nu există.';
        if (m.tip !== x.tip || m.unitate !== x.unitate) return `Materialul ales e ${m.tip === 'accesoriu' ? 'accesoriu' : 'materie primă'} în ${m.unitate}.`;
      }
      // O singură stofă principală pe fișă.
      if (x.principal) await c.query(`UPDATE fisa_componenta SET principal = false WHERE dezvoltare_id = $1`, [dezvoltareId]);
      const v = [dezvoltareId, x.nume.trim(), x.tip, x.unitate, x.consum, x.principal, x.seCroieste && x.tip === 'materie_prima',
        x.furnizor.trim() || null, x.cod.trim() || null, x.materialId || null, x.pret];
      if (x.id) {
        await c.query(
          `UPDATE fisa_componenta SET nume = $2, tip = $3, unitate = $4, consum = $5, principal = $6, se_croieste = $7,
                  furnizor = $8, cod = $9, material_id = $10, pret = $11
            WHERE id = $12 AND dezvoltare_id = $1`, [...v, x.id]);
      } else {
        await c.query(
          `INSERT INTO fisa_componenta (firma_id, dezvoltare_id, nume, tip, unitate, consum, principal, se_croieste,
                                        furnizor, cod, material_id, pret, ordine)
           VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   (SELECT coalesce(max(ordine), 0) + 1 FROM fisa_componenta WHERE dezvoltare_id = $1))`, v);
      }
      return null;
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return `Componenta „${x.nume.trim()}" există deja pe fișă.`;
    throw e;
  }
}

export async function stergeComponentaFisa(id: string): Promise<void> {
  await interogare(`DELETE FROM fisa_componenta WHERE id = $1`, [id]);
}

/** Materialul unei componente pe o culoare: din nomenclator, sau cod și denumire pentru unul nou. Gol = ca pe componentă. */
export async function materialPeCuloare(
  componentaId: string, culoare: string, d: { materialId: string; cod: string; denumire: string; pret: number | null },
): Promise<string | null> {
  if (!d.materialId && !d.denumire.trim() && !d.cod.trim() && d.pret === null) {
    await interogare(`DELETE FROM fisa_culoare_material WHERE componenta_id = $1 AND culoare = $2`, [componentaId, culoare]);
    return null;
  }
  if (!d.materialId && !d.denumire.trim()) return `${culoare}: alege materialul sau scrie denumirea lui.`;
  await interogare(
    `INSERT INTO fisa_culoare_material (firma_id, componenta_id, culoare, material_id, cod, denumire, pret)
     VALUES (firma_curenta(), $1, $2, $3, nullif($4, ''), nullif($5, ''), $6)
     ON CONFLICT (componenta_id, culoare) DO UPDATE
        SET material_id = EXCLUDED.material_id, cod = EXCLUDED.cod, denumire = EXCLUDED.denumire, pret = EXCLUDED.pret`,
    [componentaId, culoare, d.materialId || null, d.cod.trim(), d.denumire.trim(), d.pret]);
  return null;
}

export async function salveazaMasuri(dezvoltareId: string, masuri: { nume: string; valori: Record<string, string> }[]): Promise<void> {
  await caFirma(firmaCurenta(), async (c) => {
    await c.query(`DELETE FROM fisa_masura WHERE dezvoltare_id = $1`, [dezvoltareId]);
    let i = 0;
    for (const m of masuri.filter((x) => x.nume.trim())) {
      await c.query(
        `INSERT INTO fisa_masura (firma_id, dezvoltare_id, ordine, nume, valori) VALUES (firma_curenta(), $1, $2, $3, $4)`,
        [dezvoltareId, ++i, m.nume.trim().toUpperCase(), JSON.stringify(m.valori)]);
    }
  });
}

export async function salveazaManopera(dezvoltareId: string, manopera: number | null): Promise<string | null> {
  if (manopera !== null && !(manopera >= 0)) return 'Manopera nu e un număr valid.';
  await interogare(`UPDATE dezvoltare SET manopera = $2 WHERE id = $1`, [dezvoltareId, manopera]);
  return null;
}

// ---------------------------------------------------------------- fișa devine rețetă

/**
 * La aprobare: componentele fișei devin componentele modelului, iar materialul
 * fiecărei culori se leagă de produsul culorii. Un material scris pe fișă, care nu
 * e în nomenclator, intră acum în el. Fără componente pe fișă, nu se atinge nimic.
 */
export async function fisaInReteta(
  c: PoolClient, dezvoltareId: string, modelId: string, produse: { culoare: string; produs_id: string }[],
): Promise<void> {
  const { rows: comp } = await c.query<{ id: string; nume: string; tip: string; unitate: string; consum: string;
    principal: boolean; se_croieste: boolean; furnizor: string | null; cod: string | null; material_id: string | null; pret: string | null }>(
    `SELECT id, nume, tip::text, unitate::text, consum::text, principal, se_croieste, furnizor, cod, material_id, pret::text
       FROM fisa_componenta WHERE dezvoltare_id = $1 ORDER BY tip, ordine`, [dezvoltareId]);
  let ordine = 0;
  for (const fc of comp) {
    const { rows: [mc] } = await c.query<{ id: string }>(
      `INSERT INTO model_componenta (firma_id, model_id, nume, tip, unitate, consum, ordine, principal, se_croieste)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (model_id, nume) DO UPDATE
          SET consum = EXCLUDED.consum, principal = EXCLUDED.principal, se_croieste = EXCLUDED.se_croieste
       RETURNING id`,
      [modelId, fc.nume.toUpperCase(), fc.tip, fc.unitate, fc.consum, ++ordine, fc.principal, fc.se_croieste]);
    for (const p of produse) {
      const { rows: [pc] } = await c.query<{ material_id: string | null; cod: string | null; denumire: string | null; pret: string | null }>(
        `SELECT material_id, cod, denumire, pret::text FROM fisa_culoare_material WHERE componenta_id = $1 AND culoare = $2`,
        [fc.id, p.culoare]);
      let material = pc?.material_id ?? (pc ? null : fc.material_id);
      if (!material) {
        // Un material nou: din culoare (cod și denumire scrise pe fișă) sau, la cele comune, din componentă.
        const denumire = pc?.denumire ?? `${fc.nume}${fc.cod ? '' : ` ${p.culoare}`}`;
        const cod = (pc?.cod ?? fc.cod ?? denumire).toUpperCase().replace(/\s+/g, '-');
        ({ rows: [{ id: material }] } = await c.query<{ id: string }>(
          `INSERT INTO material (firma_id, tip, cod, denumire, unitate, furnizor, pret_referinta)
           VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6)
           ON CONFLICT (firma_id, cod) DO UPDATE SET denumire = material.denumire
           RETURNING id`, [fc.tip, cod, denumire.toUpperCase(), fc.unitate, fc.furnizor, pc?.pret ?? fc.pret]));
      }
      await c.query(
        `INSERT INTO produs_material (firma_id, produs_id, model_id, componenta_id, material_id, tip, unitate)
         VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6)
         ON CONFLICT (produs_id, componenta_id) DO UPDATE SET material_id = EXCLUDED.material_id`,
        [p.produs_id, modelId, mc.id, material, fc.tip, fc.unitate]);
    }
  }
}
