import { caFirma } from './db';
import { firmaCurenta, interogare } from './sesiune';
import { rangMarime } from './format';
import { alimenteaza } from './banda';
import { adaugaZileLucratoare } from './timp';

/**
 * Dashboard-ul de producție: comenzile din care s-a croit ceva și n-au ieșit încă
 * toate gata. Pe fiecare culoare, mărimile — cerut, croit, dat în lucru, ieșit gata —
 * și, chiar alături, ce intră acum în lucru. Pe comandă: minutele pe bucată (ale
 * modelului), câți oameni lucrează (de aici, ziua estimată de gata) și cine pe ce fază.
 */

export type MarimeProd = { marime_id: string; marime: string; cerut: number; croit: number; dat: number; gata: number; de_dat: number };
export type CuloareProd = { linie_id: string; produs: string; data_ceruta: string; marimi: MarimeProd[]; cerut: number; croit: number; dat: number; gata: number; de_dat: number };
export type AlocareProd = { id: string; faza: string; utilaj: string | null; om: string };
export type ComandaProd = {
  comanda_id: string; numar: string; tip: string; brand: string; prioritate: number; kam: string | null;
  model: string; model_ids: string[]; timp_min_buc: number | null; oameni: number | null; data_ceruta: string;
  culori: CuloareProd[]; croit: number; dat: number; gata: number; de_dat: number; in_lucru: number;
  alocari: AlocareProd[]; faze_model: string[];
};

type Rand = {
  comanda_id: string; numar: string; tip: string; brand: string; prioritate: number; kam: string | null; oameni: number | null;
  linie_id: string; produs: string; model_id: string | null; model: string; timp_min_buc: number | null; data_ceruta: string;
  marime_id: string; marime: string; cerut: number; croit: number; dat: number; gata: number;
};

export async function comenziInProductie(): Promise<ComandaProd[]> {
  const randuri = await interogare<Rand>(
    `WITH croit AS (
         SELECT pl.linie_id, le.marime_id, sum(le.cantitate)::int AS q
           FROM planificare pl JOIN lot_croit lc ON lc.planificare_id = pl.id
           JOIN lot_croit_efectiv le ON le.lot_id = lc.id GROUP BY 1, 2),
     dat AS (
         SELECT pl.linie_id, ac.marime_id, sum(ac.cantitate)::int AS q,
                sum(ac.cantitate) FILTER (WHERE ab.iesit_productie_la IS NOT NULL)::int AS gata
           FROM planificare pl JOIN lot_croit lc ON lc.planificare_id = pl.id
           JOIN alimentare_banda ab ON ab.lot_id = lc.id
           JOIN alimentare_cantitate ac ON ac.alimentare_id = ab.id GROUP BY 1, 2),
     comenzi AS (
         -- s-a croit ceva și mai e ceva de dat în lucru sau ceva în lucru
         SELECT DISTINCT cl.comanda_id FROM comanda_linie cl
           JOIN croit cr ON cr.linie_id = cl.id
           LEFT JOIN dat d ON d.linie_id = cl.id AND d.marime_id = cr.marime_id
          WHERE cr.q > coalesce(d.q, 0) OR coalesce(d.q, 0) > coalesce(d.gata, 0))
     SELECT c.id AS comanda_id, c.numar, c.tip::text AS tip, b.nume AS brand, c.prioritate, k.nume AS kam, c.oameni_productie AS oameni,
            cl.id AS linie_id, p.denumire AS produs, p.model_id, coalesce(mo.denumire, p.denumire) AS model,
            mo.timp_min_buc::float AS timp_min_buc, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
            cc.marime_id, m.cod AS marime, cc.cantitate AS cerut,
            coalesce(cr.q, 0) AS croit, coalesce(d.q, 0) AS dat, coalesce(d.gata, 0) AS gata
       FROM comenzi x
       JOIN comanda c            ON c.id = x.comanda_id
       JOIN brand b              ON b.id = c.brand_id
       LEFT JOIN utilizator k    ON k.id = c.kam_id
       JOIN comanda_linie cl     ON cl.comanda_id = c.id
       JOIN produs p             ON p.id = cl.produs_id
       LEFT JOIN model mo        ON mo.id = p.model_id
       JOIN comanda_cantitate cc ON cc.linie_id = cl.id
       JOIN marime m             ON m.id = cc.marime_id
       LEFT JOIN croit cr ON cr.linie_id = cl.id AND cr.marime_id = cc.marime_id
       LEFT JOIN dat d    ON d.linie_id = cl.id AND d.marime_id = cc.marime_id
      ORDER BY c.tip DESC, c.numar, p.denumire`);
  const ids = [...new Set(randuri.map((r) => r.comanda_id))];
  const [alocari, faze] = await Promise.all([
    interogare<AlocareProd & { comanda_id: string }>(
      `SELECT x.id, x.comanda_id, x.faza, x.utilaj, a.nume AS om FROM alocare_comanda x JOIN angajat a ON a.id = x.angajat_id
        WHERE x.comanda_id = ANY ($1::uuid[]) ORDER BY x.creat_la`, [ids]),
    interogare<{ model_id: string; denumire: string }>(
      `SELECT model_id, denumire FROM model_operatie WHERE model_id = ANY ($1::uuid[]) ORDER BY ordine`,
      [[...new Set(randuri.map((r) => r.model_id).filter(Boolean))]]),
  ]);

  const pe = new Map<string, ComandaProd>();
  const linii = new Map<string, CuloareProd>();
  for (const r of randuri) {
    let c = pe.get(r.comanda_id);
    if (!c) {
      c = { comanda_id: r.comanda_id, numar: r.numar, tip: r.tip, brand: r.brand, prioritate: r.prioritate, kam: r.kam,
            model: r.model, model_ids: [], timp_min_buc: r.timp_min_buc, oameni: r.oameni, data_ceruta: r.data_ceruta,
            culori: [], croit: 0, dat: 0, gata: 0, de_dat: 0, in_lucru: 0,
            alocari: alocari.filter((a) => a.comanda_id === r.comanda_id).map(({ comanda_id: _, ...a }) => a), faze_model: [] };
      pe.set(r.comanda_id, c);
    }
    if (r.model_id && !c.model_ids.includes(r.model_id)) c.model_ids.push(r.model_id);
    if (!c.model.split(', ').includes(r.model)) c.model += `, ${r.model}`;
    if (r.data_ceruta < c.data_ceruta) c.data_ceruta = r.data_ceruta;
    let l = linii.get(r.linie_id);
    if (!l) {
      l = { linie_id: r.linie_id, produs: r.produs, data_ceruta: r.data_ceruta, marimi: [], cerut: 0, croit: 0, dat: 0, gata: 0, de_dat: 0 };
      linii.set(r.linie_id, l);
      c.culori.push(l);
    }
    const de_dat = Math.max(0, r.croit - r.dat);
    l.marimi.push({ marime_id: r.marime_id, marime: r.marime, cerut: r.cerut, croit: r.croit, dat: r.dat, gata: r.gata, de_dat });
    l.cerut += r.cerut; l.croit += r.croit; l.dat += r.dat; l.gata += r.gata; l.de_dat += de_dat;
    c.croit += r.croit; c.dat += r.dat; c.gata += r.gata; c.de_dat += de_dat; c.in_lucru += r.dat - r.gata;
  }
  for (const c of pe.values()) {
    for (const l of c.culori) l.marimi.sort((a, b) => rangMarime(a.marime) - rangMarime(b.marime));
    c.faze_model = [...new Set(faze.filter((f) => c.model_ids.includes(f.model_id)).map((f) => f.denumire))];
  }
  return [...pe.values()];
}

/** Ziua estimată de gata: bucățile rămase × minute pe bucată, împărțite la oameni și la orele pe zi, în zile lucrătoare de azi. */
export function gataEstimat(c: ComandaProd, orePeZi: number, azi: string): string | null {
  if (!c.timp_min_buc || !c.oameni) return null;
  const ramase = Math.max(0, c.culori.reduce((s, l) => s + l.cerut, 0) - c.gata);
  const zile = Math.max(1, Math.ceil((ramase * c.timp_min_buc / 60) / (c.oameni * orePeZi)));
  return adaugaZileLucratoare(azi, zile);
}

/**
 * Dă în lucru o culoare: bucățile scrise pe mărimi, luate din loturile ei croite în
 * ordine (întâi cel mai vechi). Fiecare lot atins devine o tranșă care intră acum în lucru.
 */
export async function daInLucruCuloare(linieId: string, cantitati: Map<string, number>): Promise<string | null> {
  if (![...cantitati.values()].some((q) => q > 0)) return 'Scrie câte bucăți intră în lucru (sau „Tot").';
  if ([...cantitati.values()].some((q) => !Number.isInteger(q) || q < 0)) return 'Bucățile trebuie să fie numere întregi.';
  const loturi = await interogare<{ lot_id: string; marime_id: string; rest: number }>(
    `SELECT ra.lot_id, ra.marime_id, ra.rest FROM lot_rest_de_alimentat ra
       JOIN lot_croit lc ON lc.id = ra.lot_id JOIN planificare pl ON pl.id = lc.planificare_id
      WHERE pl.linie_id = $1 AND ra.rest > 0 ORDER BY lc.croit_la, lc.numar_lot`, [linieId]);
  const ramas = new Map(cantitati);
  const peLot = new Map<string, Map<string, number>>();
  for (const r of loturi) {
    const vreau = ramas.get(r.marime_id) ?? 0;
    if (vreau <= 0) continue;
    const q = Math.min(vreau, r.rest);
    peLot.set(r.lot_id, (peLot.get(r.lot_id) ?? new Map()).set(r.marime_id, q));
    ramas.set(r.marime_id, vreau - q);
  }
  if ([...ramas.values()].some((q) => q > 0)) return 'Ai scris mai mult decât s-a croit și n-a intrat încă în lucru.';
  for (const [lotId, q] of peLot) {
    const r = await alimenteaza({ lotId, cantitati: q, persoane: null, timpMinBuc: null, responsabil: '', observatii: '' });
    if ('eroare' in r) return r.eroare;
    await interogare(`UPDATE alimentare_banda SET intrat_productie_la = now() WHERE id = $1`, [r.id]);
  }
  return null;
}

/** Minutele pe bucată (pe modelele comenzii) și câți oameni lucrează la comandă. */
export async function salveazaTimpOameni(comandaId: string, minute: number | null, oameni: number | null): Promise<string | null> {
  if (minute !== null && !(minute > 0)) return 'Minutele pe bucată trebuie să fie mai mari ca zero.';
  if (oameni !== null && !(Number.isInteger(oameni) && oameni > 0)) return 'Numărul de oameni trebuie să fie întreg, mai mare ca zero.';
  await caFirma(firmaCurenta(), async (c) => {
    await c.query(`UPDATE comanda SET oameni_productie = $2 WHERE id = $1`, [comandaId, oameni]);
    if (minute !== null) {
      await c.query(
        `UPDATE model SET timp_min_buc = $2 WHERE id IN (
           SELECT p.model_id FROM comanda_linie cl JOIN produs p ON p.id = cl.produs_id WHERE cl.comanda_id = $1 AND p.model_id IS NOT NULL)`,
        [comandaId, minute]);
    }
  });
  return null;
}

export async function adaugaAlocareComanda(comandaId: string, faza: string, utilaj: string, angajatId: string): Promise<string | null> {
  if (!faza.trim()) return 'Scrie faza (sau alege-o din listă).';
  if (!angajatId) return 'Alege omul.';
  await interogare(
    `INSERT INTO alocare_comanda (firma_id, comanda_id, faza, utilaj, angajat_id) VALUES (firma_curenta(), $1, $2, nullif($3, ''), $4)`,
    [comandaId, faza.trim(), utilaj.trim(), angajatId]);
  return null;
}

export async function stergeAlocareComanda(id: string): Promise<void> {
  await interogare(`DELETE FROM alocare_comanda WHERE id = $1`, [id]);
}
