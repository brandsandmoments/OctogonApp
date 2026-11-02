import { dePeDrum, peDrum } from './acoperire';
import { interogare } from './sesiune';

/**
 * PSF-urile date de KAM-i care așteaptă aprobarea. Lângă fiecare mărime, ce ajută la
 * decizie: stocul din magazinul brandului, cât s-a vândut în 30 de zile și ce e deja
 * în producție — ca un PSF să nu ceară ce vine oricum.
 */

export type MarimeDeAprobat = { marime: string; cantitate: number; stoc: number; v30: number; in_productie: number };
export type PsfDeAprobat = {
  numar: string; brand: string; kam: string | null; creata: string; observatii: string | null;
  linii: { produs: string; data_ceruta: string; vanzare: string | null; marimi: MarimeDeAprobat[] }[];
};

export async function psfDeAprobat(): Promise<PsfDeAprobat[]> {
  const [randuri, drum] = await Promise.all([
    interogare<{
      numar: string; brand: string; kam: string | null; creata: string; observatii: string | null; linie_id: string;
      produs: string; produs_id: string; marime_id: string; data_ceruta: string; vanzare: string | null;
      marime: string; ordine: number; cantitate: number; stoc: number; v30: number;
    }>(
      `SELECT c.numar, b.nume AS brand, k.nume AS kam, to_char(c.data_lansare, 'YYYY-MM-DD') AS creata, c.observatii,
              cl.id AS linie_id, p.denumire AS produs, cl.produs_id, cc.marime_id, to_char(cl.data_ceruta, 'YYYY-MM-DD') AS data_ceruta,
              CASE WHEN cl.vanzare_de_la IS NOT NULL THEN to_char(cl.vanzare_de_la, 'DD.MM') || ' – ' || to_char(cl.vanzare_pana_la, 'DD.MM') END AS vanzare,
              m.cod AS marime, m.ordine, cc.cantitate,
              coalesce((SELECT sum(greatest(v.stoc_fizic, 0)) FROM magazin_varianta v JOIN magazin mg ON mg.id = v.magazin_id
                         WHERE mg.brand_id = c.brand_id AND v.produs_id = cl.produs_id AND v.marime_id = cc.marime_id), 0)::int AS stoc,
              coalesce((SELECT sum(z.cantitate) FROM vanzare z
                         WHERE z.produs_id = cl.produs_id AND z.marime_id = cc.marime_id AND z.data >= now() - interval '30 days'), 0)::int AS v30
         FROM comanda c
         JOIN brand b              ON b.id = c.brand_id
         LEFT JOIN utilizator k    ON k.id = c.kam_id
         JOIN comanda_linie cl     ON cl.comanda_id = c.id
         JOIN produs p             ON p.id = cl.produs_id
         JOIN comanda_cantitate cc ON cc.linie_id = cl.id
         JOIN marime m             ON m.id = cc.marime_id
        WHERE c.stare = 'de_aprobat'
        ORDER BY c.data_lansare, c.numar, p.denumire, m.ordine`),
    peDrum(),
  ]);
  const comenzi = new Map<string, PsfDeAprobat>();
  for (const r of randuri) {
    const c = comenzi.get(r.numar) ?? { numar: r.numar, brand: r.brand, kam: r.kam, creata: r.creata, observatii: r.observatii, linii: [] };
    let l = c.linii.find((x) => x.produs === r.produs);
    if (!l) { l = { produs: r.produs, data_ceruta: r.data_ceruta, vanzare: r.vanzare, marimi: [] }; c.linii.push(l); }
    l.marimi.push({ marime: r.marime, cantitate: r.cantitate, stoc: r.stoc, v30: r.v30, in_productie: dePeDrum(drum, r.produs_id, r.marime_id).in_productie });
    comenzi.set(r.numar, c);
  }
  return [...comenzi.values()];
}

export async function aprobaPsf(numar: string, cine: string): Promise<string | null> {
  const r = await interogare<{ id: string }>(
    `UPDATE comanda SET stare = 'lansata', aprobata_de = $2, aprobata_la = now()
      WHERE numar = $1 AND stare = 'de_aprobat' RETURNING id`, [numar, cine]);
  if (!r.length) return 'PSF-ul nu mai așteaptă aprobarea (poate l-a aprobat altcineva).';
  // Aprobat, pleacă direct la croit.
  await interogare(`SELECT planifica_automat($1)`, [r[0].id]);
  return null;
}

export async function respingePsf(numar: string, motiv: string, cine: string): Promise<string | null> {
  if (!motiv.trim()) return 'Scrie de ce îl respingi: KAM-ul vede motivul.';
  const r = await interogare(
    `UPDATE comanda SET stare = 'anulata', aprobata_de = $3, aprobata_la = now(), motiv_respingere = $2
      WHERE numar = $1 AND stare = 'de_aprobat' RETURNING id`, [numar, motiv.trim(), cine]);
  return r.length ? null : 'PSF-ul nu mai așteaptă aprobarea (poate l-a aprobat altcineva).';
}
