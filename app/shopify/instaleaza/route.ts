import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { esteAdmin } from '../../lib/acces';
import { utilizatorCurent } from '../../lib/sesiune';
import { adresaInstalare, adresaPublica, codMagazin, domeniuValid, shopifyConfigurat } from '../../lib/shopify';

/**
 * Începe instalarea aplicației Octogon pe un magazin: un cont master alege brandul
 * și scrie domeniul .myshopify.com, iar Shopify îi cere proprietarului magazinului
 * să aprobe accesul. Starea (magazinul ales + un nonce) stă într-un cookie scurt,
 * verificat la întoarcere, ca nimeni să nu poată lega alt magazin în locul lui.
 */
export async function GET(req: Request) {
  const u = await utilizatorCurent();
  if (!u || !esteAdmin(u)) return new Response('Doar un cont master leagă magazine.', { status: 403 });
  const q = new URL(req.url).searchParams;
  const magazin = q.get('magazin') ?? '';
  const domeniu = (q.get('domeniu') ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const inapoi = (eroare: string) => NextResponse.redirect(adresaPublica(`/magazine/legaturi?eroare=${encodeURIComponent(eroare)}`));
  const cod = await codMagazin(magazin);
  if (!cod) return inapoi('Magazinul nu există.');
  if (!shopifyConfigurat(cod)) return inapoi('Aplicația Shopify nu e configurată pe server (SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_CHEIE, APP_URL).');
  if (!domeniuValid(domeniu)) return inapoi('Domeniul trebuie să fie de forma magazin.myshopify.com.');
  const nonce = randomBytes(16).toString('hex');
  (await cookies()).set('octogon_shopify', `${nonce}:${magazin}`, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 600, path: '/shopify',
  });
  return NextResponse.redirect(adresaInstalare(domeniu, nonce, cod));
}
