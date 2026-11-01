import { timingSafeEqual } from 'node:crypto';
import { esteAdmin } from '../../lib/acces';
import { utilizatorCurent } from '../../lib/sesiune';
import { sincronizeaza } from '../../lib/shopify';

const egal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Sincronizarea completă (produse cu stoc, comenzi deschise), pentru timer-ul de
 * noapte de pe server — cu SYNC_SECRET în antetul X-Octogon-Sync — sau pentru un
 * cont master logat. Webhook-urile țin datele la zi între două sincronizări.
 */
export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET;
  const dat = req.headers.get('x-octogon-sync');
  const u = secret && dat && egal(dat, secret) ? null : await utilizatorCurent();
  if (!(secret && dat && egal(dat, secret)) && !(u && esteAdmin(u))) return new Response('Fără acces', { status: 403 });
  const magazin = new URL(req.url).searchParams.get('magazin') ?? undefined;
  return Response.json(await sincronizeaza(magazin));
}
