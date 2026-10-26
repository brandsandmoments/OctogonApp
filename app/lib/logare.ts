'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { faraFirma } from './db';
import { COOKIE_DISPOZITIV, COOKIE_SESIUNE } from './sesiune';

/**
 * Logarea și ieșirea. Cookie-ul de sesiune e httpOnly (scripturile din pagină nu-l
 * văd), sameSite=lax și secure în producție. Durata o decide baza: o săptămână la
 * birou, o tură (12 ore) în atelier.
 */

async function puneSesiune(token: string, atelier: boolean) {
  (await cookies()).set(COOKIE_SESIUNE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/',
    maxAge: atelier ? 12 * 3600 : 7 * 24 * 3600,
  });
}

/** Doar adrese din aplicație: un `inapoi` spre alt site ar face din logare o trambulină. */
function inapoiSigur(inapoi: string): string {
  return inapoi.startsWith('/') && !inapoi.startsWith('//') ? inapoi : '/';
}

export async function logareParola(date: FormData) {
  const email = String(date.get('email') ?? '').trim();
  const parola = String(date.get('parola') ?? '');
  const inapoi = inapoiSigur(String(date.get('inapoi') ?? '/'));
  const [r] = email && parola
    ? await faraFirma<{ token: string | null }>(`SELECT logare_parola($1, $2) AS token`, [email, parola])
    : [{ token: null }];
  if (!r.token) {
    // Același mesaj pentru email necunoscut, parolă greșită și cont blocat.
    redirect(`/login?eroare=1&inapoi=${encodeURIComponent(inapoi)}`);
  }
  await puneSesiune(r.token, false);
  redirect(inapoi);
}

export async function logarePin(date: FormData) {
  const dispozitiv = (await cookies()).get(COOKIE_DISPOZITIV)?.value;
  const utilizator = String(date.get('utilizator') ?? '');
  const pin = String(date.get('pin') ?? '');
  if (!dispozitiv) redirect('/atelier');
  const [r] = /^[0-9a-f-]{36}$/.test(utilizator) && pin
    ? await faraFirma<{ token: string | null }>(`SELECT logare_pin($1, $2, $3) AS token`, [dispozitiv, utilizator, pin])
    : [{ token: null }];
  if (!r.token) redirect(`/atelier?eroare=1&cine=${utilizator}`);
  await puneSesiune(r.token, true);
  redirect('/');
}

export async function iesire() {
  const borcan = await cookies();
  const token = borcan.get(COOKIE_SESIUNE)?.value;
  if (token) await faraFirma(`SELECT sesiune_inchide($1)`, [token]);
  borcan.delete(COOKIE_SESIUNE);
  // Pe o tabletă de atelier, ieșirea duce înapoi la lista de oameni, nu la email.
  redirect(borcan.get(COOKIE_DISPOZITIV) ? '/atelier' : '/login');
}
