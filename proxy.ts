import { NextResponse, type NextRequest } from 'next/server';

/**
 * Verificarea rapidă: fără cookie de sesiune, direct la logare. E doar un filtru
 * — dacă sesiunea e validă și ce roluri are omul se verifică pe server, la fiecare
 * pagină și acțiune (app/lib/sesiune.ts), nu aici.
 */
// Webhook-urile Shopify și sincronizarea de noapte vin fără sesiune: se verifică prin semnătură, respectiv secret.
const PUBLICE = ['/login', '/atelier', '/shopify/webhook', '/shopify/sync', '/shopify/slack', '/financiar/sync'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICE.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.get('octogon_sesiune')?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?inapoi=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Tot în afară de fișierele statice ale lui Next și de favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
