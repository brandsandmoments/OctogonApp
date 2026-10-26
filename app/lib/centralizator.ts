import { interogare } from './sesiune';

export type RandCentralizator = {
  linie_id: string;
  comanda: string;
  kam: string | null;
  tip: string;
  brand: string;
  stare: string;
  prioritate: number;
  data_lansare: string;
  data_ceruta: string;
  model: string | null;
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

export type Filtre = { tip?: string; brand?: string; cauta?: string; toate?: boolean; stadiu?: string; peModel?: boolean };

/**
 * Stadiul unei linii de comandă (un produs, toate mărimile), după cel mai
 * departe pas atins: gata când a intrat tot în depozit sau linia s-a închis; în
 * lucru când ceva a intrat pe bandă; croită când s-a croit ceva; altfel necroită.
 */
export const STADII_LINIE = {
  necroita: 'Necroite',
  croita: 'Croite',
  in_lucru: 'În lucru',
  gata: 'Gata',
} as const;
export type StadiuLinie = keyof typeof STADII_LINIE;

export function stadiulLiniei(marimi: Pick<RandCentralizator, 'cerut' | 'croit' | 'banda' | 'intrat' | 'inchisa'>[]): StadiuLinie {
  if (marimi.every((m) => m.inchisa || m.intrat >= m.cerut)) return 'gata';
  if (marimi.some((m) => m.banda > 0)) return 'in_lucru';
  if (marimi.some((m) => m.croit > 0)) return 'croita';
  return 'necroita';
}

/**
 * Rândurile, cu stadiul liniei lor; filtrate pe stadiu, dacă s-a cerut. Comenzile
 * închise intră mereu la „gata" — altfel fila ar fi goală —, iar în rest doar
 * cu „și închise".
 */
export async function centralizatorPeStadii(f: Filtre) {
  const randuri = (await centralizator({ ...f, toate: true }))
    .filter((r) => f.toate || r.stare !== 'anulata');
  const peLinie = new Map<string, RandCentralizator[]>();
  for (const r of randuri) peLinie.set(r.linie_id, [...(peLinie.get(r.linie_id) ?? []), r]);
  const stadiu = new Map([...peLinie].map(([id, m]) => [id, stadiulLiniei(m)]));
  const numarate = Object.fromEntries(Object.keys(STADII_LINIE).map((k) => [k, 0])) as Record<StadiuLinie, number>;
  const inchisa = new Map(randuri.map((r) => [r.linie_id, r.stare === 'inchisa' || r.stare === 'anulata']));
  const seVede = (id: string, s: StadiuLinie) => f.toate || !inchisa.get(id) || s === 'gata';
  for (const [id, s] of stadiu) if (seVede(id, s)) numarate[s]++;
  const toate = [...stadiu.keys()].filter((id) => f.toate || !inchisa.get(id)).length;
  const ales = f.stadiu && f.stadiu in STADII_LINIE ? (f.stadiu as StadiuLinie) : undefined;
  return {
    randuri: randuri
      .filter((r) => (ales ? stadiu.get(r.linie_id) === ales : true) && (ales === 'gata' || f.toate || !inchisa.get(r.linie_id)))
      .map((r) => ({ ...r, stadiu: stadiu.get(r.linie_id)! })),
    numarate,
    toate,
  };
}

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
     SELECT cl.id AS linie_id, c.numar AS comanda, k.nume AS kam, c.tip::text AS tip, b.nume AS brand, c.stare::text AS stare,
            c.prioritate, to_char(c.data_lansare, 'YYYY-MM-DD') AS data_lansare,
            to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
            mo.denumire AS model, p.denumire AS produs, p.cod_sku, m.cod AS marime, m.cod_numeric AS marime_numerica,
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
       LEFT JOIN model mo    ON mo.id = p.model_id
       LEFT JOIN utilizator k ON k.id = c.kam_id
       LEFT JOIN planificat pl ON pl.linie_id = cl.id AND pl.marime_id = cc.marime_id
       LEFT JOIN croit cr      ON cr.linie_id = cl.id AND cr.marime_id = cc.marime_id
       LEFT JOIN banda bd      ON bd.linie_id = cl.id AND bd.marime_id = cc.marime_id
       LEFT JOIN intrat i      ON i.linie_id  = cl.id AND i.marime_id  = cc.marime_id
      WHERE ($1::text IS NULL OR c.tip::text = $1)
        AND ($2::text IS NULL OR b.nume = $2)
        AND ($3::text IS NULL OR c.numar ILIKE '%' || $3 || '%' OR p.denumire ILIKE '%' || $3 || '%'
                              OR p.cod_sku ILIKE '%' || $3 || '%')
        AND ($4 OR c.stare NOT IN ('inchisa', 'anulata'))
      ORDER BY CASE WHEN $5 THEN coalesce(mo.denumire, p.denumire) END, c.prioritate, c.data_lansare, c.numar, p.denumire, m.ordine`,
    [f.tip || null, f.brand || null, f.cauta?.trim() || null, Boolean(f.toate), Boolean(f.peModel)],
  );
}

export async function branduriActive(): Promise<string[]> {
  return (await interogare<{ nume: string }>(`SELECT nume FROM brand WHERE activ ORDER BY nume`))
    .map((r) => r.nume);
}
