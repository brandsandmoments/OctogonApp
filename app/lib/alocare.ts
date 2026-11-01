import { caFirma } from './db';
import { firmaCurenta, interogare } from './sesiune';

/**
 * Oamenii din producție și alocarea lor pe operații. Șeful de bandă alege, la o
 * tranșă de pe bandă (un PSF sau PSC), faza din procesul tehnologic al modelului,
 * mașina și omul — scrie și primește numele din listă —, când începe și când iese gata.
 */

export const FUNCTII = {
  alimentator: 'Alimentator',
  control_interfazic: 'Control interfazic',
  operator: 'Operator mașini de cusut',
  calcator_interfazic: 'Călcător interfazic',
  calcator_final: 'Călcător final',
  ctc_ambalat: 'Final CTC și ambalat',
  sef_sectie: 'Șef de secție',
  modelier: 'Modelier',
  sef_modele: 'Șef modele',
  taietor: 'Croit · tăietor',
  croit_auxiliar: 'Croit · auxiliar',
  auxiliar_sectie: 'Auxiliar secție',
  sef_croit: 'Șef croit',
} as const;
export type Functie = keyof typeof FUNCTII;

export type Angajat = { id: string; nume: string; functii: Functie[]; activ: boolean; ocupat: string | null };
export type Utilaj = { nume: string; masina: boolean };
export type OperatieTransa = { id: string; ordine: number; denumire: string; utilaj: string | null; timp_min: string };
export type Alocare = {
  id: string; faza: string; operatie_id: string | null; utilaj: string | null; om: string; incepe_la: string | null; gata_la: string | null;
  minute: number | null; observatii: string | null;
};

/** Oamenii, cu ce lucrează acum (o alocare începută și neterminată), ca șeful să vadă cine e liber. */
export async function personal(doarActivi = true): Promise<Angajat[]> {
  return interogare<Angajat>(
    `SELECT a.id, a.nume, a.functii, a.activ,
            (SELECT x.faza || ' · ' || c.numar FROM alocare_operatie x
               JOIN alimentare_banda ab ON ab.id = x.alimentare_id JOIN lot_croit lc ON lc.id = ab.lot_id
               JOIN planificare pl ON pl.id = lc.planificare_id JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN comanda c ON c.id = cl.comanda_id
              WHERE x.angajat_id = a.id AND x.gata_la IS NULL AND x.incepe_la IS NOT NULL ORDER BY x.incepe_la DESC LIMIT 1) AS ocupat
       FROM angajat a WHERE ($1::boolean IS FALSE OR a.activ) ORDER BY a.nume`, [doarActivi]);
}

export async function utilaje(): Promise<Utilaj[]> {
  return interogare<Utilaj>(`SELECT nume, masina FROM utilaj ORDER BY ordine, nume`);
}

/** Fazele din procesul tehnologic al modelului de pe tranșă, în ordine. */
export async function operatiiTransa(alimentareId: string): Promise<OperatieTransa[]> {
  return interogare<OperatieTransa>(
    `SELECT mo.id, mo.ordine, mo.denumire, mo.utilaj, mo.timp_min::text AS timp_min
       FROM alimentare_banda ab JOIN lot_croit lc ON lc.id = ab.lot_id JOIN planificare pl ON pl.id = lc.planificare_id
       JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN produs p ON p.id = cl.produs_id
       JOIN model_operatie mo ON mo.model_id = p.model_id
      WHERE ab.id = $1 ORDER BY mo.ordine`, [alimentareId]);
}

export async function alocari(alimentareId: string): Promise<Alocare[]> {
  return interogare<Alocare>(
    `SELECT x.id, x.faza, x.operatie_id, x.utilaj, a.nume AS om,
            to_char(x.incepe_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI') AS incepe_la,
            to_char(x.gata_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI') AS gata_la,
            round(extract(epoch FROM coalesce(x.gata_la, now()) - x.incepe_la) / 60)::int AS minute, x.observatii
       FROM alocare_operatie x JOIN angajat a ON a.id = x.angajat_id
       LEFT JOIN model_operatie mo ON mo.id = x.operatie_id
      WHERE x.alimentare_id = $1 ORDER BY mo.ordine NULLS LAST, x.faza, x.incepe_la NULLS LAST`, [alimentareId]);
}

const ora = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? s : null; };

/**
 * O alocare nouă. Omul se dă după nume (cum l-a ales din listă), faza după numele ei —
 * dacă e una din procesul tehnologic al modelului, se leagă de ea. Orele vin din
 * formular, la ora României.
 */
export async function adaugaAlocare(alimentareId: string, f: FormData): Promise<string | null> {
  const faza = String(f.get('faza') ?? '').trim();
  const nume = String(f.get('om') ?? '').trim();
  const utilaj = String(f.get('utilaj') ?? '').trim() || null;
  const [incepe, gata] = [ora(f.get('incepe')), ora(f.get('gata'))];
  if (!faza) return 'Scrie faza (sau alege-o din listă).';
  if (!nume) return 'Scrie numele omului și alege-l din listă.';
  if (incepe && gata && gata < incepe) return 'Ora de gata e înaintea celei de început.';
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [om] } = await c.query<{ id: string }>(
      `SELECT id FROM angajat WHERE lower(nume) = lower($1) AND activ`, [nume]);
    if (!om) return `Nu găsesc „${nume}" printre oameni. Alege numele din listă sau adaugă-l în Oameni producție.`;
    const { rows: [op] } = await c.query<{ id: string; utilaj: string | null }>(
      `SELECT mo.id, mo.utilaj FROM alimentare_banda ab JOIN lot_croit lc ON lc.id = ab.lot_id JOIN planificare pl ON pl.id = lc.planificare_id
         JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN produs p ON p.id = cl.produs_id
         JOIN model_operatie mo ON mo.model_id = p.model_id
        WHERE ab.id = $1 AND lower(mo.denumire) = lower($2) LIMIT 1`, [alimentareId, faza]);
    await c.query(
      `INSERT INTO alocare_operatie (firma_id, alimentare_id, operatie_id, faza, utilaj, angajat_id, incepe_la, gata_la, observatii)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6::timestamp AT TIME ZONE 'Europe/Bucharest', $7::timestamp AT TIME ZONE 'Europe/Bucharest', $8)`,
      [alimentareId, op?.id ?? null, faza, utilaj ?? op?.utilaj ?? null, om.id, incepe, gata, String(f.get('observatii') ?? '').trim() || null]);
    return null;
  });
}

/** „Începe acum" / „Gata acum": ora de acum, pe o alocare. */
export async function marcheaza(id: string, ce: 'incepe' | 'gata'): Promise<string | null> {
  const [r] = await interogare<{ id: string }>(
    ce === 'incepe'
      ? `UPDATE alocare_operatie SET incepe_la = now() WHERE id = $1 AND incepe_la IS NULL RETURNING id`
      : `UPDATE alocare_operatie SET gata_la = now(), incepe_la = coalesce(incepe_la, now()) WHERE id = $1 AND gata_la IS NULL RETURNING id`, [id]);
  return r ? null : 'Alocarea e deja marcată.';
}

export async function stergeAlocare(id: string): Promise<void> {
  await interogare(`DELETE FROM alocare_operatie WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------- oamenii

export async function adaugaAngajat(nume: string, functii: string[]): Promise<string | null> {
  const n = nume.trim().replace(/\s+/g, ' ');
  if (!n) return 'Scrie numele.';
  const bune = functii.filter((x) => x in FUNCTII);
  try {
    await interogare(`INSERT INTO angajat (firma_id, nume, functii) VALUES (firma_curenta(), $1, $2)`, [n, bune]);
    return null;
  } catch (e) {
    return /unique|duplicate/i.test((e as Error).message) ? `„${n}" e deja în listă.` : (e as Error).message;
  }
}

export async function schimbaAngajat(id: string, d: { functii?: string[]; activ?: boolean }): Promise<void> {
  if (d.functii) await interogare(`UPDATE angajat SET functii = $2 WHERE id = $1`, [id, d.functii.filter((x) => x in FUNCTII)]);
  if (d.activ !== undefined) await interogare(`UPDATE angajat SET activ = $2 WHERE id = $1`, [id, d.activ]);
}
