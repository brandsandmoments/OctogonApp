/**
 * Importul din dashboard-ul Google Sheets (exportat ca .xlsx).
 *
 *   npm run import:dashboard -- <fisier.xlsx>
 *
 * Ce aduce: branduri, categorii, culori, materiale, modele cu rețetele lor,
 * produsele, apoi comenzile PSF și PSC cu liniile și cantitățile pe mărimi.
 *
 * Trei reguli:
 *
 * - Totul într-o singură tranzacție. Un import oprit la jumătate ar lăsa exact
 *   genul de date pe jumătate legate pe care baza asta a fost făcută să le refuze.
 * - Se poate rula de mai multe ori. Nomenclatoarele se actualizează după cheia lor
 *   naturală (codul materialului, SKU-ul, brand + model). O comandă care există deja
 *   NU se rescrie: din clipa în care a intrat în aplicație, aplicația e sursa ei.
 *   La fel, materialul ales în aplicație pentru o culoare nu e înlocuit.
 * - Nimic nu se pierde în tăcere. Ce nu se poate potrivi (un produs care nu e în
 *   catalog, o comandă fără dată de lansare) se raportează la final, rând cu rând.
 *
 * Rulează cu rolul aplicației și cu FIRMA_ID din mediu, deci sub aceleași politici
 * de izolare ca orice ecran: un import greșit configurat scrie zero rânduri, nu
 * date în contul altei firme.
 */
import ExcelJS from 'exceljs';
import type { PoolClient } from 'pg';
import { caFirma, firmaCurenta } from '../app/lib/db.ts';

type Celula = string | number | boolean | null;
type Rand = { nr: number; c: (col: string) => Celula };

// ---------------------------------------------------------------- citire

/** Valoarea afișată a unei celule. O formulă fără rezultat salvat e goală, nu text. */
function valoare(v: ExcelJS.CellValue): Celula {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return valoare(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    return null; // eroare sau formulă fără rezultat
  }
  return v;
}

/**
 * Rândurile unei file, cu celulele căutate după antet, nu după literă: o coloană
 * inserată în sheet nu mută datele în câmpul greșit. Antetul e pe rândul 2.
 */
function randuri(wb: ExcelJS.Workbook, fila: string, randAntet = 2): Rand[] {
  const ws = wb.getWorksheet(fila);
  if (!ws) throw new Error(`Lipsește fila ${fila}`);
  const antet = new Map<string, number>();
  ws.getRow(randAntet).eachCell((cell, col) => {
    const t = valoare(cell.value);
    if (typeof t === 'string' && t.trim()) antet.set(t.trim(), col);
  });
  const rez: Rand[] = [];
  ws.eachRow((row, nr) => {
    if (nr <= randAntet) return;
    rez.push({
      nr,
      c: (col) => {
        const i = antet.get(col);
        if (i === undefined) throw new Error(`Fila ${fila} nu are coloana „${col}"`);
        const v = valoare(row.getCell(i).value);
        return typeof v === 'string' ? (v.trim() || null) : v;
      },
    });
  });
  return rez;
}

const text = (v: Celula) => (v == null ? null : String(v).trim() || null);
const numar = (v: Celula) => (typeof v === 'number' ? v : v == null ? null : Number(String(v).replace(',', '.')) || null);

/**
 * Datele vin ca text „2026-09-03", ca obiect Date, sau — unde cineva a scris peste
 * formulă — ca număr de serie Excel (46273). Toate trei înseamnă aceeași zi.
 */
function data(v: Celula): string | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** „Trening Echo" → „trening-echo", ca tagul Shopify model:echo. Fără diacritice. */
function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------- corespondențe

/**
 * Culorile scrise altfel decât în listă. Sheet-ul are dropdown, dar s-a scris și
 * peste el; fiecare variantă de aici a apărut efectiv în date. Ce nu e aici și nu
 * e nici în listă se adaugă ca o culoare nouă — și apare în raport.
 */
const CULORI: Record<string, string> = {
  'maro': 'Maro', 'brown': 'Maro', 'dark brown': 'Maro',
  'white': 'Alb', 'red': 'Rosu', 'crem': 'Crem', 'mint': 'Mint', 'mov': 'Mov', 'lila': 'Lila',
  'dusty pink': 'Roz Prafuit', 'cappucinno': 'Cappuccino', 'turqoise': 'Turcoaz',
  'verde olive': 'Olive', 'rosu-negru': 'Rosu cu Negru', 'rosu/negru': 'Rosu cu Negru',
  'beige': 'Bej',
};

/** Statusul din sheet → starea comenzii. Fără status înseamnă lansată: e în sheet, deci se lucrează. */
const STARI: Record<string, string> = {
  'Nou': 'lansata', 'Trimis la Asigura Stoc': 'lansata', 'Reprioritizat': 'lansata',
  'In lucru': 'in_productie', 'Livrat partial': 'in_productie',
  'Livrat in stoc': 'inchisa', 'Anulat': 'anulata',
};

const MARIMI = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL'] as const;

// ---------------------------------------------------------------- raport

const raport: string[] = [];
const contor: Record<string, number> = {};
const numara = (k: string, n = 1) => (contor[k] = (contor[k] ?? 0) + n);
const semnaleaza = (s: string) => raport.push(s);

// ---------------------------------------------------------------- import

async function importa(c: PoolClient, wb: ExcelJS.Workbook) {
  const produseSheet = randuri(wb, 'NOM_PRODUSE').filter((r) => text(r.c('Denumire produs (titlu Shopify)')));
  const retete = randuri(wb, 'RETETE').filter((r) => text(r.c('Model')));
  const materialeSheet = randuri(wb, 'NOM_MATERIALE').filter((r) => text(r.c('Cod')));

  // -- branduri și categorii
  const branduri = new Map<string, string>();
  const numeBranduri = new Set([...produseSheet, ...retete].map((r) => text(r.c('Brand'))).filter(Boolean) as string[]);
  for (const nume of numeBranduri) {
    const { rows: [b] } = await c.query<{ id: string }>(
      `INSERT INTO brand (firma_id, nume) VALUES (firma_curenta(), $1)
       ON CONFLICT (firma_id, nume) DO UPDATE SET nume = EXCLUDED.nume RETURNING id`, [nume]);
    branduri.set(nume, b.id);
  }

  const categorii = new Map<string, string>();
  for (const nume of new Set(produseSheet.map((r) => text(r.c('Categorie'))).filter(Boolean) as string[])) {
    const { rows: [k] } = await c.query<{ id: string }>(
      `INSERT INTO categorie (firma_id, nume) VALUES (firma_curenta(), $1)
       ON CONFLICT (firma_id, nume) DO UPDATE SET nume = EXCLUDED.nume RETURNING id`, [nume]);
    categorii.set(nume, k.id);
  }

  // -- culori: întâi lista existentă, apoi corespondențe, apoi culori noi
  const culori = new Map<string, string>(); // nume exact din bază → id
  for (const r of (await c.query<{ id: string; nume: string }>(`SELECT id, nume FROM culoare`)).rows) {
    culori.set(r.nume, r.id);
  }
  const dupaNumeMic = () => new Map([...culori].map(([n, id]) => [n.toLowerCase(), id]));
  async function culoare(brut: Celula): Promise<string | null> {
    const t = text(brut);
    if (!t) return null;
    const tinta = CULORI[t.toLowerCase()] ?? t;
    const gasit = culori.get(tinta) ?? dupaNumeMic().get(tinta.toLowerCase());
    if (gasit) return gasit;
    const { rows: [n] } = await c.query<{ id: string }>(
      `INSERT INTO culoare (firma_id, nume) VALUES (firma_curenta(), $1) RETURNING id`, [tinta]);
    culori.set(tinta, n.id);
    numara('culori noi');
    semnaleaza(`culoare nouă adăugată în listă: „${tinta}"${tinta !== t ? ` (din „${t}")` : ''}`);
    return n.id;
  }

  // -- materiale, după cod
  const materiale = new Map<string, string>(); // denumire → id, pentru rețete
  for (const r of materialeSheet) {
    const tip = r.c('Tip') === 'ACC' ? 'accesoriu' : 'materie_prima';
    const { rows: [m] } = await c.query<{ id: string; nou: boolean }>(
      `INSERT INTO material (firma_id, tip, cod, denumire, unitate, familie, pret_referinta)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6)
       ON CONFLICT (firma_id, cod) DO UPDATE
          SET denumire = EXCLUDED.denumire, familie = EXCLUDED.familie,
              pret_referinta = EXCLUDED.pret_referinta
       RETURNING id, (xmax = 0) AS nou`,
      [tip, text(r.c('Cod')), text(r.c('Denumire')), text(r.c('UM')),
       text(r.c('Familie')), numar(r.c('Pret unitar referinta (RON)'))],
    );
    materiale.set(text(r.c('Denumire'))!, m.id);
    numara(m.nou ? 'materiale noi' : 'materiale actualizate');
  }

  // -- modele: din rețete și din coloana „Model reteta" a produselor
  const categoriePeModel = new Map<string, Map<string, number>>();
  for (const r of produseSheet) {
    const model = text(r.c('Model reteta')); const cat = text(r.c('Categorie'));
    if (!model || !cat) continue;
    const k = `${text(r.c('Brand'))}|${model}`;
    const m = categoriePeModel.get(k) ?? new Map();
    m.set(cat, (m.get(cat) ?? 0) + 1);
    categoriePeModel.set(k, m);
  }
  const modele = new Map<string, string>(); // brand|model → id
  const cheiModele = new Set([
    ...retete.map((r) => `${text(r.c('Brand'))}|${text(r.c('Model'))}`),
    ...produseSheet.filter((r) => text(r.c('Model reteta'))).map((r) => `${text(r.c('Brand'))}|${text(r.c('Model reteta'))}`),
  ]);
  for (const k of cheiModele) {
    const [brand, model] = k.split('|');
    const cat = [...(categoriePeModel.get(k) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0];
    const { rows: [m] } = await c.query<{ id: string; nou: boolean }>(
      `INSERT INTO model (firma_id, brand_id, cod, denumire, categorie_id)
       VALUES (firma_curenta(), $1, $2, $3, $4)
       ON CONFLICT (firma_id, brand_id, cod) DO UPDATE
          SET denumire = EXCLUDED.denumire, categorie_id = coalesce(EXCLUDED.categorie_id, model.categorie_id)
       RETURNING id, (xmax = 0) AS nou`,
      [branduri.get(brand), slug(model), model, cat ? categorii.get(cat) : null],
    );
    modele.set(k, m.id);
    numara(m.nou ? 'modele noi' : 'modele actualizate');
  }

  // -- produse, după SKU
  const produse = new Map<string, { id: string; brand: string; model: string | null }>(); // denumire → produs
  for (const r of produseSheet) {
    const denumire = text(r.c('Denumire produs (titlu Shopify)'))!;
    const brand = text(r.c('Brand'))!;
    const modelK = text(r.c('Model reteta')) ? `${brand}|${text(r.c('Model reteta'))}` : null;
    const { rows: [p] } = await c.query<{ id: string; nou: boolean }>(
      `INSERT INTO produs (firma_id, cod_sku, denumire, brand_id, culoare_id, categorie_id, model_id, activ)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (firma_id, cod_sku) DO UPDATE
          SET denumire = EXCLUDED.denumire, brand_id = EXCLUDED.brand_id,
              culoare_id = coalesce(EXCLUDED.culoare_id, produs.culoare_id),
              categorie_id = coalesce(EXCLUDED.categorie_id, produs.categorie_id),
              model_id = coalesce(EXCLUDED.model_id, produs.model_id),
              activ = EXCLUDED.activ
       RETURNING id, (xmax = 0) AS nou`,
      [text(r.c('Cod / prefix SKU')), denumire, branduri.get(brand), await culoare(r.c('Culoare')),
       text(r.c('Categorie')) ? categorii.get(text(r.c('Categorie'))!) : null,
       modelK ? modele.get(modelK) : null,
       // „Activ" gol în sheet înseamnă necompletat, nu inactiv.
       text(r.c('Activ'))?.toLowerCase() !== 'nu'],
    );
    produse.set(denumire, { id: p.id, brand, model: modelK });
    numara(p.nou ? 'produse noi' : 'produse actualizate');
  }
  const produsDupaNume = (nume: string) =>
    produse.get(nume) ?? [...produse].find(([n]) => n.toLowerCase() === nume.toLowerCase())?.[1];

  // -- rețete: o componentă pe linie; numele include componenta când există
  //    („FUSTA MINI · ATA"), ca același material pe două piese să rămână două rânduri.
  const componente = new Map<string, { id: string; material: string }[]>(); // brand|model → componente
  let ordine = 0;
  for (const r of retete) {
    const k = `${text(r.c('Brand'))}|${text(r.c('Model'))}`;
    const material = text(r.c('Material / accesoriu'))!;
    const piesa = text(r.c('Componenta'));
    const nume = piesa ? `${piesa} · ${material}` : material;
    const consum = numar(r.c('Consum / buc'));
    if (!consum || consum <= 0) {
      semnaleaza(`rețetă ${k}, rândul ${r.nr}: „${nume}" fără consum, sărită`);
      continue;
    }
    const { rows: [mc] } = await c.query<{ id: string; nou: boolean }>(
      `INSERT INTO model_componenta (firma_id, model_id, nume, tip, unitate, consum, ordine, principal)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (model_id, nume) DO UPDATE
          SET consum = EXCLUDED.consum, ordine = EXCLUDED.ordine, principal = EXCLUDED.principal
       RETURNING id, (xmax = 0) AS nou`,
      [modele.get(k), nume, r.c('Tip') === 'ACC' ? 'accesoriu' : 'materie_prima', text(r.c('UM')),
       consum, ++ordine, text(r.c('Principal'))?.toLowerCase() === 'da'],
    );
    const lista = componente.get(k) ?? [];
    lista.push({ id: mc.id, material });
    componente.set(k, lista);
    numara(mc.nou ? 'componente noi' : 'componente actualizate');
  }

  // -- materialul fiecărei culori: cel din rețetă, până îl rafinează cineva în aplicație
  for (const p of produse.values()) {
    if (!p.model) continue;
    for (const comp of componente.get(p.model) ?? []) {
      const materialId = materiale.get(comp.material);
      if (!materialId) {
        semnaleaza(`materialul „${comp.material}" din rețeta ${p.model} nu e în NOM_MATERIALE`);
        continue;
      }
      const { rowCount } = await c.query(
        `INSERT INTO produs_material (firma_id, produs_id, model_id, componenta_id, material_id, tip, unitate)
         SELECT firma_curenta(), $1, mc.model_id, mc.id, $3, mc.tip, mc.unitate
           FROM model_componenta mc WHERE mc.id = $2
         ON CONFLICT (produs_id, componenta_id) DO NOTHING`,
        [p.id, comp.id, materialId],
      );
      numara('materiale alocate', rowCount ?? 0);
    }
  }

  // -- comenzi
  const marimi = new Map((await c.query<{ id: string; cod: string }>(`SELECT id, cod FROM marime`)).rows
    .map((m) => [m.cod, m.id]));

  type Linie = { rand: number; produs: string; dataCeruta: string | null; deLa: string | null; panaLa: string | null;
                 cant: Map<string, number>; observatii: string | null };
  type Comanda = { numar: string; tip: 'PSF' | 'PSC'; date: string[]; ceruteLa: string[]; branduri: string[];
                   prioritati: number[]; stari: string[]; observatii: Set<string>; linii: Map<string, Linie> };
  const comenzi = new Map<string, Comanda>();

  function citesteComenzi(fila: 'PSF' | 'PSC') {
    const col = fila === 'PSF'
      ? { id: 'ID PSF', data: 'Data lansare', cine: 'KAM', produs: 'Produs / Model', ceruta: 'Data ceruta in stoc',
          prio: 'Prioritate', stare: 'Status PSF', obs: 'Observatii' }
      : { id: 'ID PSC', data: 'Data', cine: 'Cine a dat comanda', produs: 'Produs / Model', ceruta: 'Termen cerut livrare',
          prio: 'Prioritate', stare: 'Status PSC', obs: 'Observatii' };
    for (const r of randuri(wb, fila)) {
      const id = text(r.c(col.id))?.toLowerCase();
      if (!id) continue;
      const numeProdus = text(r.c(col.produs));
      const obs = text(r.c(col.obs));
      if ([numeProdus, obs, text(r.c(col.cine))].some((v) => v && /exemplu/i.test(v))) {
        numara('rânduri exemplu sărite');
        continue;
      }
      const cmd: Comanda = comenzi.get(id) ?? {
        numar: id, tip: fila, date: [], ceruteLa: [], branduri: [], prioritati: [], stari: [],
        observatii: new Set<string>(), linii: new Map(),
      };
      comenzi.set(id, cmd);

      const d = data(r.c(col.data)); if (d) cmd.date.push(d);
      const ceruta = data(r.c(col.ceruta)); if (ceruta) cmd.ceruteLa.push(ceruta);
      const prio = Number(String(r.c(col.prio) ?? '').split(' ')[0]); if (prio >= 1 && prio <= 5) cmd.prioritati.push(prio);
      const stare = text(r.c(col.stare)); if (stare) cmd.stari.push(stare);
      const cine = text(r.c(col.cine));
      if (cine) cmd.observatii.add(`${fila === 'PSF' ? 'KAM' : 'Comandă dată de'}: ${cine.replace(/^ALex/, 'Alex')}`);
      if (fila === 'PSC') {
        const client = text(r.c('Client / Magazin')); if (client) cmd.observatii.add(`Client: ${client}`);
        const nrClient = text(r.c('Nr. comanda client')); if (nrClient) cmd.observatii.add(`Nr. comandă client: ${nrClient}`);
      }
      if (obs) cmd.observatii.add(obs);

      if (!numeProdus) continue;
      const produs = produsDupaNume(numeProdus);
      if (!produs) {
        semnaleaza(`${fila} ${id}, rândul ${r.nr}: produsul „${numeProdus}" nu e în NOM_PRODUSE — linie sărită`);
        numara('linii fără produs în catalog');
        continue;
      }
      cmd.branduri.push(produs.brand);

      const cant = new Map<string, number>();
      for (const m of MARIMI) {
        const q = numar(r.c(m));
        if (q && q > 0) {
          if (!Number.isInteger(q)) semnaleaza(`${fila} ${id}, rândul ${r.nr}: ${m} = ${q} nu e întreg, rotunjit`);
          cant.set(m, Math.round(q));
        }
      }
      if (cant.size === 0) {
        semnaleaza(`${fila} ${id}, rândul ${r.nr}: „${numeProdus}" fără cantități — linie sărită`);
        continue;
      }

      const linieObs = fila === 'PSC'
        ? [['Decizie', text(r.c('DECIZIE'))], ['Promis clientului', text(r.c('Data/ora promisa clientului'))]]
            .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ') || null
        : null;

      const existenta = cmd.linii.get(produs.id);
      if (existenta) {
        // Același produs de două ori în aceeași comandă: în bază e o singură linie.
        for (const [m, q] of cant) existenta.cant.set(m, (existenta.cant.get(m) ?? 0) + q);
        semnaleaza(`${fila} ${id}: „${numeProdus}" apare pe rândurile ${existenta.rand} și ${r.nr} — cantitățile adunate`);
      } else {
        cmd.linii.set(produs.id, {
          rand: r.nr, produs: produs.id, dataCeruta: ceruta,
          deLa: fila === 'PSF' ? data(r.c('Perioada estimata de vanzare - DE LA')) : null,
          panaLa: fila === 'PSF' ? data(r.c('Perioada estimata de vanzare - PANA LA')) : null,
          cant, observatii: linieObs,
        });
      }
    }
  }
  citesteComenzi('PSF');
  citesteComenzi('PSC');

  const existente = new Set((await c.query<{ numar: string }>(`SELECT numar FROM comanda`)).rows.map((r) => r.numar));
  const minim = (xs: string[]) => [...xs].sort()[0] ?? null;

  for (const cmd of comenzi.values()) {
    if (existente.has(cmd.numar)) { numara('comenzi existente, neatinse'); continue; }
    if (cmd.linii.size === 0) {
      semnaleaza(`${cmd.tip} ${cmd.numar}: nicio linie importabilă — comanda nu s-a creat`);
      continue;
    }
    let dataLansare = minim(cmd.date);
    if (!dataLansare) {
      dataLansare = minim(cmd.ceruteLa);
      cmd.observatii.add('Data lansării lipsea în sheet; s-a pus data cerută.');
      semnaleaza(`${cmd.tip} ${cmd.numar}: fără dată de lansare în sheet — folosită data cerută ${dataLansare}`);
    }
    const brand = [...cmd.branduri.reduce((m, b) => m.set(b, (m.get(b) ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])[0][0];
    if (new Set(cmd.branduri).size > 1) {
      semnaleaza(`${cmd.tip} ${cmd.numar}: produse din mai multe branduri (${[...new Set(cmd.branduri)].join(', ')}) — comanda trecută pe ${brand}`);
    }
    // Starea comenzii: anulată doar dacă toate rândurile sunt anulate.
    const stari = cmd.stari.map((s) => STARI[s] ?? 'lansata');
    const stare = stari.length > 0 && stari.every((s) => s === 'anulata') ? 'anulata'
      : stari.length > 0 && stari.every((s) => s === 'inchisa') ? 'inchisa'
      : stari.includes('in_productie') ? 'in_productie' : 'lansata';

    const { rows: [{ id }] } = await c.query<{ id: string }>(
      `INSERT INTO comanda (firma_id, numar, tip, brand_id, data_lansare, prioritate, stare, observatii)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [cmd.numar, cmd.tip, branduri.get(brand), dataLansare, cmd.prioritati.length ? Math.min(...cmd.prioritati) : 3, stare,
       ['Import din dashboard.', ...cmd.observatii].join(' ')],
    );
    numara(`comenzi ${cmd.tip} importate`);

    for (const l of cmd.linii.values()) {
      const dataCeruta = l.dataCeruta ?? dataLansare;
      const { rows: [linie] } = await c.query<{ id: string }>(
        `INSERT INTO comanda_linie (firma_id, comanda_id, produs_id, data_ceruta, vanzare_de_la, vanzare_pana_la, observatii)
         VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6)
         RETURNING id`,
        // O perioadă de vânzare care se termină înainte să înceapă e o greșeală de tastare;
        // se păstrează doar începutul.
        [id, l.produs, dataCeruta, l.deLa, l.panaLa && (!l.deLa || l.panaLa >= l.deLa) ? l.panaLa : null, l.observatii],
      );
      for (const [m, q] of l.cant) {
        await c.query(
          `INSERT INTO comanda_cantitate (firma_id, linie_id, marime_id, cantitate) VALUES (firma_curenta(), $1, $2, $3)`,
          [linie.id, marimi.get(m), q],
        );
        numara('bucăți importate', q);
      }
      numara('linii importate');
    }
  }
}

// ---------------------------------------------------------------- pornire

const fisier = process.argv[2];
if (!fisier) {
  console.error('Folosire: npm run import:dashboard -- <dashboard.xlsx>');
  process.exit(1);
}
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(fisier);
await caFirma(firmaCurenta(), (c) => importa(c, wb));

console.log('\nImport terminat.\n');
for (const [k, v] of Object.entries(contor)) console.log(`  ${String(v).padStart(6)}  ${k}`);
if (raport.length) {
  console.log(`\nDe verificat (${raport.length}):`);
  for (const r of raport) console.log(`  - ${r}`);
}
process.exit(0);
