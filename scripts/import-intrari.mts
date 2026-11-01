/**
 * Intrările în depozit din dashboard (fila INTRARI_DEPOZIT), ca recepții pe
 * eticheta poziției: ce a intrat efectiv, pe ce PSF sau PSC, în ce zi.
 *
 *   npm run import:intrari -- <dashboard.xlsx>
 *
 * Fiecare rând cu comandă devine o recepție pe linia comenzii (după produs) și pe
 * mărime, cu data scanării din sheet. Pozițiile fără etichetă își primesc eticheta
 * întâi, ca la scanare. Comenzile care au primit tot se sting, ca la scanare.
 *
 * Se poate rula din nou: rândul își poartă ID-ul („dashboard INT-2026-001") în
 * observațiile recepției și nu se mai adaugă a doua oară. Ce nu se poate potrivi
 * (stoc fără comandă, o comandă care nu e în aplicație, o mărime necomandată) se
 * raportează la final, nu se pierde în tăcere.
 */
import ExcelJS from 'exceljs';
import type { PoolClient } from 'pg';
import { caFirma, firmaDinMediu } from '../app/lib/db.ts';
import { serialNou } from '../app/lib/coduri.ts';

type Celula = string | number | null;

function valoare(v: ExcelJS.CellValue): Celula {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return valoare(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    return null;
  }
  if (typeof v === 'boolean') return null;
  const t = typeof v === 'string' ? v.trim() : v;
  return t === '' ? null : t;
}

function data(v: Celula): string | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  }
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/**
 * Etichetele care lipsesc pe pozițiile comenzii, numerotate în continuarea celor
 * existente — ca emiterea din aplicație (app/lib/etichete.ts), pe care scripturile
 * nu o pot importa (importurile ei sunt fără extensie, pentru Next).
 */
async function emite(c: PoolClient, comandaId: string): Promise<number> {
  const { rows: lipsa } = await c.query<{ linie_id: string; marime_id: string }>(
    `SELECT cc.linie_id, cc.marime_id
       FROM comanda_cantitate cc
       JOIN comanda_linie cl ON cl.id = cc.linie_id
       JOIN produs p         ON p.id  = cl.produs_id
       JOIN marime m         ON m.id  = cc.marime_id
       LEFT JOIN eticheta e  ON e.linie_id = cc.linie_id AND e.marime_id = cc.marime_id
      WHERE cl.comanda_id = $1 AND e.id IS NULL
      ORDER BY p.denumire, m.ordine`, [comandaId]);
  const { rows: [{ maxim }] } = await c.query<{ maxim: number }>(
    `SELECT coalesce(max(e.pozitie), 0)::int AS maxim FROM eticheta e JOIN comanda_linie cl ON cl.id = e.linie_id
      WHERE cl.comanda_id = $1`, [comandaId]);
  let pozitie = maxim;
  for (const r of lipsa) {
    await c.query(
      `INSERT INTO eticheta (firma_id, cod, linie_id, marime_id, pozitie, tiparita_la)
       VALUES (firma_curenta(), $1, $2, $3, $4, now())`, [serialNou(), r.linie_id, r.marime_id, ++pozitie]);
  }
  return lipsa.length;
}

/** Comanda la care a intrat tot (sau s-a închis fiecare poziție) se stinge, ca la scanare (app/lib/receptie.ts). */
async function stingeDacaE(c: PoolClient, comandaId: string): Promise<void> {
  await c.query(
    `UPDATE comanda c SET stare = 'inchisa'
      WHERE c.id = $1 AND c.stare NOT IN ('inchisa', 'anulata')
        AND NOT EXISTS (
            SELECT 1 FROM comanda_cantitate cc JOIN comanda_linie cl ON cl.id = cc.linie_id
             WHERE cl.comanda_id = c.id
               AND NOT coalesce((SELECT bool_or(r.inchide_pozitia) OR sum(r.cantitate) >= cc.cantitate
                                   FROM eticheta e JOIN receptie r ON r.eticheta_id = e.id
                                  WHERE e.linie_id = cc.linie_id AND e.marime_id = cc.marime_id), false))`,
    [comandaId]);
}

const raport: string[] = [];
const contor: Record<string, number> = {};
const numara = (k: string, n = 1) => (contor[k] = (contor[k] ?? 0) + n);

type Linie = { linie_id: string; comanda_id: string; produs: string; cod_sku: string };

async function importa(c: PoolClient, wb: ExcelJS.Workbook) {
  const ws = wb.getWorksheet('INTRARI_DEPOZIT');
  if (!ws) throw new Error('Lipsește fila INTRARI_DEPOZIT');
  const antet = new Map<string, number>();
  ws.getRow(2).eachCell((cell, col) => {
    const t = valoare(cell.value);
    if (typeof t === 'string') antet.set(t, col);
  });
  const col = (nume: string) => {
    const i = [...antet].find(([k]) => k.startsWith(nume))?.[1];
    if (i === undefined) throw new Error(`Fila INTRARI_DEPOZIT nu are coloana „${nume}"`);
    return i;
  };
  const C = {
    id: col('ID Intrare'), zi: col('Data scan'), ora: col('Ora scan'), tip: col('Tip comanda'),
    comanda: col('ID comanda sursa'), produs: col('Produs / Model'), marime: col('Marime'), cant: col('Cantitate intrata'),
  };

  const marimi = new Map((await c.query<{ id: string; cod: string; cod_numeric: string | null }>(
    `SELECT id, cod, cod_numeric FROM marime`)).rows.flatMap((m) =>
    [[m.cod.toLowerCase(), m.id], ...(m.cod_numeric ? [[m.cod_numeric.toLowerCase(), m.id]] : [])] as [string, string][]));
  const deja = new Set((await c.query<{ id: string }>(
    `SELECT substring(observatii from '^dashboard (INT-[^ ]+)') AS id FROM receptie WHERE observatii LIKE 'dashboard INT-%'`)).rows.map((r) => r.id));
  const liniiComenzii = new Map<string, Linie[]>();
  const etichetate = new Set<string>();
  const atinse = new Map<string, string>(); // număr → id-ul comenzii, pentru stingere

  for (let nr = 3; nr <= ws.rowCount; nr++) {
    const row = ws.getRow(nr);
    const v = (i: number) => valoare(row.getCell(i).value);
    const id = v(C.id) == null ? null : String(v(C.id));
    if (!id) continue;
    numara('rânduri citite');
    if (deja.has(id)) { numara('deja importate'); continue; }
    const tip = String(v(C.tip) ?? '');
    const numar = v(C.comanda) == null ? null : String(v(C.comanda)).toLowerCase();
    if (!/^PS[FC]$/i.test(tip) || !numar) { numara('stoc fără comandă (sărite)'); continue; }
    const zi = data(v(C.zi));
    const cant = Number(v(C.cant));
    if (!zi || !Number.isInteger(cant) || cant <= 0) {
      raport.push(`${id} (rândul ${nr}): dată sau cantitate lipsă/greșită — sărit`);
      continue;
    }
    // Cheia Shopify („shopify:2026-09-17:MSLL-COSTUMELISE-NEGRU-M") stă într-o coloană fără antet.
    let sku: string | null = null;
    row.eachCell((cell) => {
      const t = valoare(cell.value);
      const m = typeof t === 'string' ? /^shopify:\d{4}-\d{2}-\d{2}:(.+)$/.exec(t) : null;
      if (m) sku = m[1].toUpperCase();
    });

    if (!liniiComenzii.has(numar)) {
      liniiComenzii.set(numar, (await c.query<Linie>(
        `SELECT cl.id AS linie_id, co.id AS comanda_id, p.denumire AS produs, upper(p.cod_sku) AS cod_sku
           FROM comanda_linie cl JOIN comanda co ON co.id = cl.comanda_id JOIN produs p ON p.id = cl.produs_id
          WHERE lower(co.numar) = $1`, [numar])).rows);
    }
    const linii = liniiComenzii.get(numar)!;
    if (linii.length === 0) {
      raport.push(`${id}: comanda „${numar}" nu e în aplicație — sărit`);
      numara('comandă negăsită (sărite)');
      continue;
    }
    const produs = String(v(C.produs) ?? '').toLowerCase();
    const linie = linii.find((l) => l.produs.toLowerCase() === produs)
      ?? (sku ? linii.find((l) => sku!.startsWith(`${l.cod_sku}-`)) : undefined)
      ?? (linii.length === 1 ? linii[0] : undefined);
    if (!linie) {
      raport.push(`${id}: „${v(C.produs)}" nu e pe comanda ${numar} — sărit`);
      numara('produs negăsit pe comandă (sărite)');
      continue;
    }
    const marime = marimi.get(String(v(C.marime) ?? '').toLowerCase());
    if (!marime) {
      raport.push(`${id}: mărimea „${v(C.marime)}" nu există — sărit`);
      continue;
    }

    if (!etichetate.has(numar)) {
      numara('etichete emise', await emite(c, linie.comanda_id));
      etichetate.add(numar);
    }
    const { rows: [e] } = await c.query<{ id: string }>(
      `SELECT id FROM eticheta WHERE linie_id = $1 AND marime_id = $2 AND anulata_la IS NULL`, [linie.linie_id, marime]);
    if (!e) {
      raport.push(`${id}: ${linie.produs} mărimea ${v(C.marime)} nu e comandată pe ${numar} (${cant} buc) — sărit`);
      numara('mărime necomandată (sărite)');
      continue;
    }
    const ora = v(C.ora);
    const la = typeof ora === 'string' && /^\d{1,2}:\d{2}/.test(ora) ? `${zi} ${ora}` : `${zi} 12:00`;
    await c.query(
      `INSERT INTO receptie (firma_id, eticheta_id, cantitate, scanat_de, scanat_la, inchide_pozitia, observatii)
       VALUES (firma_curenta(), $1, $2, NULL, ($3::timestamp AT TIME ZONE 'Europe/Bucharest'), false, $4)`,
      [e.id, cant, la, `dashboard ${id}`]);
    numara('recepții importate');
    numara('bucăți intrate', cant);
    atinse.set(numar, linie.comanda_id);
  }

  for (const comandaId of atinse.values()) await stingeDacaE(c, comandaId);
  numara('comenzi cu intrări', atinse.size);
  numara('comenzi stinse (au intrat toate)',
    (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM comanda WHERE stare = 'inchisa' AND lower(numar) = ANY($1)`,
      [[...atinse.keys()]])).rows[0].n);
}

const fisier = process.argv[2];
if (!fisier) {
  console.error('Folosire: npm run import:intrari -- <dashboard.xlsx>');
  process.exit(1);
}
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(fisier);
await caFirma(firmaDinMediu(), (c) => importa(c, wb));

console.log('\nImport intrări terminat.\n');
for (const [k, n] of Object.entries(contor)) console.log(`  ${String(n).padStart(6)}  ${k}`);
if (raport.length) {
  console.log(`\nDe verificat (${raport.length}):`);
  for (const r of raport) console.log(`  - ${r}`);
}
process.exit(0);
