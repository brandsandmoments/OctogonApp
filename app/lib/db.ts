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

/** Temporar: firma vine din mediu. După autentificare, din utilizatorul conectat. */
export function firmaCurenta(): string {
  const id = process.env.FIRMA_ID;
  if (!id) throw new FirmaLipsa();
  return id;
}

export async function caFirma<T>(
  firmaId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  if (!firmaId) throw new FirmaLipsa();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.firma_id', firmaId]);
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

/** Scurtătură pentru o singură interogare de citire. */
export async function interogare<T = Record<string, unknown>>(
  text: string,
  valori: unknown[] = [],
): Promise<T[]> {
  return caFirma(firmaCurenta(), async (c) => (await c.query(text, valori)).rows as T[]);
}
