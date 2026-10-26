import type { PoolClient } from 'pg';
import { caFirma } from './db';
import { firmaCurenta } from './sesiune';

export type PozitieScanata = {
  cod: string;
  comanda: string;
  tip: string;
  produs: string;
  cod_sku: string;
  marime: string;
  marime_numerica: string | null;
  pozitie: number;
  cerut: number;
  intrat: number;
  lipsesc: number;
  /** Bucăți intrate peste cerut. */
  peste: number;
  inchisa: boolean;
  motiv_inchidere: string | null;
};

export type Motiv = { id: string; nume: string };

/**
 * Ce se tastează sau se citește de pe etichetă devine codul din bază.
 * Un scanner de mână poate lăsa un spațiu sau un Enter la coadă, iar cine
 * tastează de pe o etichetă mototolită scrie des cu litere mici.
 */
export function normalizeazaCod(brut: string): string {
  return brut.trim().toUpperCase();
}

/**
 * Poziția din spatele unei etichete, cu progresul ei calculat din recepții.
 * Aceeași socoteală ca pe /comenzi: nimic nu se ține într-o coloană care poate
 * rămâne în urmă. `FOR UPDATE` pe etichetă, când se cere, ține pe loc a doua
 * scanare a aceleiași etichete până se termină prima — altfel doi oameni care
 * scanează același colet în același timp ar vedea amândoi „lipsesc 3" și ar
 * credita 6.
 */
async function citestePozitia(
  c: PoolClient,
  cod: string,
  blocheaza: boolean,
): Promise<(PozitieScanata & { eticheta_id: string }) | null> {
  const { rows: [e] } = await c.query<{ id: string }>(
    `SELECT id FROM eticheta WHERE cod = $1 AND anulata_la IS NULL
     ${blocheaza ? 'FOR UPDATE' : ''}`,
    [cod],
  );
  if (!e) return null;

  const { rows: [p] } = await c.query<PozitieScanata & { eticheta_id: string }>(
    `SELECT e.id AS eticheta_id, e.cod, c.numar AS comanda, c.tip::text AS tip,
            p.denumire AS produs, p.cod_sku,
            m.cod AS marime, m.cod_numeric AS marime_numerica, e.pozitie,
            cc.cantitate AS cerut,
            coalesce(sum(r.cantitate), 0)::int AS intrat,
            greatest(cc.cantitate - coalesce(sum(r.cantitate), 0), 0)::int AS lipsesc,
            greatest(coalesce(sum(r.cantitate), 0) - cc.cantitate, 0)::int AS peste,
            coalesce(bool_or(r.inchide_pozitia), false) AS inchisa,
            max(mo.nume) FILTER (WHERE r.inchide_pozitia) AS motiv_inchidere
       FROM eticheta e
       JOIN comanda_linie cl     ON cl.id = e.linie_id
       JOIN comanda c            ON c.id  = cl.comanda_id
       JOIN produs p             ON p.id  = cl.produs_id
       JOIN marime m             ON m.id  = e.marime_id
       JOIN comanda_cantitate cc ON cc.linie_id = e.linie_id AND cc.marime_id = e.marime_id
       LEFT JOIN receptie r      ON r.eticheta_id = e.id
       LEFT JOIN motiv mo        ON mo.id = r.motiv_id
      WHERE e.id = $1
      GROUP BY e.id, e.cod, c.numar, c.tip, p.denumire, p.cod_sku,
               m.cod, m.cod_numeric, e.pozitie, cc.cantitate`,
    [e.id],
  );
  return p ?? null;
}

function faraId({ eticheta_id: _, ...p }: PozitieScanata & { eticheta_id: string }): PozitieScanata {
  return p;
}

export async function pozitiaEtichetei(codBrut: string): Promise<PozitieScanata | null> {
  const cod = normalizeazaCod(codBrut);
  if (!cod) return null;
  return caFirma(firmaCurenta(), async (c) => {
    const p = await citestePozitia(c, cod, false);
    return p && faraId(p);
  });
}

/** Doar motivele care au sens la recepție, nu cele de croit. */
export async function motiveReceptie(): Promise<Motiv[]> {
  return caFirma(firmaCurenta(), async (c) =>
    (await c.query<Motiv>(
      `SELECT id, nume FROM motiv
        WHERE activ AND 'receptie' = ANY (contexte)
        ORDER BY nume`,
    )).rows,
  );
}

export type CerereReceptie = {
  cod: string;
  cantitate: number;
  motivId: string | null;
  inchide: boolean;
  observatii?: string;
};

export type RezultatReceptie =
  | { ok: true; pozitie: PozitieScanata }
  | { ok: false; eroare: string; pozitie?: PozitieScanata };

/**
 * Înregistrează ce a intrat pe o etichetă.
 *
 * Regulile stau aici, nu în ecran, pentru că ecranul nu e singurul drum: mâine
 * vine un scanner de bandă sau un import. Telefonul doar le arată mai devreme.
 *
 * - Peste cantitatea cerută se poate: atelierul trimite uneori bucăți în plus,
 *   iar ele există fizic în depozit. Ecranul cere confirmarea explicit, pentru
 *   că a doua scanare a aceleiași etichete arată exact la fel.
 * - Mai puțin decât lipsește e o livrare parțială: poziția rămâne de stins până
 *   vine restul. Doar închiderea ei („restul nu mai vine") cere motiv.
 * - Zero bucăți doar ca închidere, cu motiv și observații (vezi 0005).
 * - O poziție închisă nu mai primește nimic.
 */
export async function inregistreazaReceptie(cerere: CerereReceptie): Promise<RezultatReceptie> {
  const cod = normalizeazaCod(cerere.cod);
  const cantitate = cerere.cantitate;
  const observatii = cerere.observatii?.trim() || null;

  return caFirma(firmaCurenta(), async (c) => {
    const p = await citestePozitia(c, cod, true);
    if (!p) return { ok: false, eroare: `Eticheta ${cod} nu există sau a fost anulată.` };

    const pozitie = faraId(p);
    if (p.inchisa) return { ok: false, eroare: 'Poziția e deja închisă.', pozitie };
    if (!Number.isInteger(cantitate) || cantitate < 0) {
      return { ok: false, eroare: 'Cantitatea trebuie să fie un număr întreg.', pozitie };
    }

    const sub = cantitate < p.lipsesc;
    const inchide = sub && cerere.inchide;
    if (cantitate === 0 && !inchide) {
      return { ok: false, eroare: 'Zero bucăți se poate doar dacă închizi poziția.', pozitie };
    }
    if (cantitate === 0 && !observatii) {
      return { ok: false, eroare: 'Scrie la observații de ce se închide pe zero.', pozitie };
    }
    if (inchide && !cerere.motivId) {
      return { ok: false, eroare: 'Alege motivul pentru care se închide poziția.', pozitie };
    }

    if (inchide && cerere.motivId) {
      const { rowCount } = await c.query(
        `SELECT 1 FROM motiv WHERE id = $1 AND activ AND 'receptie' = ANY (contexte)`,
        [cerere.motivId],
      );
      if (!rowCount) return { ok: false, eroare: 'Motivul ales nu e valabil la recepție.', pozitie };
    }

    await c.query(
      `INSERT INTO receptie (firma_id, eticheta_id, cantitate, motiv_id, inchide_pozitia, observatii)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5)`,
      [p.eticheta_id, cantitate, inchide ? cerere.motivId : null, inchide, observatii],
    );
    await stingeDacaE(c, p.eticheta_id);

    const dupa = await citestePozitia(c, cod, false);
    return { ok: true, pozitie: faraId(dupa!) };
  });
}

/**
 * O comandă cu toate pozițiile stinse — intrate integral sau închise — se închide
 * singură și trece la „finalizate".
 */
export async function stingeDacaE(c: PoolClient, etichetaId: string): Promise<void> {
  await c.query(
    `UPDATE comanda c SET stare = 'inchisa'
      WHERE c.id = (SELECT cl.comanda_id FROM eticheta e JOIN comanda_linie cl ON cl.id = e.linie_id WHERE e.id = $1)
        AND c.stare NOT IN ('inchisa', 'anulata')
        AND NOT EXISTS (
            SELECT 1 FROM comanda_cantitate cc JOIN comanda_linie cl ON cl.id = cc.linie_id
             WHERE cl.comanda_id = c.id
               AND NOT coalesce((SELECT bool_or(r.inchide_pozitia) OR sum(r.cantitate) >= cc.cantitate
                                   FROM eticheta e JOIN receptie r ON r.eticheta_id = e.id
                                  WHERE e.linie_id = cc.linie_id AND e.marime_id = cc.marime_id), false))`,
    [etichetaId]);
}
