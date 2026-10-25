import { caFirma, firmaCurenta } from './db';

export type Optiune = { id: string; nume: string };
export type ProdusOptiune = { id: string; nume: string; cod_sku: string; brand_id: string };
export type MarimeOptiune = { id: string; cod: string; cod_numeric: string | null };

export type Nomenclatoare = {
  branduri: Optiune[];
  produse: ProdusOptiune[];
  marimi: MarimeOptiune[];
};

/** Tot ce trebuie formularului de comandă, într-un singur drum la bază. */
export async function nomenclatoareComanda(): Promise<Nomenclatoare> {
  return caFirma(firmaCurenta(), async (c) => {
    const [branduri, produse, marimi] = await Promise.all([
      c.query<Optiune>(`SELECT id, nume FROM brand WHERE activ ORDER BY nume`),
      c.query<ProdusOptiune>(
        `SELECT id, denumire AS nume, cod_sku, brand_id FROM produs WHERE activ ORDER BY denumire`,
      ),
      c.query<MarimeOptiune>(`SELECT id, cod, cod_numeric FROM marime ORDER BY ordine`),
    ]);
    return { branduri: branduri.rows, produse: produse.rows, marimi: marimi.rows };
  });
}

export type LinieNoua = {
  produsId: string;
  dataCeruta: string;
  cantitati: Record<string, number>; // marime_id → bucăți
};

export type ComandaNoua = {
  numar: string;
  tip: 'PSF' | 'PSC';
  brandId: string;
  dataLansare: string;
  prioritate: number;
  observatii: string;
  lanseaza: boolean;
  linii: LinieNoua[];
};

export type RezultatComanda = { ok: true; numar: string } | { ok: false; eroare: string };

/**
 * Numărul comenzii se scrie mereu la fel: „PSC-Sep-26-1 " și „psc-sep-26-1" sunt
 * aceeași comandă. Fără asta, indexul unic n-ar prinde dublura.
 */
export function normalizeazaNumar(brut: string): string {
  return brut.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Scrie comanda cu liniile și cantitățile ei, într-o singură tranzacție: ori
 * intră toată, ori nimic. O comandă pe jumătate scrisă e exact genul de rând
 * orfan pe care structura asta a fost făcută să nu-l mai permită.
 */
export async function creeazaComanda(cmd: ComandaNoua): Promise<RezultatComanda> {
  const numar = normalizeazaNumar(cmd.numar);
  if (!numar) return { ok: false, eroare: 'Scrie numărul comenzii.' };
  if (!cmd.brandId) return { ok: false, eroare: 'Alege brandul.' };
  if (!cmd.dataLansare) return { ok: false, eroare: 'Data lansării e obligatorie.' };

  const linii = cmd.linii
    .map((l) => ({
      ...l,
      cantitati: Object.entries(l.cantitati).filter(([, q]) => Number.isInteger(q) && q > 0),
    }))
    .filter((l) => l.produsId && l.cantitati.length > 0);
  if (linii.length === 0) return { ok: false, eroare: 'Comanda nu are nicio cantitate.' };
  if (new Set(linii.map((l) => l.produsId)).size !== linii.length) {
    return { ok: false, eroare: 'Același produs apare pe două linii. Pune cantitățile pe una.' };
  }
  if (linii.some((l) => !l.dataCeruta)) {
    return { ok: false, eroare: 'Fiecare linie are nevoie de data cerută în depozit.' };
  }

  try {
    return await caFirma(firmaCurenta(), async (c) => {
      const { rows: [{ id }] } = await c.query<{ id: string }>(
        `INSERT INTO comanda (firma_id, numar, tip, brand_id, data_lansare, prioritate, stare, observatii)
         VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, nullif($7, ''))
         RETURNING id`,
        [numar, cmd.tip, cmd.brandId, cmd.dataLansare, cmd.prioritate,
         cmd.lanseaza ? 'lansata' : 'ciorna', cmd.observatii.trim()],
      );
      for (const l of linii) {
        const { rows: [linie] } = await c.query<{ id: string }>(
          `INSERT INTO comanda_linie (firma_id, comanda_id, produs_id, data_ceruta)
           VALUES (firma_curenta(), $1, $2, $3) RETURNING id`,
          [id, l.produsId, l.dataCeruta],
        );
        for (const [marimeId, q] of l.cantitati) {
          await c.query(
            `INSERT INTO comanda_cantitate (firma_id, linie_id, marime_id, cantitate)
             VALUES (firma_curenta(), $1, $2, $3)`,
            [linie.id, marimeId, q],
          );
        }
      }
      return { ok: true as const, numar };
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      return { ok: false, eroare: `Comanda ${numar} există deja.` };
    }
    throw e;
  }
}
