import { timingSafeEqual } from 'node:crypto';
import { firmaDinMediu } from '../../lib/db';
import { importaExtras } from '../../lib/extras';

const egal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Importul unui extras de cont (PDF în corpul cererii), de pe server — cu SYNC_SECRET
 * în antetul X-Octogon-Sync. Din aplicație, extrasul se încarcă din Financiar → Bancă.
 */
export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET;
  const dat = req.headers.get('x-octogon-sync');
  if (!(secret && dat && egal(dat, secret))) return new Response('Fără acces', { status: 403 });
  const r = await importaExtras(new Uint8Array(await req.arrayBuffer()), firmaDinMediu());
  const { tranzactii, ...rest } = r;
  return Response.json({ ...rest, tranzactii: tranzactii.length });
}
