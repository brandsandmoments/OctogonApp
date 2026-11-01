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

export type Propunere = { tip: 'PSF' | 'PSC'; brand_id: string; produs: string; linie: LinieNoua; rezumat: string };

/**
 * Propunerea de comandă pentru un produs (model × culoare), pornită din produse sau
 * din alerte. Pe fiecare mărime, din cerere se scad stocul din magazinele brandului și
 * tot ce e pe drum (în producție sau de aprobat):
 *
 * - PSF: cererea e o lună de vânzări (ultimele 30 de zile); termen în depozit peste
 *   21 de zile, perioada de vânzare o lună de atunci;
 * - PSC: cererea e ce așteaptă clienții pe comenzile deschise; termen peste 14 zile.
 *
 * Omul vede propunerea în formularul de comandă și schimbă ce vrea.
 */
export async function propunere(produsId: string, tip: 'PSF' | 'PSC'): Promise<Propunere | null> {
  const [[p], marimi] = await Promise.all([
    interogare<{ brand_id: string; produs: string }>(`SELECT brand_id, denumire AS produs FROM produs WHERE id = $1`, [produsId]),
    stocPentruProdus(produsId),
  ]);
  if (!p) return null;
  const zi = (zile: number) => new Date(Date.now() + zile * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' });
  const cantitati: Record<string, number> = {};
  const tot = { stoc: 0, v30: 0, drum: 0, asteapta: 0 };
  for (const [marime, m] of Object.entries(marimi)) {
    tot.stoc += m.stoc; tot.v30 += m.v30; tot.drum += m.drum; tot.asteapta += m.asteapta;
    const q = (tip === 'PSF' ? m.v30 : m.asteapta) - m.stoc - m.drum;
    if (q > 0) cantitati[marime] = q;
  }
  return {
    tip, ...p,
    linie: tip === 'PSF'
      ? { produsId, dataCeruta: zi(21), vanzareDeLa: zi(21), vanzarePanaLa: zi(51), cantitati }
      : { produsId, dataCeruta: zi(14), vanzareDeLa: '', vanzarePanaLa: '', cantitati },
    rezumat: `${p.produs}: stoc ${tot.stoc} buc în magazine, vândut ${tot.v30} în 30 de zile, ${tot.asteapta} așteaptă pe comenzi deschise, `
      + `${tot.drum} deja pe drum (în producție sau de aprobat).`,
  };
}

export type StocMarime = { stoc: number; v30: number; drum: number; asteapta: number };

/**
 * Pentru formularul de comandă: pe fiecare mărime a unui produs, stocul fizic din
 * magazinele brandului, vânzările din 30 de zile, ce e deja pe drum (în producție sau
 * de aprobat) și cât așteaptă clienții pe comenzi deschise. Omul vede asta lângă
 * cantitatea pe care o scrie.
 */
export async function stocPentruProdus(produsId: string): Promise<Record<string, StocMarime>> {
  const [randuri, drum] = await Promise.all([
    interogare<{ marime_id: string; stoc: number; v30: number; asteapta: number }>(
      `SELECT mz.id AS marime_id,
              coalesce((SELECT sum(greatest(v.stoc_fizic, 0)) FROM magazin_varianta v WHERE v.produs_id = $1 AND v.marime_id = mz.id), 0)::int AS stoc,
              coalesce((SELECT sum(z.cantitate) FROM vanzare z WHERE z.produs_id = $1 AND z.marime_id = mz.id
                                                               AND z.data >= now() - interval '30 days'), 0)::int AS v30,
              coalesce((SELECT sum(l.de_livrat) FROM magazin_comanda_linie l
                          JOIN magazin_varianta v ON v.varianta_gid = l.varianta_gid
                          JOIN magazin_comanda mc ON mc.id = l.comanda_id AND mc.magazin_id = v.magazin_id
                         WHERE v.produs_id = $1 AND v.marime_id = mz.id AND l.de_livrat > 0), 0)::int AS asteapta
         FROM marime mz`, [produsId]),
    peDrum(),
  ]);
  return Object.fromEntries(randuri.map((r) => {
    const d = dePeDrum(drum, produsId, r.marime_id);
    return [r.marime_id, { stoc: r.stoc, v30: r.v30, asteapta: r.asteapta, drum: d.in_productie + d.de_aprobat }];
  }));
}
