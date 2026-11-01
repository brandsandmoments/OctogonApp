import { timingSafeEqual } from 'node:crypto';
import { esteAdmin } from '../../lib/acces';
import { utilizatorCurent } from '../../lib/sesiune';
import { trimiteRezumatSlack } from '../../lib/slack';

const egal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Rezumatul de dimineață pe Slack: din timer-ul serverului (SYNC_SECRET) sau de un cont master. */
export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET;
  const dat = req.headers.get('x-octogon-sync');
  const cuSecret = Boolean(secret && dat && egal(dat, secret));
  const u = cuSecret ? null : await utilizatorCurent();
  if (!cuSecret && !(u && esteAdmin(u))) return new Response('Fără acces', { status: 403 });
  return Response.json({ rezultat: await trimiteRezumatSlack() });
}
