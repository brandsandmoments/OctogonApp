import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { PoolClient } from 'pg';
import { poate, type Drepturi, type Nivel, type Zona } from './acces';
import { caFirma, faraFirma, type Context } from './db';

/**
 * Sesiunea omului logat — de aici vin firma și rolurile, pentru tot ce face aplicația.
 *
 * Cookie-ul ține doar tokenul; cine e în spatele lui spune baza (sesiune_curenta
 * din 0012), la fiecare cerere. Un cont dezactivat sau o parolă schimbată
 * închide sesiunea imediat, nu la expirarea cookie-ului.
 */

export const COOKIE_SESIUNE = 'octogon_sesiune';
export const COOKIE_DISPOZITIV = 'octogon_dispozitiv';

export type Utilizator = {
  id: string;
  firma_id: string;
  nume: string;
  roluri: string[];
  drepturi: Drepturi;
  din_atelier: boolean;
};

/** Cel mult o căutare a sesiunii pe cerere, oricâte componente o cer. */
export const utilizatorCurent = cache(async (): Promise<Utilizator | null> => {
  const token = (await cookies()).get(COOKIE_SESIUNE)?.value;
  if (!token) return null;
  const [u] = await faraFirma<{ utilizator_id: string; firma_id: string; nume: string; roluri: string[]; din_atelier: boolean }>(
    `SELECT * FROM sesiune_curenta($1)`, [token]);
  if (!u) return null;
  const drepturi = await caFirma({ firma: u.firma_id, utilizator: u.utilizator_id }, async (c) =>
    (await c.query<{ zona: string; nivel: string }>(`SELECT zona, nivel::text FROM drept WHERE utilizator_id = $1`,
      [u.utilizator_id])).rows);
  return {
    id: u.utilizator_id, firma_id: u.firma_id, nume: u.nume, roluri: u.roluri, din_atelier: u.din_atelier,
    drepturi: Object.fromEntries(drepturi.map((d) => [d.zona, d.nivel])) as Drepturi,
  };
});

/**
 * Cere un om logat, cu drept în zonă — măcar una din zone, dacă sunt mai multe.
 * Fără sesiune: la logare. Fără drept: înapoi acasă, cu motivul. Se cheamă la
 * începutul fiecărei pagini (nivel „vede") și al fiecărei acțiuni („modifica").
 * Fără zonă: orice om logat.
 */
export async function cere(zona?: Zona | Zona[], nivel: Nivel = 'vede'): Promise<Utilizator> {
  const u = await utilizatorCurent();
  if (!u) redirect('/login');
  const zone = zona === undefined ? [] : Array.isArray(zona) ? zona : [zona];
  if (zone.length > 0 && !zone.some((z) => poate(u, z, nivel))) {
    redirect(`/?fara_acces=${zone[0]}${nivel === 'modifica' && zone.some((z) => poate(u, z)) ? '&doar_vede=1' : ''}`);
  }
  return u;
}

/** Pentru pagini: poate omul modifica aici? Ascunde butoanele care oricum ar fi refuzate. */
export async function poateModifica(zona: Zona): Promise<boolean> {
  const u = await utilizatorCurent();
  return Boolean(u && poate(u, zona, 'modifica'));
}

/**
 * Operațiile de la croit (întins, tăiat, termocolat, împerecheat, metri, defecte)
 * le scriu și operatorii de croit, care altfel doar văd croitul. Corecturile și
 * închiderea rămân la cine poate modifica croitul.
 */
export const lucreazaLaCroit = (u: Utilizator) =>
  poate(u, 'croit', 'modifica') || (u.roluri.includes('operator_croit') && poate(u, 'croit'));

export async function cereOperatorCroit(): Promise<Utilizator> {
  const u = await cere('croit');
  if (!lucreazaLaCroit(u)) redirect('/?fara_acces=croit&doar_vede=1');
  return u;
}

/** Firma și omul logat, pentru caFirma: tot ce scrie aplicația își știe autorul. */
export async function firmaCurenta(): Promise<Context> {
  const u = await cere();
  return { firma: u.firma_id, utilizator: u.id };
}

/** O interogare de citire în firma omului logat. */
export async function interogare<T = Record<string, unknown>>(text: string, valori: unknown[] = []): Promise<T[]> {
  return caFirma(firmaCurenta(), async (c: PoolClient) => (await c.query(text, valori)).rows as T[]);
}
