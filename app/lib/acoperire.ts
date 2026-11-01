import type { LinieNoua } from './comenzi';
import { interogare } from './sesiune';

/**
 * Ce e deja pe drum, pe produs și mărime, ca să nu comandăm de două ori aceleași
 * bucăți: PSC-urile și PSF-urile lansate sau în producție, minus ce a intrat deja în
 * depozit pe ele (pozițiile închise nu mai aduc nimic), plus PSF-urile care așteaptă
 * aprobarea. Orice propunere de PSC sau PSF scade din cerere stocul și tot ce e aici.
 */

export type PeDrum = { in_productie: number; de_aprobat: number };

const cheie = (produs: string, marime: string) => `${produs}|${marime}`;

export async function peDrum(): Promise<Map<string, PeDrum>> {
  const randuri = await interogare<{ produs_id: string; marime_id: string; in_productie: number; de_aprobat: number }>(
    `SELECT cl.produs_id, cc.marime_id,
            sum(CASE WHEN c.stare IN ('lansata', 'in_productie') THEN greatest(cc.cantitate - coalesce(r.intrat, 0), 0) ELSE 0 END)::int AS in_productie,
            sum(CASE WHEN c.stare = 'de_aprobat' THEN cc.cantitate ELSE 0 END)::int AS de_aprobat
       FROM comanda c
       JOIN comanda_linie cl     ON cl.comanda_id = c.id
       JOIN comanda_cantitate cc ON cc.linie_id = cl.id
       LEFT JOIN LATERAL (
         SELECT sum(rc.cantitate)::int AS intrat, bool_or(rc.inchide_pozitia) AS inchisa
           FROM eticheta e JOIN receptie rc ON rc.eticheta_id = e.id
          WHERE e.linie_id = cc.linie_id AND e.marime_id = cc.marime_id) r ON true
      WHERE c.stare IN ('lansata', 'in_productie', 'de_aprobat') AND NOT coalesce(r.inchisa, false)
      GROUP BY cl.produs_id, cc.marime_id`);
  return new Map(randuri.map((r) => [cheie(r.produs_id, r.marime_id), { in_productie: r.in_productie, de_aprobat: r.de_aprobat }]));
}

export const dePeDrum = (m: Map<string, PeDrum>, produs: string | null, marime: string | null): PeDrum =>
  (produs && marime && m.get(cheie(produs, marime))) || { in_productie: 0, de_aprobat: 0 };

export type PropunerePsf = { brand_id: string; produs: string; linie: LinieNoua; rezumat: string };

/**
 * Propunerea de PSF pentru un produs (model × culoare), pornită din alerte: pe fiecare
 * mărime, cât s-a vândut în 30 de zile în magazinele brandului — o lună de vânzări —
 * minus stocul din magazine, ce e în producție și ce așteaptă aprobarea. Termenul în
 * depozit peste 21 de zile, perioada de vânzare o lună de atunci. KAM-ul schimbă tot.
 */
export async function propunerePsf(produsId: string): Promise<PropunerePsf | null> {
  const [randuri, drum] = await Promise.all([
    interogare<{ brand_id: string; produs: string; marime_id: string; stoc: number; v30: number }>(
      `SELECT p.brand_id, p.denumire AS produs, mz.id AS marime_id,
              coalesce((SELECT sum(greatest(v.stoc_fizic, 0)) FROM magazin_varianta v WHERE v.produs_id = p.id AND v.marime_id = mz.id), 0)::int AS stoc,
              coalesce((SELECT sum(z.cantitate) FROM vanzare z WHERE z.produs_id = p.id AND z.marime_id = mz.id
                                                               AND z.data >= now() - interval '30 days'), 0)::int AS v30
         FROM produs p CROSS JOIN marime mz
        WHERE p.id = $1 AND EXISTS (SELECT 1 FROM magazin_varianta v WHERE v.produs_id = p.id AND v.marime_id = mz.id)
        ORDER BY mz.ordine`, [produsId]),
    peDrum(),
  ]);
  if (randuri.length === 0) return null;
  const zi = (zile: number) => new Date(Date.now() + zile * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' });
  const cantitati: Record<string, number> = {};
  let stoc = 0, v30 = 0, drumTot = 0;
  for (const r of randuri) {
    const d = dePeDrum(drum, produsId, r.marime_id);
    stoc += r.stoc; v30 += r.v30; drumTot += d.in_productie + d.de_aprobat;
    const q = r.v30 - r.stoc - d.in_productie - d.de_aprobat;
    if (q > 0) cantitati[r.marime_id] = q;
  }
  return {
    brand_id: randuri[0].brand_id, produs: randuri[0].produs,
    linie: { produsId, dataCeruta: zi(21), vanzareDeLa: zi(21), vanzarePanaLa: zi(51), cantitati },
    rezumat: `${randuri[0].produs}: stoc ${stoc} buc în magazine, vândut ${v30} în 30 de zile, ${drumTot} deja pe drum (în producție sau de aprobat).`,
  };
}
