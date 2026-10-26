import ExcelJS from 'exceljs';
import { poate } from '../../../../lib/acces';
import { cost, fisa, poza, pretPeCuloare, type ComponentaFisa, type Fisa } from '../../../../lib/fisa';
import { utilizatorCurent } from '../../../../lib/sesiune';

/**
 * Fișa de produs în Excel, așezată ca „Palton Eloria.xlsx": titlul, pozele pe
 * culori, dimensiunile cu manopera, materiile prime și accesoriile cu consum, preț
 * și preț pe bucată (formule, ca fișa să se poată refolosi), costul pe culoare.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await utilizatorCurent();
  if (!u || !(poate(u, 'dezvoltare') || poate(u, 'comenzi'))) return new Response('Fără acces', { status: 403 });
  const f = await fisa((await params).id);
  if (!f) return new Response('Nu există', { status: 404 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(f.dezvoltare.model.slice(0, 31).toUpperCase());
  ws.columns = [{ width: 22 }, { width: 22 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }];
  const groasa = { bold: true };
  const chenar = (c: ExcelJS.Cell) => { c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }; };
  const antet = (r: ExcelJS.Row) => r.eachCell((c) => { c.font = groasa; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEAE0' } }; chenar(c); });

  // Titlul
  ws.mergeCells('A1:K3');
  const titlu = ws.getCell('A1');
  titlu.value = `${f.dezvoltare.categorie ? `${f.dezvoltare.categorie} ` : ''}${f.dezvoltare.model}`.toUpperCase();
  titlu.font = { bold: true, size: 20 };
  titlu.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell('A4').value = `${f.dezvoltare.brand} · ${f.marimi.join(' ')}`;

  // Pozele, câte una pe culoare, cu culoarea dedesubt
  let rand = 6;
  const culori = f.dezvoltare.culori;
  if (culori.length) {
    const lat = Math.max(1, Math.floor(11 / Math.min(culori.length, 4)));
    for (const [i, cul] of culori.slice(0, 4).entries()) {
      const p = f.poze.find((x) => x.culoare === cul);
      const col = i * lat;
      if (p) {
        const img = await poza(p.id);
        const ext = img?.mime === 'image/png' ? 'png' : img?.mime === 'image/jpeg' ? 'jpeg' : img?.mime === 'image/gif' ? 'gif' : null;
        if (img && ext) {
          const idImg = wb.addImage({ buffer: img.fisier as unknown as ExcelJS.Buffer, extension: ext });
          ws.addImage(idImg, { tl: { col: col + 0.1, row: rand - 1 }, ext: { width: 220, height: 300 } });
        }
      }
      const c = ws.getCell(rand + 20, col + 1);
      c.value = cul.toUpperCase();
      c.font = groasa;
    }
    rand += 23;
  }

  // Dimensiuni + manoperă
  if (f.masuri.length) {
    const h = ws.getRow(rand++);
    h.values = ['DIMENSIUNI', '', ...f.marimi, 'MANOP.'];
    antet(h);
    for (const m of f.masuri) {
      const r = ws.getRow(rand++);
      r.values = [m.nume, '', ...f.marimi.map((mr) => m.valori[mr] ?? ''), Number(f.dezvoltare.manopera ?? 0) || ''];
      r.eachCell((c) => chenar(c));
    }
    rand++;
  }

  // Materii prime și accesorii, cu formule: preț / buc = consum × preț
  const sectiune = (titluS: string, lista: ComponentaFisa[]) => {
    if (!lista.length) return;
    const h = ws.getRow(rand++);
    h.values = [titluS, 'MATERIAL / COD', 'FURNIZOR', 'CONSUM / BUC', 'UNITATE', 'PREȚ', 'PREȚ / BUC'];
    antet(h);
    const prim = rand;
    for (const c of lista) {
      const r = ws.getRow(rand);
      const materiale = c.material ? `${c.material}${c.cod ? ` · ${c.cod}` : ''}`
        : c.culori.map((x) => `${x.culoare}: ${x.material ?? x.denumire ?? ''}${x.cod ? ` · ${x.cod}` : ''}`).join('\n') || c.cod || '';
      const pret = pretPeCuloare(c, f.dezvoltare.culori[0] ?? '');
      r.values = [`${c.nume.toUpperCase()} (${c.unitate.toUpperCase()})`, materiale, c.furnizor ?? '', Number(c.consum), c.unitate,
        pret ?? '', { formula: `D${rand}*F${rand}` }];
      r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      r.eachCell((x) => chenar(x));
      rand++;
    }
    const t = ws.getRow(rand++);
    t.getCell(6).value = 'TOTAL';
    t.getCell(7).value = { formula: `SUM(G${prim}:G${rand - 2})` };
    t.getCell(6).font = groasa;
    t.getCell(7).font = groasa;
    rand++;
  };
  sectiune('MATERII PRIME', f.componente.filter((c) => c.tip === 'materie_prima'));
  sectiune('ACCESORII', f.componente.filter((c) => c.tip === 'accesoriu'));

  // Costul pe culoare (prețul poate diferi de la o culoare la alta)
  const h = ws.getRow(rand++);
  h.values = ['COST PE BUCATĂ', '', 'MATERII PRIME', 'ACCESORII', 'MANOPERĂ', 'TOTAL'];
  antet(h);
  for (const cul of culori.length ? culori : ['']) {
    const x = cost(f as Fisa, cul);
    const r = ws.getRow(rand++);
    r.values = [cul.toUpperCase() || '—', '', x.materie, x.accesorii, x.manopera, x.total];
    r.eachCell((c) => chenar(c));
    r.getCell(6).font = groasa;
  }
  for (const col of [3, 4, 5, 6, 7]) ws.getColumn(col).numFmt = '#,##0.00';

  const buf = await wb.xlsx.writeBuffer();
  const nume = `Fisa ${f.dezvoltare.model}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w -]/g, '');
  return new Response(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nume}.xlsx"`,
    },
  });
}
