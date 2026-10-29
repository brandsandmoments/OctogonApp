import { poate, type Zona } from '../../lib/acces';
import { interogare, utilizatorCurent } from '../../lib/sesiune';

/**
 * Căutarea în nomenclator, pentru câmpurile care se completează scriind: fiecare
 * cuvânt trebuie să apară în denumire, cod, furnizor sau culoare, fără diacritice.
 * Cel mult 30: mai multe înseamnă că trebuie scris încă un cuvânt.
 */
export async function GET(req: Request) {
  const u = await utilizatorCurent();
  const zone: Zona[] = ['necesar', 'dezvoltare', 'materiale', 'planificare'];
  if (!u || !zone.some((z) => poate(u, z))) {
    return new Response('Fără acces', { status: 403 });
  }
  const q = new URL(req.url).searchParams;
  const cuvinte = (q.get('q') ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean);
  const rez = await interogare<{ id: string; denumire: string; cod: string; unitate: string; furnizor: string | null; pret: string | null }>(
    `SELECT m.id, m.denumire, m.cod, m.unitate::text AS unitate, m.furnizor, m.pret_referinta::text AS pret
       FROM material m LEFT JOIN culoare cu ON cu.id = m.culoare_id
      WHERE m.activ AND ($1::text IS NULL OR m.tip::text = $1)
        AND (SELECT bool_and(translate(lower(m.denumire || ' ' || m.cod || ' ' || coalesce(m.furnizor, '') || ' ' || coalesce(cu.nume, '')),
                                       'ăâîșşțţ', 'aaissttt') LIKE '%' || w || '%')
               FROM unnest($2::text[]) w) IS NOT FALSE
      ORDER BY m.denumire LIMIT 30`,
    [q.get('tip') || null, cuvinte]);
  return Response.json(rez);
}
