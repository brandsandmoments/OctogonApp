import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { esteAdmin } from '../../lib/acces';
import { utilizatorCurent } from '../../lib/sesiune';
import { codMagazin, domeniuValid, hmacParametriValid, legaMagazin, schimbaCodulPeToken } from '../../lib/shopify';

/**
 * Întoarcerea din Shopify după aprobare: semnătura parametrilor, nonce-ul din
 * cookie și domeniul se verifică înainte de orice; apoi codul devine token, tokenul
 * se salvează criptat, se abonează webhook-urile și rulează prima sincronizare.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const inapoi = (rez: string) => NextResponse.redirect(new URL(`/magazine/legaturi?${rez}`, req.url));
  const u = await utilizatorCurent();
  if (!u || !esteAdmin(u)) return new Response('Doar un cont master leagă magazine.', { status: 403 });
  const borcan = await cookies();
  const [nonce, magazinId] = (borcan.get('octogon_shopify')?.value ?? '').split(':');
  borcan.delete({ name: 'octogon_shopify', path: '/shopify' });
  const domeniu = q.get('shop') ?? '';
  const cod = magazinId ? await codMagazin(magazinId) : null;
  if (!cod || !hmacParametriValid(q, cod) || !nonce || q.get('state') !== nonce || !domeniuValid(domeniu)) {
    return inapoi(`eroare=${encodeURIComponent('Instalarea nu a putut fi verificată. Încearcă din nou din pagina de legături.')}`);
  }
  try {
    const { token, permisiuni } = await schimbaCodulPeToken(domeniu, q.get('code') ?? '', cod);
    await legaMagazin(magazinId, domeniu, token, permisiuni);
  } catch (e) {
    return inapoi(`eroare=${encodeURIComponent((e as Error).message)}`);
  }
  return inapoi(`legat=${encodeURIComponent(domeniu)}`);
}
