import { timingSafeEqual } from 'node:crypto';
import { esteAdmin } from '../../lib/acces';
import { sincronizeazaFinanciar } from '../../lib/financiarSync';
import { utilizatorCurent } from '../../lib/sesiune';

const egal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Citirea coletelor (Fan, GLS), a facturilor (xConnector) și a rambursurilor virate,
 * pentru timer-ul de pe server — cu SYNC_SECRET în antetul X-Octogon-Sync — sau
 * pentru un cont master logat.
 */
export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET;
  const dat = req.headers.get('x-octogon-sync');
  const cuSecret = Boolean(secret && dat && egal(dat, secret));
  const u = cuSecret ? null : await utilizatorCurent();
  if (!cuSecret && !(u && esteAdmin(u))) return new Response('Fără acces', { status: 403 });
  return Response.json(await sincronizeazaFinanciar());
}
