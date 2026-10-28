import { caFirma } from './db';
import { firmaCurenta } from './sesiune';

export type AntetComanda = {
  numar: string;
  tip: string;
  brand: string;
  stare: string;
  data_lansare: string;
  bucati: number;
};

export type RandNecesar = {
  tip: 'materie_prima' | 'accesoriu';
  material_id: string;
  cod: string;
  denumire: string;
  culoare: string | null;
  unitate: string;
  necesar: string; // numeric vine ca text din pg: fără pierderi de zecimale
  disponibil: string; // stoc minus tot ce e rezervat de planificările active
  produse: string[];
};

/** Necesarul unei variații (produs = model × culoare): fiecare componentă cu materialul ei. */
export type Variatie = {
  produs_id: string;
  produs: string;
  cod_sku: string;
  bucati: number;
  randuri: { tip: 'materie_prima' | 'accesoriu'; componenta: string; material_id: string; cod: string; denumire: string;
             unitate: string; consum: string; necesar: string; disponibil: string }[];
};

export type Gol = {
  produs: string;
  cod_sku: string;
  bucati: number;
  problema: 'fara_model' | 'fara_reteta' | 'material_nealocat';
  componenta: string | null;
};

export type Necesar = { antet: AntetComanda; randuri: RandNecesar[]; variatii: Variatie[]; goluri: Gol[] };

/**
 * Necesarul unei comenzi, pe material, plus tot ce împiedică un necesar complet.
 *
 * Golurile sunt jumătate din valoarea ecranului: un necesar care tace despre
 * produsele fără rețetă pare complet și nu e. De aceea se întorc separat și se
 * arată deasupra tabelului, nu se pierd într-o sumă mai mică.
 */
export async function necesarComanda(numar: string): Promise<Necesar | null> {
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [antet] } = await c.query<AntetComanda>(
      `SELECT c.numar, c.tip::text AS tip, b.nume AS brand, c.stare::text AS stare,
              to_char(c.data_lansare, 'YYYY-MM-DD') AS data_lansare,
              coalesce((SELECT sum(cc.cantitate) FROM comanda_linie cl
                          JOIN comanda_cantitate cc ON cc.linie_id = cl.id
                         WHERE cl.comanda_id = c.id), 0)::int AS bucati
         FROM comanda c JOIN brand b ON b.id = c.brand_id
        WHERE c.numar = $1`,
      [numar],
    );
    if (!antet) return null;

    const { rows: randuri } = await c.query<RandNecesar>(
      `SELECT m.tip::text AS tip, m.id AS material_id, m.cod, m.denumire,
              cu.nume AS culoare, m.unitate::text AS unitate,
              sum(n.necesar)::text AS necesar,
              (min(s.stoc) - coalesce((SELECT sum(r.rezervat) FROM rezervare_material r
                                        WHERE r.material_id = m.id), 0))::numeric(12,3)::text AS disponibil,
              array_agg(DISTINCT p.denumire ORDER BY p.denumire) AS produse
         FROM necesar_comanda n
         JOIN material m      ON m.id = n.material_id
         JOIN stoc_material s ON s.material_id = m.id
         JOIN produs p        ON p.id = n.produs_id
         LEFT JOIN culoare cu ON cu.id = m.culoare_id
        WHERE n.comanda = $1
        GROUP BY m.tip, m.id, m.cod, m.denumire, cu.nume, m.unitate
        ORDER BY m.tip, m.denumire`,
      [numar],
    );

    // Pe variație: la Amalya Negru nasturi negri, la Amalya Ivory nasturi albi.
    const { rows: pe } = await c.query<Omit<Variatie, 'randuri'> & Variatie['randuri'][number]>(
      `SELECT p.id AS produs_id, p.denumire AS produs, p.cod_sku, n.bucati::int AS bucati,
              m.tip::text AS tip, n.componenta, m.id AS material_id, m.cod, m.denumire, m.unitate::text AS unitate,
              n.consum::text AS consum, n.necesar::text AS necesar,
              (s.stoc - coalesce((SELECT sum(r.rezervat) FROM rezervare_material r WHERE r.material_id = m.id), 0))
                ::numeric(12,3)::text AS disponibil
         FROM necesar_comanda n
         JOIN produs p        ON p.id = n.produs_id
         JOIN material m      ON m.id = n.material_id
         JOIN stoc_material s ON s.material_id = m.id
        WHERE n.comanda = $1
        ORDER BY p.denumire, m.tip, n.componenta`,
      [numar],
    );
    const variatii = new Map<string, Variatie>();
    for (const { produs_id, produs, cod_sku, bucati, ...x } of pe) {
      const v = variatii.get(produs_id) ?? { produs_id, produs, cod_sku, bucati, randuri: [] };
      v.randuri.push(x);
      variatii.set(produs_id, v);
    }

    const { rows: goluri } = await c.query<Gol>(
      `SELECT p.denumire AS produs, p.cod_sku, n.bucati,
              CASE WHEN n.model_id IS NULL      THEN 'fara_model'
                   WHEN n.componenta_id IS NULL THEN 'fara_reteta'
                   ELSE 'material_nealocat' END AS problema,
              n.componenta
         FROM necesar_comanda n
         JOIN produs p ON p.id = n.produs_id
        WHERE n.comanda = $1 AND n.material_id IS NULL
        ORDER BY p.denumire, n.componenta`,
      [numar],
    );

    return { antet, randuri, variatii: [...variatii.values()], goluri };
  });
}
