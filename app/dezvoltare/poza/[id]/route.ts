import { poate } from '../../../lib/acces';
import { poza } from '../../../lib/fisa';
import { utilizatorCurent } from '../../../lib/sesiune';

/** O poză de la o cerere de tipar, pentru cine vede dezvoltarea. Poza nu se schimbă: se poate ține în cache. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await utilizatorCurent();
  if (!u || !(poate(u, 'dezvoltare') || poate(u, 'comenzi'))) return new Response('Fără acces', { status: 403 });
  const p = await poza((await params).id);
  if (!p) return new Response('Nu există', { status: 404 });
  return new Response(new Uint8Array(p.fisier), {
    headers: { 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
}
