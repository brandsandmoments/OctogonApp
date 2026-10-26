/**
 * Importul din „Situație Tipare" (Google Sheets, exportat ca .xlsx).
 *
 *   npm run import:tipare -- situatie_tipare.xlsx
 *
 * Fiecare rând devine un model în dezvoltare; statusul și bifele (TIPAR, MOSTRA,
 * FIȘĂ, APROBAT) devin pași în jurnal. Sheet-ul se contrazice uneori — „Gata" cu
 * toate bifele goale —, așa că regula e: ce s-a întâmplat contează. „Gata"
 * înseamnă tipar gata, bifa MOSTRA înseamnă mostră gata. Fiecare contradicție
 * apare în raport. Se poate rula din nou: un model existent (brand + nume) nu se
 * rescrie — din clipa în care e în aplicație, aplicația e sursa lui.
 */
import ExcelJS from 'exceljs';
import { caFirma, firmaDinMediu } from '../app/lib/db.ts';

const fisier = process.argv[2];
if (!fisier) { console.error('Folosire: npm run import:tipare -- <situatie_tipare.xlsx>'); process.exit(1); }

const TIP: Record<string, string> = {
  'tipar nou': 'tipar_nou', 'modificare tipar': 'modificare_tipar', 'gradare mărimi': 'gradare_marimi',
  'gradare marimi': 'gradare_marimi', 'variație model': 'variatie_model', 'variatie model': 'variatie_model',
};
const PRIORITATE: Record<string, number> = { urgent: 1, normal: 3, 'scăzută': 5, scazuta: 5 };

type Val = ExcelJS.CellValue;
const text = (v: Val): string | null => {
  if (v == null) return null;
  if (typeof v === 'object' && 'text' in v) return String(v.text).trim() || null;
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('').trim() || null;
  if (typeof v === 'object' && 'result' in v) return text(v.result as Val);
  return String(v).trim() || null;
};
const link = (v: Val): string | null => (v && typeof v === 'object' && 'hyperlink' in v ? String(v.hyperlink) : null);
const data = (v: Val): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = text(v);
  const m = t?.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};
const bifat = (v: Val) => v === true || text(v)?.toUpperCase() === 'TRUE';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(fisier);
const ws = wb.getWorksheet('Tipare');
if (!ws) { console.error('Lipsește fila „Tipare".'); process.exit(1); }

// Antetul e rândul cu „Brand" în prima coloană; coloanele se caută după nume.
let randAntet = 0;
ws.eachRow((r, n) => { if (!randAntet && text(r.getCell(1).value) === 'Brand') randAntet = n; });
const col = new Map<string, number>();
ws.getRow(randAntet).eachCell((c, i) => { const t = text(c.value); if (t) col.set(t, i); });
const c = (r: ExcelJS.Row, nume: string) => r.getCell(col.get(nume) ?? 999).value;

const raport: string[] = [];
let importate = 0, existente = 0;

await caFirma(firmaDinMediu(), async (db) => {
  const branduri = new Map((await db.query<{ id: string; nume: string }>(`SELECT id, nume FROM brand`)).rows.map((b) => [b.nume, b.id]));
  const marime = async (cod: string) => (await db.query<{ id: string }>(
    `SELECT id FROM marime WHERE upper(cod) = upper($1)
     UNION ALL SELECT marime_id FROM marime_alias WHERE upper(alias) = upper($1) LIMIT 1`, [cod])).rows[0]?.id ?? null;

  for (let n = randAntet + 1; n <= ws.rowCount; n++) {
    const r = ws.getRow(n);
    const brand = text(c(r, 'Brand')), model = text(c(r, 'Model'));
    if (!brand || !model) continue;
    const brandId = branduri.get(brand);
    if (!brandId) { raport.push(`rândul ${n}: brandul „${brand}" nu există — sărit`); continue; }
    const { rowCount } = await db.query(`SELECT 1 FROM dezvoltare WHERE brand_id = $1 AND lower(model) = lower($2)`, [brandId, model]);
    if (rowCount) { existente++; continue; }

    const catNume = text(c(r, 'Categorie'));
    const categorie = catNume ? (await db.query<{ id: string }>(
      `WITH g AS (SELECT id FROM categorie WHERE lower(nume) = lower($1) LIMIT 1),
            n AS (INSERT INTO categorie (firma_id, nume) SELECT firma_curenta(), $1 WHERE NOT EXISTS (SELECT 1 FROM g) RETURNING id)
       SELECT id FROM g UNION ALL SELECT id FROM n`, [catNume])).rows[0].id : null;
    const [dela, panala] = (text(c(r, 'Mărimi / gradare')) ?? '').split(/\s*[-–]\s*/);
    const tipText = text(c(r, 'Tip lucrare'))?.toLowerCase() ?? 'tipar nou';
    const { rows: [d] } = await db.query<{ id: string }>(
      `INSERT INTO dezvoltare (firma_id, brand_id, model, culori, categorie_id, tip, marime_de_la, marime_pana_la,
                               prioritate, termen, link_poze, link_fisa, observatii)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [brandId, model, (text(c(r, 'Culori')) ?? '').split(',').map((x) => x.trim()).filter(Boolean), categorie,
       TIP[tipText] ?? 'tipar_nou', dela ? await marime(dela) : null, panala ? await marime(panala) : null,
       PRIORITATE[text(c(r, 'Prioritate'))?.toLowerCase() ?? ''] ?? 3, data(c(r, 'Termen limită')),
       link(c(r, 'Link Poze Drive')), link(c(r, 'Link Fisa Prod.')),
       ['Import din Situație Tipare.', text(c(r, 'Observații'))].filter(Boolean).join(' ')]);

    // Pașii, din status și bife. Data: finalizarea, dacă e scrisă; altfel ziua importului.
    const status = text(c(r, 'Status'))?.toLowerCase() ?? 'de făcut';
    const tipar = bifat(c(r, 'TIPAR')), mostra = bifat(c(r, 'MOSTRA')), fisa = bifat(c(r, 'FISA PROD.')), aprobat = bifat(c(r, 'APROBAT'));
    const pasi: [string, string | null][] = [];
    const lucrat = status !== 'de făcut' || tipar || mostra || fisa || aprobat;
    if (lucrat) pasi.push(['inceput', null]);
    if (['probă', 'proba', 'corecturi'].includes(status)) pasi.push(['proba', null]);
    if (status === 'corecturi') pasi.push(['corecturi', 'Status „Corecturi" în Situație Tipare; detaliile nu erau scrise.']);
    if (status === 'gata' || tipar || mostra) pasi.push(['tipar_gata', null]);
    if (mostra) pasi.push(['mostra_gata', null]);
    if (fisa) pasi.push(['fisa_gata', null]);
    if (aprobat) pasi.push(['aprobat', 'Aprobat în Situație Tipare; modelul nu a fost pus în catalog automat.']);
    if (status === 'gata' && !tipar) raport.push(`${brand} ${model}: status „Gata", bifa TIPAR goală — importat ca tipar gata`);
    if (status === 'de făcut' && (tipar || mostra)) raport.push(`${brand} ${model}: status „De făcut", dar cu ${[tipar && 'TIPAR', mostra && 'MOSTRA'].filter(Boolean).join(' și ')} bifate — importat după bife`);
    const zi = data(c(r, 'Data finalizare'));
    for (const [i, [pas, obs]] of pasi.entries()) {
      await db.query(
        `INSERT INTO dezvoltare_pas (firma_id, dezvoltare_id, pas, la, observatii)
         VALUES (firma_curenta(), $1, $2, coalesce($3::date::timestamptz, now()) + $4 * interval '1 second', $5)`,
        [d.id, pas, zi, i, obs]);
    }
    importate++;
  }
});

console.log(`\n  ${importate} modele importate, ${existente} existau deja.`);
if (raport.length) { console.log(`\nDe verificat (${raport.length}):`); for (const r of raport) console.log(`  - ${r}`); }
process.exit(0);
