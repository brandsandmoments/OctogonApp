import type { PoolClient } from 'pg';
import { extractText, getDocumentProxy } from 'unpdf';
import { caFirma, type Context } from './db';
import { firmaCurenta, interogare } from './sesiune';

/**
 * Extrasele de cont și potrivirea lor cu banii așteptați.
 *
 * Extrasul Banca Transilvania (PDF) se citește tranzacție cu tranzacție: ziua, tipul
 * („Incasare OP", „Plata OP intra"…), descrierea, REF-ul și suma. Încasările sunt
 * credit, restul debit; la fiecare zi, sumele citite se verifică cu „RULAJ ZI" din
 * extras, ca să nu scape nimic.
 *
 * Apoi fiecare încasare de la Fan Courier se potrivește cu un lot de rambursuri (un lot
 * Fan = un ordin de plată), iar fiecare încasare Stripe cu un virament Shopify Payments:
 * aceeași sumă, la cel mult 7 zile după.
 */

export type TranzactieBanca = { zi: string; sens: 'credit' | 'debit'; suma: number; tip: string; descriere: string; ref: string | null; sursa: string | null };
export type Extras = { cont: string; de: string | null; pana: string | null; tranzactii: TranzactieBanca[]; zile: number; zileVerificate: number; diferente: string[] };

// Capul unei tranzacții: tipul, fără „;" (descrierile au), eventual cu suma la capăt.
const TIP = /^(Incasare|Plata|Transfer|Comision|Retragere|Depunere|Taxa|Dobanda|Schimb valutar|Pachet|Abonament|Tranzactie|Alimentare|Rambursare|Ridicare)\b/;
const BANI = /^-?[\d,]+\.\d{2}$/;
const bani = (s: string) => Number(s.replace(/,/g, ''));
const rotund = (n: number) => Math.round(n * 100) / 100;

const sursa = (sens: string, text: string) => {
  if (sens !== 'credit') return null;
  if (/FAN COURIER/i.test(text)) return 'fan';
  if (/GLS General/i.test(text)) return 'gls';
  if (/STRIPE|SHOPIFY/i.test(text)) return 'shopify';
  return null;
};

export function citesteTextBT(text: string): Extras {
  const cont = /Cod IBAN:\s*(RO\w+)/.exec(text)?.[1] ?? 'necunoscut';
  // Antetul fiecărei pagini, până la capul tabelului, nu face parte din tranzacții.
  const t = text.replace(/=== PAGINA \d+[\s\S]*?Data Descriere Debit Credit\n/g, '');
  const tranzactii: (TranzactieBanca & { linii: string[] })[] = [];
  let zi: string | null = null;
  let cur: (TranzactieBanca & { linii: string[]; areSuma: boolean }) | null = null;
  for (let l of t.split('\n').map((x) => x.trim()).filter(Boolean)) {
    const d = /^(\d{2})\/(\d{2})\/(\d{4})\s+(.*)$/.exec(l);
    if (d) { zi = `${d[3]}-${d[2]}-${d[1]}`; l = d[4]; }
    if (/^(RULAJ ZI|SOLD FINAL|SOLD ANTERIOR|RULAJ TOTAL|TOTAL)/.test(l)) { cur = null; continue; }
    if (zi && TIP.test(l) && !l.includes(';')) {
      const m = /^(.*?)\s+(-?[\d,]+\.\d{2})$/.exec(l);
      const tip = m ? m[1] : l;
      cur = { zi, sens: /^Incasare/.test(tip) ? 'credit' : 'debit', suma: m ? bani(m[2]) : 0, areSuma: Boolean(m), tip, descriere: '', ref: null, sursa: null, linii: [] };
      tranzactii.push(cur);
      continue;
    }
    if (!cur) continue;
    if (BANI.test(l)) { if (!cur.areSuma) { cur.suma = bani(l); cur.areSuma = true; } continue; }
    const r = /^REF:\s*(\S+)/.exec(l);
    if (r) { cur.ref = r[1]; continue; }
    cur.linii.push(l);
  }
  const gata = tranzactii.map(({ linii, ...x }) => {
    const descriere = linii.join(' ');
    return { ...x, descriere, sursa: sursa(x.sens, descriere) } as TranzactieBanca;
  });
  // Verificarea cu rulajul zilei: debitul și creditul citite trebuie să dea exact cât scrie banca.
  const rulaj = [...t.matchAll(/(\d{2})\/(\d{2})\/(\d{4}) RULAJ ZI ([\d,]+\.\d{2}) ([\d,]+\.\d{2})/g)];
  const diferente: string[] = [];
  for (const m of rulaj) {
    const z = `${m[3]}-${m[2]}-${m[1]}`;
    const suma = (sens: string) => rotund(gata.filter((x) => x.zi === z && x.sens === sens).reduce((s, x) => s + x.suma, 0));
    const [debit, credit] = [bani(m[4]), bani(m[5])];
    if (Math.abs(suma('debit') - debit) > 0.005 || Math.abs(suma('credit') - credit) > 0.005) {
      diferente.push(`${z}: banca ${debit} / ${credit}, citit ${suma('debit')} / ${suma('credit')}`);
    }
  }
  const zile = gata.map((x) => x.zi).sort();
  return { cont, de: zile[0] ?? null, pana: zile[zile.length - 1] ?? null, tranzactii: gata, zile: rulaj.length, zileVerificate: rulaj.length - diferente.length, diferente };
}

export async function citesteExtrasPdf(bytes: Uint8Array): Promise<Extras> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return citesteTextBT(text.map((p, i) => `=== PAGINA ${i + 1}\n${p}`).join('\n'));
}

/**
 * Încasările nepotrivite, cu ce așteptăm: lotul Fan (suma rambursurilor lui) sau
 * viramentul Shopify Payments cu exact aceeași sumă, virat cu 0–7 zile înainte.
 * Se potrivește cel mai apropiat în timp, fiecare o singură dată.
 */
export async function potrivesteBanca(c: PoolClient): Promise<number> {
  const { rows: incasari } = await c.query<{ id: string; zi: string; suma: number; sursa: string }>(
    `SELECT id, to_char(zi, 'YYYY-MM-DD') AS zi, suma::float AS suma, sursa FROM banca_tranzactie
      WHERE sens = 'credit' AND sursa IN ('fan', 'shopify') AND potrivit IS NULL ORDER BY zi`);
  if (incasari.length === 0) return 0;
  const { rows: asteptate } = await c.query<{ cheie: string; sursa: string; zi: string; suma: number }>(
    `SELECT 'fan:' || lot AS cheie, 'fan' AS sursa, to_char(max(virat_zi), 'YYYY-MM-DD') AS zi, sum(suma)::float AS suma
       FROM ramburs_virat WHERE lot IS NOT NULL GROUP BY lot
     UNION ALL
     SELECT 'card:' || id, 'shopify', to_char(data AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD'), net::float FROM card_virament`);
  const folosite = new Set((await c.query<{ potrivit: string }>(`SELECT potrivit FROM banca_tranzactie WHERE potrivit IS NOT NULL`)).rows.map((r) => r.potrivit));
  const zile = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;
  let n = 0;
  for (const inc of incasari) {
    const cand = asteptate
      .filter((a) => a.sursa === inc.sursa && !folosite.has(a.cheie) && Math.abs(a.suma - inc.suma) < 0.005 && zile(inc.zi, a.zi) >= 0 && zile(inc.zi, a.zi) <= 7)
      .sort((x, y) => zile(inc.zi, x.zi) - zile(inc.zi, y.zi))[0];
    if (!cand) continue;
    folosite.add(cand.cheie);
    await c.query(`UPDATE banca_tranzactie SET potrivit = $2 WHERE id = $1`, [inc.id, cand.cheie]);
    n++;
  }
  return n;
}

export type RezultatImport = Extras & { noi: number; potrivite: number };

/**
 * Salvează extrasul (tranzacțiile deja importate se sar) și potrivește încasările.
 * Firma e a omului logat; scripturile de pe server o dau din mediu.
 */
export async function importaExtras(bytes: Uint8Array, firma: string | Context | Promise<Context> = firmaCurenta()): Promise<RezultatImport> {
  const e = await citesteExtrasPdf(bytes);
  return caFirma(firma, async (c) => {
    let noi = 0;
    for (const t of e.tranzactii) {
      const r = await c.query(
        `INSERT INTO banca_tranzactie (firma_id, cont, zi, sens, suma, tip, descriere, ref, sursa)
         VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
        [e.cont, t.zi, t.sens, t.suma, t.tip, t.descriere, t.ref, t.sursa]);
      noi += r.rowCount ?? 0;
    }
    return { ...e, noi, potrivite: await potrivesteBanca(c) };
  });
}

// ---------------------------------------------------------------- pentru pagină

export type BancaSursa = { sursa: string; incasari: number; suma: number; potrivite: number; suma_potrivita: number };
export type BancaNepotrivita = { zi: string; sursa: string; suma: number; descriere: string | null };
export type Neajuns = { sursa: string; cheie: string; zi: string; suma: number; magazin: string | null };

/** Banii ajunși în bancă în perioadă, pe sursă, și ce s-a potrivit. */
export async function banca(de: string, pana: string) {
  const [surse, nepotrivite, neajunse, extrase] = await Promise.all([
    interogare<BancaSursa>(
      `SELECT sursa, count(*)::int AS incasari, sum(suma)::float AS suma, count(potrivit)::int AS potrivite,
              coalesce(sum(suma) FILTER (WHERE potrivit IS NOT NULL), 0)::float AS suma_potrivita
         FROM banca_tranzactie WHERE sens = 'credit' AND sursa IS NOT NULL AND zi BETWEEN $1::date AND $2::date
        GROUP BY sursa ORDER BY sursa`, [de, pana]),
    interogare<BancaNepotrivita>(
      `SELECT to_char(zi, 'YYYY-MM-DD') AS zi, sursa, suma::float AS suma, descriere FROM banca_tranzactie
        WHERE sens = 'credit' AND sursa IS NOT NULL AND potrivit IS NULL AND zi BETWEEN $1::date AND $2::date ORDER BY zi`, [de, pana]),
    // Loturi Fan și viramente card din perioadă care n-au ajuns (încă) în extrasele importate.
    interogare<Neajuns>(
      `WITH acoperit AS (SELECT max(zi) AS pana FROM banca_tranzactie)
       SELECT 'fan' AS sursa, l.lot AS cheie, to_char(l.zi, 'YYYY-MM-DD') AS zi, l.suma::float AS suma, NULL AS magazin
         FROM (SELECT lot, max(virat_zi) AS zi, sum(suma) AS suma FROM ramburs_virat WHERE lot IS NOT NULL GROUP BY lot) l, acoperit
        WHERE l.zi BETWEEN $1::date AND least($2::date, acoperit.pana - 3)
          AND NOT EXISTS (SELECT 1 FROM banca_tranzactie b WHERE b.potrivit = 'fan:' || l.lot)
       UNION ALL
       SELECT 'shopify', v.id, to_char(v.data AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD'), v.net::float, br.nume
         FROM card_virament v JOIN magazin m ON m.id = v.magazin_id JOIN brand br ON br.id = m.brand_id, acoperit
        WHERE v.stare = 'PAID' AND (v.data AT TIME ZONE 'Europe/Bucharest')::date BETWEEN $1::date AND least($2::date, acoperit.pana - 5)
          AND NOT EXISTS (SELECT 1 FROM banca_tranzactie b WHERE b.potrivit = 'card:' || v.id)
       ORDER BY 3`, [de, pana]),
    interogare<{ cont: string; de: string; pana: string; tranzactii: number }>(
      `SELECT cont, to_char(min(zi), 'DD.MM.YYYY') AS de, to_char(max(zi), 'DD.MM.YYYY') AS pana, count(*)::int AS tranzactii
         FROM banca_tranzactie GROUP BY cont ORDER BY cont`),
  ]);
  return { surse, nepotrivite, neajunse, extrase };
}
