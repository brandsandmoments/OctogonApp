import { Pool, type PoolClient } from 'pg';

/**
 * Singurul drum către baza de date.
 *
 * Fiecare interogare rulează într-o tranzacție care începe prin a declara firma.
 * Dacă firma nu e setată, politicile din 0002_izolare.sql întorc zero rânduri —
 * deci o scăpare se vede ca „nu găsesc nimic", nu ca datele altui client.
 *
 * `set_config(..., true)` leagă valoarea de tranzacție: la întoarcerea conexiunii
 * în pool nu rămâne nimic setat pentru următoarea cerere.
 *
 * În interiorul lui `caFirma`, interogările se scriu una după alta, cu `await`,
 * niciodată în `Promise.all` pe același client: o conexiune execută o singură
 * interogare odată. pg le pune azi la coadă cu un avertisment și le va refuza
 * de la versiunea 9. Pentru paralelism adevărat, apeluri `caFirma` separate —
 * fiecare își ia conexiunea ei din pool.
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export class FirmaLipsa extends Error {
  constructor() {
    super('Nu s-a putut stabili firma pentru cererea asta.');
    this.name = 'FirmaLipsa';
  }
}

/**
 * Firma pentru scripturi (import, sincronizare Shopify), care rulează fără om
 * logat. Aplicația nu o folosește: acolo firma vine din sesiune (sesiune.ts).
 */
export function firmaDinMediu(): string {
  const id = process.env.FIRMA_ID;
  if (!id) throw new FirmaLipsa();
  return id;
}

/** Pentru cine rulează o tranzacție: firma, și omul logat când e unul (scripturile n-au). */
export type Context = { firma: string; utilizator?: string };

export async function caFirma<T>(
  context: string | Context | Promise<string | Context>,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const ctx = await context;
  const { firma: firmaId, utilizator } = typeof ctx === 'string' ? { firma: ctx, utilizator: undefined } : ctx;
  if (!firmaId) throw new FirmaLipsa();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.firma_id', firmaId]);
    // Omul logat: coloanele „cine a făcut" îl iau implicit (utilizator_curent(), 0012).
    if (utilizator) await client.query('SELECT set_config($1, $2, true)', ['app.utilizator_id', utilizator]);
    const rezultat = await fn(client);
    await client.query('COMMIT');
    return rezultat;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * O interogare în afara oricărei firme: doar pentru funcțiile de logare și sesiune
 * din 0012, care își declară singure firma. Orice altceva trece prin caFirma.
 */
export async function faraFirma<T = Record<string, unknown>>(text: string, valori: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, valori)).rows as T[];
}
