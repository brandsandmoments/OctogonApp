import { interogare } from './sesiune';
import { rangMarime } from './format';

/**
 * Foaia de croit de printat (A4): ce se taie, pe culori și mărimi, și necesarul de materiale
 * pentru întins și tăiat — din rețeta modelului: bucăți × consumul pe bucată al fiecărei
 * componente, cu materialul culorii (căptușeala, stofa diferă de la o culoare la alta).
 * Sursa: comenzi din „Rămas de croit" (ce a rămas de croit) sau o taiere (ce s-a pus / croit în ea).
 */

export type RandFisa = { comanda: string; tip: string; produs_id: string; produs: string; culoare: string; data_ceruta: string; marimi: Map<string, number>; total: number };
export type CelulaNecesar = { material: string; cantitate: number };
export type RandNecesar = { componenta: string; tip: 'materie_prima' | 'accesoriu'; unitate: string; consum: number; pe: Map<string, CelulaNecesar> };
export type Fisa = {
  model: string; brand: string; taiere: string | null; marimi: string[]; randuri: RandFisa[]; necesar: RandNecesar[];
  fara_reteta: string[];   // culorile fără rețetă (necesarul lor se scrie de mână)
};

type Rand = { comanda: string; tip: string; brand: string; produs_id: string; produs: string; culoare: string | null; model: string;
  data_ceruta: string; marime: string; q: number; taiere: string | null };

const COLOANE = `c.numar AS comanda, c.tip::text AS tip, b.nume AS brand, p.id AS produs_id, p.denumire AS produs, cu.nume AS culoare,
                 coalesce(mo.denumire, p.denumire) AS model, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta, m.cod AS marime`;
const LEGATURI = `JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN comanda c ON c.id = cl.comanda_id JOIN brand b ON b.id = c.brand_id
                  JOIN produs p ON p.id = cl.produs_id LEFT JOIN culoare cu ON cu.id = p.culoare_id LEFT JOIN model mo ON mo.id = p.model_id`;

export async function fisaCroit(sursa: { planificari: string[] } | { taiere: string }): Promise<Fisa | null> {
  const randuri = 'taiere' in sursa
    ? await interogare<Rand>(
        `SELECT ${COLOANE}, coalesce(le.cantitate, lq.cantitate)::int AS q, t.cod AS taiere
           FROM lot_croit lc JOIN taiere t ON t.id = lc.taiere_id JOIN planificare pl ON pl.id = lc.planificare_id ${LEGATURI}
           JOIN lot_croit_cantitate lq ON lq.lot_id = lc.id JOIN marime m ON m.id = lq.marime_id
           LEFT JOIN lot_croit_efectiv le ON le.lot_id = lc.id AND le.marime_id = lq.marime_id
          WHERE lc.taiere_id = $1 AND pl.stadiu <> 'anulat'`, [sursa.taiere])
    // Din „Rămas de croit": restul de croit, fără ce stă deja în taieri necroite (ca în listă).
    : await interogare<Rand>(
        `WITH deschis AS (
             SELECT lc.planificare_id, lq.marime_id, sum(lq.cantitate)::int AS q
               FROM lot_croit lc JOIN lot_croit_cantitate lq ON lq.lot_id = lc.id WHERE lc.croit_la IS NULL GROUP BY 1, 2)
         SELECT ${COLOANE}, greatest(r.rest - coalesce(d.q, 0), 0)::int AS q, NULL AS taiere
           FROM planificare_rest_de_croit r JOIN planificare pl ON pl.id = r.planificare_id ${LEGATURI}
           JOIN marime m ON m.id = r.marime_id
           LEFT JOIN deschis d ON d.planificare_id = r.planificare_id AND d.marime_id = r.marime_id
          WHERE r.planificare_id = ANY ($1::uuid[])`, [sursa.planificari]);
  const cuBucati = randuri.filter((r) => r.q > 0);
  if (!cuBucati.length) return null;

  const pe = new Map<string, RandFisa>();
  for (const r of cuBucati) {
    const cheie = `${r.comanda}|${r.produs_id}`;
    const x = pe.get(cheie) ?? { comanda: r.comanda, tip: r.tip, produs_id: r.produs_id, produs: r.produs, data_ceruta: r.data_ceruta, marimi: new Map(), total: 0,
      culoare: r.culoare ?? (r.produs.toLowerCase().startsWith(r.model.toLowerCase()) ? r.produs.slice(r.model.length).trim() : r.produs) };
    x.marimi.set(r.marime, (x.marimi.get(r.marime) ?? 0) + r.q);
    x.total += r.q;
    pe.set(cheie, x);
  }
  const lista = [...pe.values()].sort((a, b) => a.culoare.localeCompare(b.culoare, 'ro') || a.comanda.localeCompare(b.comanda));
  const marimi = [...new Set(cuBucati.map((r) => r.marime))].sort((a, b) => rangMarime(a) - rangMarime(b));

  // Bucățile pe produs (culoare), pentru necesar: o culoare poate veni din mai multe comenzi.
  const bucati = new Map<string, number>();
  for (const r of lista) bucati.set(r.produs_id, (bucati.get(r.produs_id) ?? 0) + r.total);
  const reteta = await interogare<{ produs_id: string; componenta: string; tip: 'materie_prima' | 'accesoriu'; unitate: string; consum: number; ordine: number; material: string }>(
    `SELECT pm.produs_id, mc.nume AS componenta, mc.tip, mc.unitate::text AS unitate, mc.consum::float AS consum, mc.ordine, m.denumire AS material
       FROM produs_material pm JOIN model_componenta mc ON mc.id = pm.componenta_id JOIN material m ON m.id = pm.material_id
      WHERE pm.produs_id = ANY ($1::uuid[])
      ORDER BY mc.tip, mc.principal DESC, mc.ordine, mc.nume`, [[...bucati.keys()]]);
  const necesar = new Map<string, RandNecesar>();
  for (const x of reteta) {
    const cheie = `${x.tip}|${x.componenta}|${x.unitate}`;
    const n = necesar.get(cheie) ?? { componenta: x.componenta, tip: x.tip, unitate: x.unitate, consum: x.consum, pe: new Map() };
    n.pe.set(x.produs_id, { material: x.material, cantitate: Math.round((bucati.get(x.produs_id) ?? 0) * x.consum * 100) / 100 });
    necesar.set(cheie, n);
  }
  const cuReteta = new Set(reteta.map((x) => x.produs_id));
  return {
    model: cuBucati[0].model, brand: cuBucati[0].brand, taiere: cuBucati[0].taiere, marimi, randuri: lista, necesar: [...necesar.values()],
    fara_reteta: [...new Set(lista.filter((r) => !cuReteta.has(r.produs_id)).map((r) => r.culoare))],
  };
}
