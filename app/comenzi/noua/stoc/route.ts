import { poate } from '../../../lib/acces';
import { stocPentruProdus } from '../../../lib/acoperire';
import { utilizatorCurent } from '../../../lib/sesiune';

/** Stocul, vânzările și ce e pe drum, pe mărimile unui produs: pentru formularul de comandă. */
export async function GET(req: Request) {
  const u = await utilizatorCurent();
  if (!u || !poate(u, 'comenzi')) return new Response('Fără acces', { status: 403 });
  const produs = new URL(req.url).searchParams.get('produs');
  if (!produs || !/^[0-9a-f-]{36}$/.test(produs)) return new Response('Produs lipsă', { status: 400 });
  return Response.json(await stocPentruProdus(produs));
}
