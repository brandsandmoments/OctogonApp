import { ROLURI, ZONE, type Drepturi, type Rol } from './acces';
import { caFirma } from './db';
import { firmaCurenta, interogare } from './sesiune';

export type Om = {
  id: string;
  nume: string;
  email: string | null;
  roluri: string[];
  activ: boolean;
  are_parola: boolean;
  are_pin: boolean;
  blocat: boolean;
  sesiuni: number;
  drepturi: Drepturi;
};

export async function oameni(): Promise<Om[]> {
  return interogare<Om>(
    `SELECT u.id, u.nume, u.email::text AS email, u.roluri::text[] AS roluri, u.activ,
            coalesce(s.are_parola, false) AS are_parola, coalesce(s.are_pin, false) AS are_pin,
            coalesce(s.blocat, false) AS blocat, coalesce(s.sesiuni, 0) AS sesiuni,
            coalesce((SELECT jsonb_object_agg(d.zona, d.nivel) FROM drept d WHERE d.utilizator_id = u.id), '{}') AS drepturi
       FROM utilizator u LEFT JOIN conturi_stare() s ON s.utilizator_id = u.id
      ORDER BY NOT u.activ, u.nume`,
  );
}

const roluriValide = (r: string[]) => r.filter((x): x is Rol => x in ROLURI);

/** Mesajele de eroare ale funcțiilor din 0012 sunt deja în română: le dăm mai departe. */
function mesaj(e: unknown): string | null {
  const m = (e as { message?: string; code?: string });
  if (m.code === 'P0001') return m.message ?? 'Eroare.';
  if (m.code === '23505') return 'Emailul e deja folosit de alt om.';
  return null;
}

export async function adaugaOm(nume: string, email: string, roluri: string[]): Promise<string | null> {
  if (!nume.trim()) return 'Scrie numele.';
  try {
    await interogare(
      `INSERT INTO utilizator (firma_id, nume, email, roluri) VALUES (firma_curenta(), $1, nullif($2, '')::citext, $3::rol[])`,
      [nume.trim(), email.trim().toLowerCase(), roluriValide(roluri)]);
    return null;
  } catch (e) {
    const m = mesaj(e);
    if ((e as { code?: string }).code === '23505' && /nume/.test(String((e as { constraint?: string }).constraint))) {
      return `Există deja cineva numit „${nume.trim()}".`;
    }
    if (m) return m;
    throw e;
  }
}

/**
 * Schimbă datele unui om. Adminul nu-și poate lua singur rolul de admin și nu se
 * poate dezactiva: altfel firma poate rămâne fără nimeni care să mai dea conturi.
 */
export async function actualizeazaOm(
  eu: string, id: string, d: { nume: string; email: string; roluri: string[]; activ: boolean },
): Promise<string | null> {
  const roluri = roluriValide(d.roluri);
  if (id === eu && (!roluri.includes('admin') || !d.activ)) {
    return 'Nu-ți poți lua singur rolul de admin și nu te poți dezactiva.';
  }
  try {
    await interogare(
      `UPDATE utilizator SET nume = $2, email = nullif($3, '')::citext, roluri = $4::rol[], activ = $5 WHERE id = $1`,
      [id, d.nume.trim(), d.email.trim().toLowerCase(), roluri, d.activ]);
    return null;
  } catch (e) {
    const m = mesaj(e);
    if (m) return m;
    throw e;
  }
}

/** Drepturile unui om, toate odată: ce nu e în listă nu mai e permis. */
export async function seteazaDrepturi(id: string, drepturi: Drepturi): Promise<void> {
  await caFirma(firmaCurenta(), async (c) => {
    await c.query(`DELETE FROM drept WHERE utilizator_id = $1`, [id]);
    for (const [zona, nivel] of Object.entries(drepturi)) {
      if (!(zona in ZONE) || (nivel !== 'vede' && nivel !== 'modifica')) continue;
      await c.query(`INSERT INTO drept (firma_id, utilizator_id, zona, nivel) VALUES (firma_curenta(), $1, $2, $3)`,
        [id, zona, nivel]);
    }
  });
}

export async function seteazaParola(id: string, parola: string): Promise<string | null> {
  try {
    await caFirma(firmaCurenta(), (c) => c.query(`SELECT cont_seteaza_parola($1, $2)`, [id, parola]));
    return null;
  } catch (e) {
    const m = mesaj(e);
    if (m) return m;
    throw e;
  }
}

export async function seteazaPin(id: string, pin: string): Promise<string | null> {
  try {
    await caFirma(firmaCurenta(), (c) => c.query(`SELECT cont_seteaza_pin($1, $2)`, [id, pin]));
    return null;
  } catch (e) {
    const m = mesaj(e);
    if (m) return m;
    throw e;
  }
}

export type Dispozitiv = { id: string; nume: string; inregistrat_la: string; revocat: boolean };

export async function dispozitive(): Promise<Dispozitiv[]> {
  return interogare<Dispozitiv>(
    `SELECT id, nume, to_char(inregistrat_la, 'YYYY-MM-DD HH24:MI') AS inregistrat_la, revocat FROM dispozitive()`);
}

/** Întoarce tokenul dispozitivului; pagina îl pune în cookie-ul acestui browser. */
export async function inregistreazaDispozitiv(nume: string, de: string): Promise<string> {
  const [r] = await interogare<{ token: string }>(
    `SELECT dispozitiv_inregistreaza($1, $2) AS token`, [nume.trim() || 'Dispozitiv atelier', de]);
  return r.token;
}

export async function revocaDispozitiv(id: string): Promise<void> {
  await interogare(`SELECT dispozitiv_revoca($1)`, [id]);
}
