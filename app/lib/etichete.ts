import type { PoolClient } from 'pg';
import { caFirma } from './db';
import { firmaCurenta } from './sesiune';
import { serialNou } from './coduri';

export type EtichetaDeTiparit = {
  cod: string;
  comanda: string;
  tip: string;
  produs: string;
  cod_sku: string;
  marime: string;
  marime_numerica: string | null;
  cerut: number;
  pozitie: number;
  din: number;
};

/**
 * Emite etichetele unei comenzi: una pentru fiecare poziție, adică pentru fiecare
 * combinație de linie și mărime cu cantitate cerută.
 *
 * Se poate rula de mai multe ori. Pozițiile care au deja etichetă nu primesc alta:
 * un cod emis o dată rămâne valabil până la capătul comenzii, chiar dacă marfa
 * vine în cinci tranșe sau dacă cineva retipărește coala pentru că s-a pătat.
 */
export async function emiteEtichete(comanda: string): Promise<number> {
  return caFirma(firmaCurenta(), async (c: PoolClient) => {
    const lipsa = await c.query<{ linie_id: string; marime_id: string; ordine: number }>(
      `SELECT cc.linie_id, cc.marime_id, m.ordine
         FROM comanda_cantitate cc
         JOIN comanda_linie cl ON cl.id = cc.linie_id
         JOIN comanda c        ON c.id  = cl.comanda_id
         JOIN produs p         ON p.id  = cl.produs_id
         JOIN marime m         ON m.id  = cc.marime_id
         LEFT JOIN eticheta e  ON e.linie_id = cc.linie_id AND e.marime_id = cc.marime_id
        WHERE c.numar = $1 AND e.id IS NULL
        ORDER BY p.denumire, m.ordine`,
      [comanda],
    );
    if (lipsa.rows.length === 0) return 0;

    // Poziția continuă numerotarea existentă, ca retipărirea să nu renumeroteze
    // etichetele deja lipite pe marfă.
    const { rows: [{ maxim }] } = await c.query<{ maxim: number }>(
      `SELECT coalesce(max(e.pozitie), 0)::int AS maxim
         FROM eticheta e
         JOIN comanda_linie cl ON cl.id = e.linie_id
         JOIN comanda c        ON c.id  = cl.comanda_id
        WHERE c.numar = $1`,
      [comanda],
    );

    let pozitie = maxim;
    for (const r of lipsa.rows) {
      pozitie += 1;
      // Serialul e unic global. Coliziunea e improbabilă (32^7 combinații), dar
      // nu imposibilă, iar o etichetă duplicată ar credita marfa comenzii greșite.
      // Indexul unic o prinde; aici doar mai încercăm o dată.
      for (let incercare = 0; ; incercare++) {
        try {
          await c.query(
            `INSERT INTO eticheta (firma_id, cod, linie_id, marime_id, pozitie, tiparita_la)
             VALUES (firma_curenta(), $1, $2, $3, $4, now())`,
            [serialNou(), r.linie_id, r.marime_id, pozitie],
          );
          break;
        } catch (e) {
          const cod = (e as { code?: string }).code;
          if (cod !== '23505' || incercare >= 5) throw e;
        }
      }
    }
    return lipsa.rows.length;
  });
}

/**
 * Etichetele unei comenzi, în ordinea în care se tipăresc.
 *
 * `din` e cel mai mare număr de poziție emis, nu numărul de etichete: dacă una
 * a fost anulată, numerotarea celorlalte rămâne cea lipită pe marfă, iar
 * „poziția 4 din 5" continuă să fie adevărat. Cu numărul de etichete, ar fi
 * scris „poziția 4 din 3".
 */
export async function etichetele(comanda: string): Promise<EtichetaDeTiparit[]> {
  return caFirma(firmaCurenta(), async (c: PoolClient) => {
    const { rows } = await c.query<EtichetaDeTiparit>(
      `SELECT e.cod, c.numar AS comanda, c.tip::text AS tip,
              p.denumire AS produs, p.cod_sku,
              m.cod AS marime, m.cod_numeric AS marime_numerica,
              cc.cantitate AS cerut, e.pozitie,
              max(e.pozitie) OVER ()::int AS din
         FROM eticheta e
         JOIN comanda_linie cl    ON cl.id = e.linie_id
         JOIN comanda c           ON c.id  = cl.comanda_id
         JOIN produs p            ON p.id  = cl.produs_id
         JOIN marime m            ON m.id  = e.marime_id
         JOIN comanda_cantitate cc ON cc.linie_id = e.linie_id AND cc.marime_id = e.marime_id
        WHERE c.numar = $1 AND e.anulata_la IS NULL
        ORDER BY e.pozitie`,
      [comanda],
    );
    return rows;
  });
}
