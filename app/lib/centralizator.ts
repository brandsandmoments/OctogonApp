import { interogare } from './sesiune';

export type RandCentralizator = {
  comanda: string;
  tip: string;
  brand: string;
  stare: string;
  prioritate: number;
  data_lansare: string;
  data_ceruta: string;
  produs: string;
  cod_sku: string;
  marime: string;
  marime_numerica: string | null;
  cerut: number;
  planificat: number;
  croit: number;
  banda: number;
  intrat: number;
  inchisa: boolean;
};

export type Filtre = { tip?: string; brand?: string; cauta?: string; toate?: boolean };

/**
 * Toate pozițiile din toate comenzile, PSF și PSC, într-un singur tabel: ce s-a
 * cerut, cât s-a planificat, cât s-a croit, cât a intrat pe bandă, cât a intrat
 * în depozit.
 *
 * Fiecare coloană e o sumă separată, calculată în subinterogarea ei. Cu toate
 * tabelele legate într-un singur JOIN, o poziție cu două recepții și două loturi
 * ar număra fiecare lot de două ori — exact genul de dublură pe care o produceau
 * formulele din sheet când se adăuga un rând la mijloc.
 */
export async function centralizator(f: Filtre): Promise<RandCentralizator[]> {
  return interogare<RandCentralizator>(
    `WITH planificat AS (
         SELECT linie_id, marime_id, cantitate AS q FROM planificat_pe_pozitie),
     croit AS (
         SELECT pl.linie_id, le.marime_id, sum(le.cantitate)::int AS q
           FROM planificare pl
           JOIN lot_croit lc         ON lc.planificare_id = pl.id
           JOIN lot_croit_efectiv le ON le.lot_id = lc.id
          GROUP BY pl.linie_id, le.marime_id),
     banda AS (
         SELECT pl.linie_id, ac.marime_id, sum(ac.cantitate)::int AS q
           FROM planificare pl
           JOIN lot_croit lc            ON lc.planificare_id = pl.id
           JOIN alimentare_banda ab     ON ab.lot_id = lc.id
           JOIN alimentare_cantitate ac ON ac.alimentare_id = ab.id
          GROUP BY pl.linie_id, ac.marime_id),
     intrat AS (
         SELECT e.linie_id, e.marime_id, sum(r.cantitate)::int AS q,
                bool_or(r.inchide_pozitia) AS inchisa
           FROM eticheta e
           JOIN receptie r ON r.eticheta_id = e.id
          GROUP BY e.linie_id, e.marime_id)
     SELECT c.numar AS comanda, c.tip::text AS tip, b.nume AS brand, c.stare::text AS stare,
            c.prioritate, to_char(c.data_lansare, 'YYYY-MM-DD') AS data_lansare,
            to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
            p.denumire AS produs, p.cod_sku, m.cod AS marime, m.cod_numeric AS marime_numerica,
            cc.cantitate AS cerut,
            coalesce(pl.q, 0) AS planificat,
            coalesce(cr.q, 0) AS croit,
            coalesce(bd.q, 0) AS banda,
            coalesce(i.q, 0)  AS intrat,
            coalesce(i.inchisa, false) AS inchisa
       FROM comanda_cantitate cc
       JOIN comanda_linie cl ON cl.id = cc.linie_id
       JOIN comanda c        ON c.id  = cl.comanda_id
       JOIN brand b          ON b.id  = c.brand_id
       JOIN produs p         ON p.id  = cl.produs_id
       JOIN marime m         ON m.id  = cc.marime_id
       LEFT JOIN planificat pl ON pl.linie_id = cl.id AND pl.marime_id = cc.marime_id
       LEFT JOIN croit cr      ON cr.linie_id = cl.id AND cr.marime_id = cc.marime_id
       LEFT JOIN banda bd      ON bd.linie_id = cl.id AND bd.marime_id = cc.marime_id
       LEFT JOIN intrat i      ON i.linie_id  = cl.id AND i.marime_id  = cc.marime_id
      WHERE ($1::text IS NULL OR c.tip::text = $1)
        AND ($2::text IS NULL OR b.nume = $2)
        AND ($3::text IS NULL OR c.numar ILIKE '%' || $3 || '%' OR p.denumire ILIKE '%' || $3 || '%'
                              OR p.cod_sku ILIKE '%' || $3 || '%')
        AND ($4 OR c.stare NOT IN ('inchisa', 'anulata'))
      ORDER BY c.prioritate, c.data_lansare, c.numar, p.denumire, m.ordine`,
    [f.tip || null, f.brand || null, f.cauta?.trim() || null, Boolean(f.toate)],
  );
}

export async function branduriActive(): Promise<string[]> {
  return (await interogare<{ nume: string }>(`SELECT nume FROM brand WHERE activ ORDER BY nume`))
    .map((r) => r.nume);
}
