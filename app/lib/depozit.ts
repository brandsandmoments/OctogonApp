import { caFirma } from './db';
import { emite } from './etichete';
import { motivLiber } from './motive';
import { stingeDacaE } from './receptie';
import { firmaCurenta, interogare } from './sesiune';

/**
 * Depozitul de produse finite: PSF-urile și PSC-urile care se așteaptă și se
 * sting pe măsură ce vin — prin scanarea etichetei sau scriind de mână câte au
 * venit azi. O comandă rămâne „de stins" până intră tot sau până se închide, cu
 * motiv și observații. Totul se calculează din recepții (receptie), ca la scanare.
 */

export type VedereDepozit = 'de_stins' | 'finalizate' | 'toate';

export type ComandaDepozit = {
  numar: string;
  tip: string;
  brand: string;
  kam: string | null;
  lansata: string;
  termen: string | null;          // cea mai apropiată dată cerută din liniile ei
  cerut: number;
  intrat: number;
  lipsesc: number;
  pozitii: number;
  pozitii_stinse: number;
  ultima_intrare: string | null;
  finalizata: boolean;
  produse: string;
};

const POZITII = `
  SELECT cc.linie_id, cc.marime_id, cl.comanda_id, cc.cantitate AS cerut,
         coalesce(sum(r.cantitate), 0)::int AS intrat,
         coalesce(bool_or(r.inchide_pozitia), false) AS inchisa,
         max(r.scanat_la) AS ultima
    FROM comanda_cantitate cc
    JOIN comanda_linie cl ON cl.id = cc.linie_id
    LEFT JOIN eticheta e  ON e.linie_id = cc.linie_id AND e.marime_id = cc.marime_id
    LEFT JOIN receptie r  ON r.eticheta_id = e.id
   GROUP BY cc.linie_id, cc.marime_id, cl.comanda_id, cc.cantitate`;

/** Comenzile, cu cât s-a cerut, cât a intrat și cât lipsește. Finalizată = toate pozițiile stinse, sau comanda închisă. */
export async function comenziDepozit(vedere: VedereDepozit): Promise<ComandaDepozit[]> {
  const toate = await interogare<ComandaDepozit>(
    `WITH p AS (${POZITII})
     SELECT c.numar, c.tip::text AS tip, b.nume AS brand, k.nume AS kam,
            to_char(c.data_lansare, 'YYYY-MM-DD') AS lansata,
            (SELECT to_char(min(data_ceruta), 'YYYY-MM-DD') FROM comanda_linie WHERE comanda_id = c.id) AS termen,
            sum(p.cerut)::int AS cerut, sum(p.intrat)::int AS intrat,
            sum(CASE WHEN p.inchisa THEN 0 ELSE greatest(p.cerut - p.intrat, 0) END)::int AS lipsesc,
            count(*)::int AS pozitii,
            count(*) FILTER (WHERE p.inchisa OR p.intrat >= p.cerut)::int AS pozitii_stinse,
            to_char(max(p.ultima) AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD') AS ultima_intrare,
            (c.stare = 'inchisa' OR bool_and(p.inchisa OR p.intrat >= p.cerut)) AS finalizata,
            (SELECT string_agg(pr.denumire || ' ' || pr.cod_sku, ' ') FROM comanda_linie cl JOIN produs pr ON pr.id = cl.produs_id
              WHERE cl.comanda_id = c.id) AS produse
       FROM comanda c
       JOIN brand b           ON b.id = c.brand_id
       LEFT JOIN utilizator k ON k.id = c.kam_id
       JOIN p                 ON p.comanda_id = c.id
      WHERE c.stare NOT IN ('ciorna', 'anulata')
      GROUP BY c.id, c.numar, c.tip, b.nume, k.nume, c.data_lansare, c.stare
      ORDER BY termen NULLS LAST, c.numar`,
  );
  return toate.filter((c) => vedere === 'toate' || (vedere === 'finalizate') === c.finalizata);
}

export type PozitieDepozit = {
  linie_id: string;
  marime_id: string;
  produs: string;
  cod_sku: string;
  data_ceruta: string;
  marime: string;
  cerut: number;
  intrat: number;
  inchisa: boolean;
  motiv: string | null;
};

export type DetaliiComandaDepozit = {
  comanda: ComandaDepozit & { id: string; stare: string };
  pozitii: PozitieDepozit[];
  intrari: { la: string; cine: string | null; produs: string; marime: string; cantitate: number;
             motiv: string | null; observatii: string | null; inchide: boolean }[];
};

export async function comandaDepozit(numar: string): Promise<DetaliiComandaDepozit | null> {
  const [comanda] = (await comenziDepozit('toate')).filter((c) => c.numar === numar);
  if (!comanda) return null;
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [{ id, stare }] } = await c.query<{ id: string; stare: string }>(
      `SELECT id, stare::text FROM comanda WHERE numar = $1`, [numar]);
    const { rows: pozitii } = await c.query<PozitieDepozit>(
      `WITH p AS (${POZITII})
       SELECT p.linie_id, p.marime_id, pr.denumire AS produs, pr.cod_sku,
              to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta, m.cod AS marime,
              p.cerut, p.intrat, p.inchisa,
              (SELECT mo.nume FROM eticheta e JOIN receptie r ON r.eticheta_id = e.id JOIN motiv mo ON mo.id = r.motiv_id
                WHERE e.linie_id = p.linie_id AND e.marime_id = p.marime_id AND r.inchide_pozitia LIMIT 1) AS motiv
         FROM p
         JOIN comanda_linie cl ON cl.id = p.linie_id
         JOIN produs pr        ON pr.id = cl.produs_id
         JOIN marime m         ON m.id = p.marime_id
        WHERE p.comanda_id = $1
        ORDER BY pr.denumire, m.ordine`, [id]);
    const { rows: intrari } = await c.query<DetaliiComandaDepozit['intrari'][number]>(
      `SELECT to_char(r.scanat_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI') AS la, u.nume AS cine,
              pr.denumire AS produs, m.cod AS marime, r.cantitate, mo.nume AS motiv, r.observatii,
              r.inchide_pozitia AS inchide
         FROM receptie r
         JOIN eticheta e       ON e.id = r.eticheta_id
         JOIN comanda_linie cl ON cl.id = e.linie_id
         JOIN produs pr        ON pr.id = cl.produs_id
         JOIN marime m         ON m.id = e.marime_id
         LEFT JOIN utilizator u ON u.id = r.scanat_de
         LEFT JOIN motiv mo    ON mo.id = r.motiv_id
        WHERE cl.comanda_id = $1
        ORDER BY r.scanat_la DESC`, [id]);
    return { comanda: { ...comanda, id, stare }, pozitii, intrari };
  });
}

/**
 * Intrarea de mână: câte au venit azi pe fiecare poziție, fără scanare. Pozițiile
 * fără etichetă își primesc eticheta acum — recepția stă pe etichetă, ca la scanare.
 * O livrare parțială lasă poziția de stins; peste cerut se poate, ca la scanare.
 */
export async function intrareManuala(numar: string, cantitati: Map<string, number>, observatii: string): Promise<string | null> {
  const alese = [...cantitati].filter(([, q]) => q !== 0);
  if (alese.length === 0) return 'Scrie câte au venit.';
  for (const [, q] of alese) if (!Number.isInteger(q) || q < 0) return 'Cantitățile sunt numere întregi.';
  return caFirma(firmaCurenta(), async (c) => {
    await c.query(`SELECT 1 FROM comanda WHERE numar = $1 FOR UPDATE`, [numar]);
    await emite(c, numar);
    let ultima = '';
    for (const [cheie, q] of alese) {
      const [linie, marime] = cheie.split(':');
      const { rows: [e] } = await c.query<{ id: string; inchisa: boolean }>(
        `SELECT e.id, EXISTS (SELECT 1 FROM receptie r WHERE r.eticheta_id = e.id AND r.inchide_pozitia) AS inchisa
           FROM eticheta e WHERE e.linie_id = $1 AND e.marime_id = $2 AND e.anulata_la IS NULL`, [linie, marime]);
      if (!e) throw new Error('Poziție fără etichetă după emitere.');
      if (e.inchisa) continue;
      await c.query(
        `INSERT INTO receptie (firma_id, eticheta_id, cantitate, inchide_pozitia, observatii)
         VALUES (firma_curenta(), $1, $2, false, nullif($3, ''))`, [e.id, q, observatii.trim()]);
      ultima = e.id;
    }
    if (ultima) await stingeDacaE(c, ultima);
    return null;
  });
}

/**
 * Stinge comanda la un clic: ce n-a venit nu mai vine. Fiecare poziție încă
 * deschisă se închide pe zero, cu motivul și observațiile date; comanda trece la
 * finalizate.
 */
export async function stingeComanda(numar: string, motivText: string, obs: string): Promise<string | null> {
  if (!motivText.trim()) return 'Scrie motivul: din listă sau cu vorbele tale.';
  return caFirma(firmaCurenta(), async (c) => {
    const { motivId, observatii } = (await motivLiber(c, motivText, 'receptie', obs))!;
    const { rows: [cm] } = await c.query<{ id: string }>(
      `SELECT id FROM comanda WHERE numar = $1 AND stare NOT IN ('anulata', 'inchisa') FOR UPDATE`, [numar]);
    if (!cm) return 'Comanda e deja stinsă.';
    await emite(c, numar);
    await c.query(
      `INSERT INTO receptie (firma_id, eticheta_id, cantitate, motiv_id, inchide_pozitia, observatii)
       SELECT firma_curenta(), e.id, 0, $2, true, $3
         FROM eticheta e
         JOIN comanda_linie cl     ON cl.id = e.linie_id
         JOIN comanda_cantitate cc ON cc.linie_id = e.linie_id AND cc.marime_id = e.marime_id
        WHERE cl.comanda_id = $1 AND e.anulata_la IS NULL
          AND NOT EXISTS (SELECT 1 FROM receptie r WHERE r.eticheta_id = e.id AND r.inchide_pozitia)
          AND coalesce((SELECT sum(r.cantitate) FROM receptie r WHERE r.eticheta_id = e.id), 0) < cc.cantitate`,
      [cm.id, motivId, observatii.trim()]);
    await c.query(`UPDATE comanda SET stare = 'inchisa' WHERE id = $1`, [cm.id]);
    return null;
  });
}
