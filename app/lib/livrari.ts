import { interogare } from './sesiune';

/**
 * Coletele la curier, pe o zi: ce a ridicat curierul, ce s-a livrat, ce a fost
 * refuzat și ce nu s-a livrat (retur) — plus ce e încă pe drum și AWB-urile generate
 * pe care curierul nu le-a ridicat încă. Zilele se socotesc la ora României.
 */

export type Colet = {
  magazin_id: string; magazin: string; comanda: string; comandata: string; client: string | null; telefon: string | null;
  oras: string | null; produse: string; bucati: number; curier: string | null; awb: string | null; urmarire: string | null;
  stare: string; motiv: string | null; awb_la: string; ridicat_la: string | null; livrat_la: string | null; esuat_la: string | null;
  ora: string | null;          // ora evenimentului din lista în care apare
  zile: number | null;         // de câte zile e la curier / de când s-a generat AWB-ul
};

export type ZiLivrari = { ridicate: Colet[]; livrate: Colet[]; refuzate: Colet[]; nelivrate: Colet[]; pe_drum: Colet[]; neridicate: Colet[] };

const CAMPURI = `
  l.magazin_id, b.nume AS magazin, l.comanda, to_char(l.comandata_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM') AS comandata,
  l.client, l.telefon, l.oras, l.produse, l.bucati, l.curier, l.awb, l.urmarire, l.stare, l.motiv,
  to_char(l.awb_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI') AS awb_la,
  to_char(l.ridicat_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI') AS ridicat_la,
  to_char(l.livrat_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI') AS livrat_la,
  to_char(l.esuat_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI') AS esuat_la`;

export async function livrariPeZi(zi: string, magazinId?: string): Promise<ZiLivrari> {
  const randuri = await interogare<Colet & { lista: keyof ZiLivrari }>(
    `WITH l AS (SELECT * FROM magazin_livrare WHERE ($2::uuid IS NULL OR magazin_id = $2) AND stare <> 'anulat'),
          z AS (SELECT $1::date AS zi)
     SELECT 'ridicate' AS lista, ${CAMPURI}, to_char(l.ridicat_la AT TIME ZONE 'Europe/Bucharest', 'HH24:MI') AS ora, NULL::int AS zile
       FROM l JOIN magazin m ON m.id = l.magazin_id JOIN brand b ON b.id = m.brand_id, z
      WHERE (l.ridicat_la AT TIME ZONE 'Europe/Bucharest')::date = z.zi
     UNION ALL
     SELECT 'livrate', ${CAMPURI}, to_char(l.livrat_la AT TIME ZONE 'Europe/Bucharest', 'HH24:MI'),
            floor(extract(epoch FROM l.livrat_la - coalesce(l.ridicat_la, l.awb_la)) / 86400)::int
       FROM l JOIN magazin m ON m.id = l.magazin_id JOIN brand b ON b.id = m.brand_id, z
      WHERE l.stare = 'livrat' AND (l.livrat_la AT TIME ZONE 'Europe/Bucharest')::date = z.zi
     UNION ALL
     SELECT CASE WHEN l.stare = 'refuzat' THEN 'refuzate' ELSE 'nelivrate' END, ${CAMPURI},
            to_char(l.esuat_la AT TIME ZONE 'Europe/Bucharest', 'HH24:MI'), NULL
       FROM l JOIN magazin m ON m.id = l.magazin_id JOIN brand b ON b.id = m.brand_id, z
      WHERE l.stare IN ('refuzat', 'nelivrat') AND (l.esuat_la AT TIME ZONE 'Europe/Bucharest')::date = z.zi
     UNION ALL
     SELECT 'pe_drum', ${CAMPURI}, NULL, (now()::date - (l.ridicat_la AT TIME ZONE 'Europe/Bucharest')::date)
       FROM l JOIN magazin m ON m.id = l.magazin_id JOIN brand b ON b.id = m.brand_id
      WHERE l.stare IN ('in_tranzit', 'in_livrare')
     UNION ALL
     SELECT 'neridicate', ${CAMPURI}, NULL, (now()::date - (l.awb_la AT TIME ZONE 'Europe/Bucharest')::date)
       FROM l JOIN magazin m ON m.id = l.magazin_id JOIN brand b ON b.id = m.brand_id
      WHERE l.stare = 'awb' AND l.awb_la > now() - interval '30 days'
     ORDER BY 1, 2, ora NULLS LAST, zile DESC NULLS LAST`, [zi, magazinId ?? null]);
  const z: ZiLivrari = { ridicate: [], livrate: [], refuzate: [], nelivrate: [], pe_drum: [], neridicate: [] };
  for (const { lista, ...c } of randuri) z[lista].push(c);
  return z;
}

export type ColetGasit = Colet & { in_livrare_la: string | null };

/**
 * Căutarea unui colet, oricând ar fi plecat: după numărul comenzii, numele clientului,
 * telefon (doar cifrele contează: „0745 199 011" găsește și „+40745199011"), AWB sau
 * produs. Cele mai noi întâi.
 */
export async function cautaColete(text: string, magazinId?: string): Promise<ColetGasit[]> {
  const t = text.trim();
  if (t.length < 2) return [];
  const cifre = t.replace(/\D/g, '');
  return interogare<ColetGasit>(
    `SELECT ${CAMPURI}, to_char(l.in_livrare_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI') AS in_livrare_la,
            NULL::text AS ora, NULL::int AS zile
       FROM magazin_livrare l JOIN magazin m ON m.id = l.magazin_id JOIN brand b ON b.id = m.brand_id
      WHERE ($2::uuid IS NULL OR l.magazin_id = $2)
        AND (l.comanda ILIKE '%' || $1 || '%' OR l.client ILIKE '%' || $1 || '%' OR l.awb ILIKE '%' || $1 || '%'
             OR l.produse ILIKE '%' || $1 || '%'
             OR (length($3) >= 4 AND right(regexp_replace(coalesce(l.telefon, ''), '\\D', '', 'g'), 9) LIKE '%' || right($3, 9) || '%'))
      ORDER BY l.awb_la DESC
      LIMIT 100`, [t, magazinId ?? null, cifre]);
}
