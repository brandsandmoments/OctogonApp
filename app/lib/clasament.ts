import { interogare } from './sesiune';
import { PONDERE_SQL } from './dificultate';

/**
 * Clasamentul oamenilor din producție pe o perioadă, după puncte: bucățile înmulțite cu gradul de
 * dificultate (ușor ×1, mediu ×1,5, greu ×2) — al taierii la croit, al omului pe fază în producție.
 * Mai târziu, minute-normă pe model.
 *
 * Croit: bucățile croite ale fiecărei taieri se împart egal între oamenii unei operații (întins,
 * tăiat, separat, termocolat) — doi tăietori pe o taiere de 40 buc primesc câte 20. Ziua e a
 * operației (când s-a terminat, altfel când a început).
 *
 * Producție: bucățile ieșite din lucru în perioadă se împart egal între oamenii trecuți pe aceeași
 * fază a comenzii („Cine lucrează"); unde oamenii sunt trecuți pe tranșă, pe tranșa aceea.
 */

export type RandCroit = { operatie: string; om: string; bucati: number; puncte: number; taieri: number };
export type RandProductie = { faza: string; om: string; bucati: number; puncte: number; comenzi: number };
export type ComandaFaraOameni = { numar: string; produs: string; bucati: number };

export async function clasamentCroit(de: string, pana: string): Promise<RandCroit[]> {
  return interogare<RandCroit>(
    `WITH buc AS (
         SELECT lc.taiere_id, sum(le.cantitate)::numeric AS q, ${PONDERE_SQL('t.dificultate')} AS p
           FROM lot_croit lc JOIN lot_croit_efectiv le ON le.lot_id = lc.id JOIN taiere t ON t.id = lc.taiere_id
          WHERE lc.croit_la IS NOT NULL GROUP BY lc.taiere_id, t.dificultate),
     op AS (
         -- Un om o dată pe operația unei taieri, oricâte rânduri ar avea (a lucrat în mai multe reprize).
         SELECT o.taiere_id, o.operatie::text AS operatie, coalesce(o.angajat_id, o.operator_id) AS cine,
                coalesce(a.nume, u.nume) AS om, max(coalesce(o.terminat_la, o.inceput_la)) AS la
           FROM taiere_operatie o LEFT JOIN angajat a ON a.id = o.angajat_id LEFT JOIN utilizator u ON u.id = o.operator_id
          WHERE coalesce(o.angajat_id, o.operator_id) IS NOT NULL
          GROUP BY 1, 2, 3, 4),
     cati AS (SELECT taiere_id, operatie, count(*) AS n FROM op GROUP BY 1, 2)
     SELECT op.operatie, op.om, round(sum(b.q / cati.n), 1)::float AS bucati, round(sum(b.q * b.p / cati.n), 1)::float AS puncte,
            count(DISTINCT op.taiere_id)::int AS taieri
       FROM op JOIN cati USING (taiere_id, operatie) JOIN buc b ON b.taiere_id = op.taiere_id
      WHERE (op.la AT TIME ZONE 'Europe/Bucharest')::date BETWEEN $1::date AND $2::date
      GROUP BY op.operatie, op.cine, op.om
      ORDER BY op.operatie, puncte DESC, bucati DESC, op.om`, [de, pana]);
}

const IESITE = `
     iesit AS (
         SELECT ab.id AS transa, cl.comanda_id, sum(ac.cantitate)::numeric AS q
           FROM alimentare_banda ab JOIN alimentare_cantitate ac ON ac.alimentare_id = ab.id
           JOIN lot_croit lc ON lc.id = ab.lot_id JOIN planificare pl ON pl.id = lc.planificare_id
           JOIN comanda_linie cl ON cl.id = pl.linie_id
          WHERE ab.iesit_productie_la IS NOT NULL
            AND (ab.iesit_productie_la AT TIME ZONE 'Europe/Bucharest')::date BETWEEN $1::date AND $2::date
          GROUP BY ab.id, cl.comanda_id)`;

export async function clasamentProductie(de: string, pana: string): Promise<RandProductie[]> {
  return interogare<RandProductie>(
    `WITH ${IESITE},
     pe_comanda AS (SELECT comanda_id, sum(q) AS q FROM iesit GROUP BY 1),
     ac AS (SELECT comanda_id, btrim(faza) AS faza, angajat_id, max(dificultate) AS dificultate FROM alocare_comanda GROUP BY 1, 2, 3),
     nc AS (SELECT comanda_id, faza, count(*) AS n FROM ac GROUP BY 1, 2),
     din_comanda AS (
         SELECT ac.angajat_id, ac.faza, pc.q / nc.n AS q, pc.q / nc.n * ${PONDERE_SQL('ac.dificultate')} AS p, ac.comanda_id
           FROM ac JOIN nc USING (comanda_id, faza) JOIN pe_comanda pc USING (comanda_id)),
     ao AS (SELECT alimentare_id, btrim(faza) AS faza, angajat_id, max(dificultate) AS dificultate FROM alocare_operatie GROUP BY 1, 2, 3),
     no AS (SELECT alimentare_id, faza, count(*) AS n FROM ao GROUP BY 1, 2),
     din_transa AS (
         -- Oamenii trecuți pe tranșă (banda veche), dacă nu sunt deja pe aceeași fază a comenzii.
         SELECT ao.angajat_id, ao.faza, i.q / no.n AS q, i.q / no.n * ${PONDERE_SQL('ao.dificultate')} AS p, i.comanda_id
           FROM ao JOIN no USING (alimentare_id, faza) JOIN iesit i ON i.transa = ao.alimentare_id
          WHERE NOT EXISTS (SELECT 1 FROM ac WHERE ac.comanda_id = i.comanda_id AND ac.faza = ao.faza AND ac.angajat_id = ao.angajat_id))
     SELECT t.faza, a.nume AS om, round(sum(t.q), 1)::float AS bucati, round(sum(t.p), 1)::float AS puncte, count(DISTINCT t.comanda_id)::int AS comenzi
       FROM (SELECT * FROM din_comanda UNION ALL SELECT * FROM din_transa) t JOIN angajat a ON a.id = t.angajat_id
      GROUP BY t.faza, t.angajat_id, a.nume
      ORDER BY t.faza, puncte DESC, bucati DESC, a.nume`, [de, pana]);
}

/** Comenzile cu bucăți ieșite din lucru în perioadă, dar fără niciun om trecut la „Cine lucrează". */
export async function comenziFaraOameni(de: string, pana: string): Promise<ComandaFaraOameni[]> {
  return interogare<ComandaFaraOameni>(
    `WITH ${IESITE}
     SELECT c.numar, string_agg(DISTINCT p.denumire, ', ') AS produs, sum(i.q)::int AS bucati
       FROM iesit i JOIN comanda c ON c.id = i.comanda_id
       JOIN comanda_linie cl ON cl.comanda_id = c.id JOIN produs p ON p.id = cl.produs_id
      WHERE NOT EXISTS (SELECT 1 FROM alocare_comanda x WHERE x.comanda_id = i.comanda_id)
        AND NOT EXISTS (SELECT 1 FROM alocare_operatie x WHERE x.alimentare_id = i.transa)
      GROUP BY c.numar ORDER BY bucati DESC`, [de, pana]);
}
