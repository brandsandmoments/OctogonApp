import type { PoolClient } from 'pg';

/**
 * Motivul scris liber la stingerea unei comenzi: dacă e unul din listă (fără
 * majuscule), rămâne acela; altfel se ține sub „Altele", iar cuvintele omului
 * intră în observații — nimic din ce a scris nu se pierde.
 */
export async function motivLiber(
  c: PoolClient, text: string, context: 'croit' | 'receptie', observatii: string,
): Promise<{ motivId: string; observatii: string } | null> {
  const t = text.trim();
  if (!t) return null;
  const { rows: [gasit] } = await c.query<{ id: string }>(
    `SELECT id FROM motiv WHERE activ AND $2 = ANY (contexte::text[]) AND lower(nume) = lower($1) LIMIT 1`, [t, context]);
  if (gasit) return { motivId: gasit.id, observatii: observatii.trim() || t };
  const { rows: [altele] } = await c.query<{ id: string }>(
    `SELECT id FROM motiv WHERE cod = 'altele' LIMIT 1`);
  return { motivId: altele.id, observatii: observatii.trim() ? `${t} — ${observatii.trim()}` : t };
}
