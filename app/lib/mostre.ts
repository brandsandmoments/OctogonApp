import { caFirma } from './db';
import { creeazaComanda } from './comenzi';
import { azi } from './format';
import { firmaCurenta, interogare } from './sesiune';

/**
 * Mostre și comenzi de croit date chiar de la croit (șefa de croit, dezvoltare produs). Sunt
 * comenzi PSF interne, fără KAM: pleacă direct în „Rămas de croit" și apoi în producție, ca
 * oricare alta. Produsul se alege din cele existente sau se scrie de mână (denumire și
 * culoare) — un produs nou, care încă nu e în Shopify, se creează aici, marcat „din aplicație".
 */

export type OrigineCroit = 'mostra' | 'croit';
export const ORIGINI: Record<OrigineCroit, string> = { mostra: 'Mostră', croit: 'Comandă de croit' };

export type MostraNoua = {
  origine: OrigineCroit;
  brandId: string;
  produs: string;          // denumirea, aleasă din listă sau scrisă de mână
  // Variațiile: aceeași denumire în mai multe culori, fiecare cu bucățile ei (marime_id → bucăți).
  // Culoarea se adaugă la denumire (la un produs existent cu culoarea în nume, rămâne goală).
  variatii: { culoare: string; cantitati: Record<string, number> }[];
  dataCeruta: string;
  prioritate: number;
  observatii: string;
};

export type MostraLista = {
  comanda_id: string; numar: string; origine: OrigineCroit; produs: string; din_aplicatie: boolean; brand: string; brand_id: string;
  creat_la: string; creat_de: string | null; data_ceruta: string; cerut: number; croit: number; dat: number; gata: number; depozit: number;
  marimi: string; observatii: string | null; stare: string;
};

/** Unde e mostra: de croit, croită, în lucru, ieșită din lucru, în depozit. */
export const stadiuMostra = (x: Pick<MostraLista, 'cerut' | 'croit' | 'dat' | 'gata' | 'depozit'>): [string, string] =>
  x.depozit > 0 && x.depozit >= x.cerut ? ['În depozit', 'verde']
    : x.dat > 0 && x.gata >= x.dat && x.dat >= x.croit ? ['Ieșită din lucru', 'galben']
    : x.dat > x.gata ? ['În lucru', 'violet']
    : x.croit > 0 ? ['Croită', 'albastru'] : ['De croit', 'gri'];

/** Brandurile, produsele (pentru sugestii) și mărimile, pentru formular. */
export async function nomenclatoareMostre() {
  const [branduri, produse, marimi] = await Promise.all([
    interogare<{ id: string; nume: string }>(`SELECT id, nume FROM brand WHERE cod IS NOT NULL ORDER BY nume`),
    interogare<{ nume: string }>(`SELECT denumire AS nume FROM produs WHERE activ ORDER BY denumire`),
    interogare<{ id: string; cod: string }>(`SELECT id, cod FROM marime ORDER BY ordine`),
  ]);
  return { branduri, produse: produse.map((p) => p.nume), marimi };
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Produsul comenzii: cel cu denumirea dată (cu culoarea adăugată, dacă nu e deja în ea);
 * dacă nu există, se creează — fără Shopify, cu un cod „APP-…" și culoarea din nomenclator.
 */
async function produsul(brandId: string, produs: string, culoare: string): Promise<string> {
  const nume = produs.trim().replace(/\s+/g, ' ');
  const cul = culoare.trim().replace(/\s+/g, ' ');
  const intreg = cul && !nume.toLowerCase().endsWith(cul.toLowerCase()) ? `${nume} ${cul}` : nume;
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [existent] } = await c.query<{ id: string }>(
      `SELECT id FROM produs WHERE lower(denumire) = lower($1) OR lower(denumire) = lower($2) ORDER BY lower(denumire) = lower($1) DESC LIMIT 1`,
      [intreg, nume]);
    if (existent) return existent.id;
    let culoareId: string | null = null;
    if (cul) {
      const { rows: [cl] } = await c.query<{ id: string }>(`SELECT id FROM culoare WHERE lower(nume) = lower($1) LIMIT 1`, [cul]);
      culoareId = cl?.id ?? (await c.query<{ id: string }>(`INSERT INTO culoare (firma_id, nume) VALUES (firma_curenta(), $1) RETURNING id`, [cul])).rows[0].id;
    }
    const baza = `APP-${slug(intreg)}`.slice(0, 60);
    const { rows: [{ cod }] } = await c.query<{ cod: string }>(
      `SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM produs WHERE cod_sku = $1) THEN $1
                   ELSE $1 || '-' || (SELECT count(*) + 1 FROM produs WHERE cod_sku LIKE $1 || '%') END AS cod`, [baza]);
    // Modelul: denumirea fără primul cuvânt (felul hainei: „Rochie Test Sofia" → „Test Sofia"), ca la
    // modelele existente; găsit sau creat, ca toate culorile mostrei să se poată tăia împreună.
    const numeModel = nume.split(' ').length > 1 ? nume.split(' ').slice(1).join(' ') : nume;
    const { rows: [mod] } = await c.query<{ id: string }>(
      `SELECT id FROM model WHERE brand_id = $1 AND (lower(denumire) = lower($2) OR lower(denumire) = lower($3)) LIMIT 1`, [brandId, numeModel, nume]);
    const modelId = mod?.id ?? (await c.query<{ id: string }>(
      `INSERT INTO model (firma_id, brand_id, cod, denumire) VALUES (firma_curenta(), $1, $2, $3)
       ON CONFLICT (firma_id, brand_id, cod) DO UPDATE SET denumire = model.denumire RETURNING id`,
      [brandId, slug(numeModel).toLowerCase(), numeModel])).rows[0].id;
    const { rows: [nou] } = await c.query<{ id: string }>(
      `INSERT INTO produs (firma_id, cod_sku, denumire, brand_id, culoare_id, model_id, din_aplicatie)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5, true) RETURNING id`, [cod, intreg, brandId, culoareId, modelId]);
    return nou.id;
  });
}

/** Dă mostra (sau comanda de croit) la croit: o comandă PSF internă, lansată, care apare în „Rămas de croit". */
export async function daMostraLaCroit(m: MostraNoua): Promise<{ numar: string } | { eroare: string }> {
  if (!m.brandId) return { eroare: 'Alege brandul.' };
  if (!m.produs.trim()) return { eroare: 'Scrie denumirea produsului (sau alege-l din listă).' };
  if (!m.dataCeruta) return { eroare: 'Alege data până când trebuie gata.' };
  const variatii = m.variatii
    .map((v) => ({ culoare: v.culoare.trim(), cantitati: Object.entries(v.cantitati).filter(([, q]) => q > 0) }))
    .filter((v) => v.cantitati.length > 0);
  if (variatii.some((v) => v.cantitati.some(([, q]) => !Number.isInteger(q)))) return { eroare: 'Bucățile trebuie să fie numere întregi.' };
  if (!variatii.length) return { eroare: 'Scrie câte bucăți, pe mărimi (măcar la o culoare).' };
  if (new Set(variatii.map((v) => v.culoare.toLowerCase())).size !== variatii.length) return { eroare: 'Aceeași culoare e scrisă de două ori: pune bucățile pe un singur rând.' };
  if (variatii.length > 1 && variatii.some((v) => !v.culoare)) return { eroare: 'Cu mai multe variații, scrie culoarea la fiecare.' };
  const linii = [];
  for (const v of variatii) {
    linii.push({ produsId: await produsul(m.brandId, m.produs, v.culoare), dataCeruta: m.dataCeruta, vanzareDeLa: '', vanzarePanaLa: '',
                 cantitati: Object.fromEntries(v.cantitati) });
  }
  const rez = await creeazaComanda({
    tip: 'PSF', brandId: m.brandId, kamId: '', dataLansare: azi(), prioritate: m.prioritate, lanseaza: true, origine: m.origine,
    observatii: [ORIGINI[m.origine], m.observatii.trim()].filter(Boolean).join(' · '), linii,
  });
  return rez.ok ? { numar: rez.numar } : { eroare: rez.eroare };
}

/**
 * Mostrele (și, cu `siComenziCroit`, comenzile de croit interne), cu cât s-a croit, dat în lucru,
 * ieșit și intrat în depozit — toate, oricare le-ar fi stadiul.
 */
export async function mostreSiComenziCroit(siComenziCroit = true): Promise<MostraLista[]> {
  return interogare<MostraLista>(
    `WITH cerut AS (
         SELECT cl.comanda_id, sum(cc.cantitate)::int AS q,
                string_agg(m.cod || ' ' || cc.cantitate, ' · ' ORDER BY m.ordine) AS marimi
           FROM comanda_linie cl JOIN comanda_cantitate cc ON cc.linie_id = cl.id JOIN marime m ON m.id = cc.marime_id
          GROUP BY cl.comanda_id),
     croit AS (
         SELECT cl.comanda_id, sum(le.cantitate)::int AS q
           FROM comanda_linie cl JOIN planificare pl ON pl.linie_id = cl.id JOIN lot_croit lc ON lc.planificare_id = pl.id
           JOIN lot_croit_efectiv le ON le.lot_id = lc.id GROUP BY cl.comanda_id),
     dat AS (
         SELECT cl.comanda_id, sum(ac.cantitate)::int AS q, sum(ac.cantitate) FILTER (WHERE ab.iesit_productie_la IS NOT NULL)::int AS gata
           FROM comanda_linie cl JOIN planificare pl ON pl.linie_id = cl.id JOIN lot_croit lc ON lc.planificare_id = pl.id
           JOIN alimentare_banda ab ON ab.lot_id = lc.id JOIN alimentare_cantitate ac ON ac.alimentare_id = ab.id GROUP BY cl.comanda_id),
     depozit AS (
         SELECT cl.comanda_id, sum(rc.cantitate)::int AS q
           FROM comanda_linie cl JOIN eticheta e ON e.linie_id = cl.id JOIN receptie rc ON rc.eticheta_id = e.id GROUP BY cl.comanda_id)
     SELECT c.id AS comanda_id, c.brand_id, coalesce(dp.q, 0) AS depozit, c.numar, c.origine, string_agg(DISTINCT p.denumire, ', ') AS produs, bool_or(p.din_aplicatie) AS din_aplicatie,
            b.nume AS brand, to_char(c.creat_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI') AS creat_la, u.nume AS creat_de,
            to_char(min(cl.data_ceruta), 'YYYY-MM-DD') AS data_ceruta, coalesce(ce.q, 0) AS cerut, coalesce(cr.q, 0) AS croit,
            coalesce(d.q, 0) AS dat, coalesce(d.gata, 0) AS gata, ce.marimi, c.observatii, c.stare::text AS stare
       FROM comanda c
       JOIN brand b ON b.id = c.brand_id
       JOIN comanda_linie cl ON cl.comanda_id = c.id
       JOIN produs p ON p.id = cl.produs_id
       LEFT JOIN utilizator u ON u.id = c.creat_de
       LEFT JOIN cerut ce ON ce.comanda_id = c.id
       LEFT JOIN croit cr ON cr.comanda_id = c.id
       LEFT JOIN dat d ON d.comanda_id = c.id
       LEFT JOIN depozit dp ON dp.comanda_id = c.id
      WHERE (c.origine = 'mostra' OR ($1 AND c.origine = 'croit')) AND c.stare <> 'anulata'
      GROUP BY c.id, b.nume, u.nume, ce.q, ce.marimi, cr.q, d.q, d.gata, dp.q
      ORDER BY c.creat_la DESC`, [siComenziCroit]);
}

/**
 * Brandul greșit la o mostră (sau comandă de croit internă): comanda trece la brandul bun, cu
 * numărul nou (mst-<brand>-…), iar produsele scrise în aplicație pentru ea trec și ele, sub modelul
 * cu același nume al brandului bun (găsit sau creat). Produsele din Shopify rămân ale brandului lor.
 */
export async function schimbaBrandMostra(comandaId: string, brandId: string, cine: string): Promise<{ numar: string } | { eroare: string }> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [cm] } = await c.query<{ numar: string; origine: string; brand_id: string; data_lansare: string; vechi: string }>(
      `SELECT c.numar, c.origine, c.brand_id, to_char(c.data_lansare, 'YYYY-MM-DD') AS data_lansare, b.nume AS vechi
         FROM comanda c JOIN brand b ON b.id = c.brand_id WHERE c.id = $1 FOR UPDATE OF c`, [comandaId]);
    if (!cm) return { eroare: 'Mostra nu există.' };
    if (cm.origine === 'kam') return { eroare: 'Doar la mostre și comenzile de croit interne se schimbă brandul de aici.' };
    if (cm.brand_id === brandId) return { eroare: 'Mostra e deja pe brandul ăsta.' };
    const { rows: [b] } = await c.query<{ cod: string | null; nume: string }>(`SELECT cod, nume FROM brand WHERE id = $1`, [brandId]);
    if (!b?.cod) return { eroare: 'Brandul ales n-are cod pentru număr.' };
    // Numărul nou, ca la creare: mst (sau psf) - brand - an - lună - nr.
    const { rows: [{ prefix }] } = await c.query<{ prefix: string }>(
      `SELECT $1 || '-' || $2 || '-' || to_char($3::date, 'YY') || '-' || luna_scurta($3::date) || '-' AS prefix`,
      [cm.origine === 'mostra' ? 'mst' : 'psf', b.cod, cm.data_lansare]);
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [prefix]);
    const { rows: [{ numar }] } = await c.query<{ numar: string }>(
      `SELECT $1 || (coalesce(max(substr(numar, length($1) + 1)::int), 0) + 1) AS numar
         FROM comanda WHERE numar LIKE $1 || '%' AND substr(numar, length($1) + 1) ~ '^[0-9]+$'`, [prefix]);
    await c.query(
      `UPDATE comanda SET brand_id = $2, numar = $3,
              observatii = concat_ws(' · ', nullif(observatii, ''), $4::text) WHERE id = $1`,
      [comandaId, brandId, numar, `Brand schimbat din ${cm.vechi} în ${b.nume} (număr vechi ${cm.numar}) de ${cine}, ${azi().split('-').reverse().join('.')}`]);
    // Produsele scrise în aplicație pentru comanda asta (nefolosite de alte comenzi) trec la brandul bun.
    const { rows: produse } = await c.query<{ id: string; model_id: string | null; model: string | null }>(
      `SELECT DISTINCT p.id, p.model_id, mo.denumire AS model
         FROM comanda_linie cl JOIN produs p ON p.id = cl.produs_id LEFT JOIN model mo ON mo.id = p.model_id
        WHERE cl.comanda_id = $1 AND p.din_aplicatie
          AND NOT EXISTS (SELECT 1 FROM comanda_linie x WHERE x.produs_id = p.id AND x.comanda_id <> $1)`, [comandaId]);
    for (const p of produse) {
      let modelId = p.model_id;
      if (p.model) {
        const { rows: [mo] } = await c.query<{ id: string }>(`SELECT id FROM model WHERE brand_id = $1 AND lower(denumire) = lower($2)`, [brandId, p.model]);
        modelId = mo?.id ?? (await c.query<{ id: string }>(
          `INSERT INTO model (firma_id, brand_id, cod, denumire) VALUES (firma_curenta(), $1, $2, $3)
           ON CONFLICT (firma_id, brand_id, cod) DO UPDATE SET denumire = model.denumire RETURNING id`,
          [brandId, slug(p.model).toLowerCase(), p.model])).rows[0].id;
      }
      await c.query(`UPDATE produs SET brand_id = $2, model_id = $3 WHERE id = $1`, [p.id, brandId, modelId]);
      if (p.model_id && p.model_id !== modelId) {
        await c.query(`DELETE FROM model m WHERE m.id = $1 AND NOT EXISTS (SELECT 1 FROM produs WHERE model_id = m.id)
                         AND NOT EXISTS (SELECT 1 FROM model_componenta WHERE model_id = m.id)`, [p.model_id]);
      }
    }
    // Taierile mostrei își iau numele din numărul nou.
    await c.query(
      `UPDATE taiere t SET cod = coalesce(cod_taiere(t.id), t.cod)
        WHERE t.id IN (SELECT lc.taiere_id FROM lot_croit lc JOIN planificare pl ON pl.id = lc.planificare_id
                        JOIN comanda_linie cl ON cl.id = pl.linie_id WHERE cl.comanda_id = $1 AND lc.taiere_id IS NOT NULL)`, [comandaId]);
    return { numar };
  });
}
