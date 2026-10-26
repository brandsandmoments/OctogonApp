import { caFirma } from './db';
import { firmaCurenta } from './sesiune';

export type Optiune = { id: string; nume: string };
export type ProdusOptiune = { id: string; nume: string; cod_sku: string; brand_id: string; activ: boolean };
export type MarimeOptiune = { id: string; cod: string; cod_numeric: string | null };

export type Nomenclatoare = {
  branduri: Optiune[];
  produse: ProdusOptiune[];
  marimi: MarimeOptiune[];
  kami: Optiune[];
};

/** Tot ce trebuie formularului de comandă, într-o singură tranzacție. */
export async function nomenclatoareComanda(): Promise<Nomenclatoare> {
  return caFirma(firmaCurenta(), async (c) => {
    // Una după alta: o conexiune execută o singură interogare odată.
    const branduri = await c.query<Optiune>(`SELECT id, nume FROM brand WHERE activ ORDER BY nume`);
    // Și produsele inactive: „Activ" din catalog înseamnă activ pe site, nu „nu se mai
    // produce" — 73 de produse inactive au comenzi în dashboard. Vin după cele active.
    const produse = await c.query<ProdusOptiune>(
      `SELECT id, denumire AS nume, cod_sku, brand_id, activ FROM produs ORDER BY NOT activ, denumire`,
    );
    const marimi = await c.query<MarimeOptiune>(`SELECT id, cod, cod_numeric FROM marime ORDER BY ordine`);
    const kami = await c.query<Optiune>(
      `SELECT id, nume FROM utilizator WHERE activ AND 'kam' = ANY (roluri) ORDER BY nume`);
    return { branduri: branduri.rows, produse: produse.rows, marimi: marimi.rows, kami: kami.rows };
  });
}

export type LinieNoua = {
  produsId: string;
  dataCeruta: string;
  vanzareDeLa: string;   // perioada în care KAM-ul crede că se vinde linia
  vanzarePanaLa: string;
  cantitati: Record<string, number>; // marime_id → bucăți
};

export type ComandaNoua = {
  numar: string;
  tip: 'PSF' | 'PSC';
  brandId: string;
  kamId: string;
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
  // La PSF, KAM-ul își asumă și perioada de vânzare: din ea se măsoară, săptămânal,
  // cât de bine a citit piața. Fără ea, PSF-ul n-ar avea cu ce fi comparat.
  if (cmd.tip === 'PSF') {
    if (!cmd.kamId) return { ok: false, eroare: 'La PSF, alege KAM-ul care îl dă.' };
    if (linii.some((l) => !l.vanzareDeLa || !l.vanzarePanaLa)) {
      return { ok: false, eroare: 'La PSF, fiecare linie are nevoie de perioada în care crezi că se vinde.' };
    }
    if (linii.some((l) => l.vanzarePanaLa < l.vanzareDeLa)) {
      return { ok: false, eroare: 'Perioada de vânzare se termină înainte să înceapă.' };
    }
  }

  try {
    return await caFirma(firmaCurenta(), async (c) => {
      const { rows: [{ id }] } = await c.query<{ id: string }>(
        `INSERT INTO comanda (firma_id, numar, tip, brand_id, data_lansare, prioritate, stare, observatii, kam_id)
         VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, nullif($7, ''), nullif($8, '')::uuid)
         RETURNING id`,
        [numar, cmd.tip, cmd.brandId, cmd.dataLansare, cmd.prioritate,
         cmd.lanseaza ? 'lansata' : 'ciorna', cmd.observatii.trim(), cmd.kamId],
      );
      for (const l of linii) {
        const { rows: [linie] } = await c.query<{ id: string }>(
          `INSERT INTO comanda_linie (firma_id, comanda_id, produs_id, data_ceruta, vanzare_de_la, vanzare_pana_la)
           VALUES (firma_curenta(), $1, $2, $3, nullif($4, '')::date, nullif($5, '')::date) RETURNING id`,
          [id, l.produsId, l.dataCeruta, l.vanzareDeLa, l.vanzarePanaLa],
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
