import { interogare } from './sesiune';

/**
 * Modelele din fiecare comandă, după numărul ei: „Palton Eloria, Trench Melissa".
 * Un produs fără model apare cu denumirea lui, ca să nu lipsească din listă.
 * Toate comenzile într-o singură interogare: ecranele le cer pentru liste întregi.
 */
export async function modeleComenzi(): Promise<Map<string, string>> {
  const randuri = await interogare<{ numar: string; modele: string }>(
    `SELECT c.numar, string_agg(DISTINCT coalesce(mo.denumire, p.denumire), ', ') AS modele
       FROM comanda c
       JOIN comanda_linie cl ON cl.comanda_id = c.id
       JOIN produs p         ON p.id = cl.produs_id
       LEFT JOIN model mo    ON mo.id = p.model_id
      GROUP BY c.numar`,
  );
  return new Map(randuri.map((r) => [r.numar, r.modele]));
}
