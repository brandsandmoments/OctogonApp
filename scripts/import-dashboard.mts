/**
 * Importul din dashboard-ul Google Sheets (exportat ca .xlsx).
 *
 *   npm run import:dashboard -- <fisier.xlsx>
 *
 * Ce aduce: branduri, categorii, culori, materiale, modele cu rețetele lor,
 * produsele, oamenii (cu KAM-ul fiecărei comenzi), comenzile PSF și PSC cu liniile
 * și cantitățile pe mărimi, istoricul de producție (planificările, loturile croite,
 * tranșele de pe bandă) și vânzările din Shopify adunate în fila VANZARI.
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
import { caFirma, firmaDinMediu } from '../app/lib/db.ts';

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
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
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
  const oameni = await importaOameni(c, wb);
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
    // Un material nou ia tipul după regula aplicației (0018: materie primă e doar ce se
    // întinde și se taie), nu după MP-ul din sheet; unul existent își păstrează tipul.
    // Un material care și-a primit culoarea în aplicație („ATA · NEGRU") își păstrează
    // denumirea.
    const { rows: [m] } = await c.query<{ id: string; nou: boolean }>(
      `INSERT INTO material (firma_id, tip, cod, denumire, unitate, familie, pret_referinta)
       VALUES (firma_curenta(), CASE WHEN $1 THEN 'accesoriu'::tip_material ELSE tip_material_dupa_nume($3, $4::unitate_masura) END,
               $2, $3, $4, $5, $6)
       ON CONFLICT (firma_id, cod) DO UPDATE
          SET denumire = CASE WHEN material.culoare_id IS NULL THEN EXCLUDED.denumire ELSE material.denumire END,
              familie = EXCLUDED.familie, pret_referinta = EXCLUDED.pret_referinta
       RETURNING id, (xmax = 0) AS nou`,
      [r.c('Tip') === 'ACC', text(r.c('Cod')), text(r.c('Denumire')), text(r.c('UM')),
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
    // Tipul componentei e al materialului ei (altfel cheile compuse o refuză); fără
    // material în nomenclator, regula aplicației. O componentă existentă își păstrează tipul.
    const { rows: [mc] } = await c.query<{ id: string; nou: boolean }>(
      `INSERT INTO model_componenta (firma_id, model_id, nume, tip, unitate, consum, ordine, principal)
       VALUES (firma_curenta(), $1, $2,
               coalesce((SELECT tip FROM material WHERE id = $8::uuid),
                        CASE WHEN $3 THEN 'accesoriu'::tip_material ELSE tip_material_dupa_nume($2, $4::unitate_masura) END),
               $4, $5, $6, $7 AND coalesce((SELECT tip FROM material WHERE id = $8::uuid), tip_material_dupa_nume($2, $4::unitate_masura)) = 'materie_prima')
       ON CONFLICT (model_id, nume) DO UPDATE
          SET consum = EXCLUDED.consum, ordine = EXCLUDED.ordine,
              principal = EXCLUDED.principal AND model_componenta.tip = 'materie_prima'
       RETURNING id, (xmax = 0) AS nou`,
      [modele.get(k), nume, r.c('Tip') === 'ACC', text(r.c('UM')),
       consum, ++ordine, text(r.c('Principal'))?.toLowerCase() === 'da', materiale.get(material) ?? null],
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
      const { rows: [nepotrivit] } = await c.query<{ ce: string }>(
        `SELECT mc.nume || ' e ' || mc.tip || ' în ' || mc.unitate || ', materialul ' || m.tip || ' în ' || m.unitate AS ce
           FROM model_componenta mc, material m WHERE mc.id = $1 AND m.id = $2 AND (mc.tip <> m.tip OR mc.unitate <> m.unitate)`,
        [comp.id, materialId]);
      if (nepotrivit) {
        semnaleaza(`rețeta ${p.model}: ${nepotrivit.ce} — material nealocat, de ales în aplicație`);
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
                   prioritati: number[]; stari: string[]; observatii: Set<string>; linii: Map<string, Linie>;
                   kam: string | null };
  const comenzi = new Map<string, Comanda>();

  // Rândurile marcate „Exemplu - se poate sterge" se sar — dar nu și cele pe care
  // istoricul le folosește: psc-sep-26-1 / Rochie Sophie Olive e marcat exemplu și
  // are planificare, lot croit și tranșă pe bandă. Ce s-a croit nu e un exemplu.
  const folositeInIstoric = new Set(
    randuri(wb, 'PLANIFICARE')
      .map((r) => `${text(r.c('Comanda (PSF/PSC)'))?.toLowerCase()}|${text(r.c('Produs / Model'))?.toLowerCase()}`),
  );

  function citesteComenzi(fila: 'PSF' | 'PSC') {
    const col = fila === 'PSF'
      ? { id: 'ID PSF', data: 'Data lansare', cine: 'KAM', produs: 'Produs / Model', ceruta: 'Data ceruta in stoc',
          prio: 'Prioritate', stare: 'Status PSF', obs: 'Observatii' }
      : { id: 'ID PSC', data: 'Data', cine: 'Cine a dat comanda', produs: 'Produs / Model', ceruta: 'Termen cerut livrare',
          prio: 'Prioritate', stare: 'Status PSC', obs: 'Observatii' };
    for (const r of randuri(wb, fila)) {
      const id = text(r.c(col.id))?.toLowerCase();
      if (!id) continue;
      // Un număr de comandă are prefix și liniuță (psf-ms-oct-71, psc-sep-26-3, ext-sep1);
      // „f" e un ID suprascris din greșeală — rândul lui dublează altă comandă.
      if (!/^[a-z]+-\S/.test(id)) {
        semnaleaza(`${fila}, rândul ${r.nr}: ID „${id}" nu e un număr de comandă — rând sărit`);
        continue;
      }
      const numeProdus = text(r.c(col.produs));
      const obs = text(r.c(col.obs));
      if ([numeProdus, obs, text(r.c(col.cine))].some((v) => v && /exemplu/i.test(v))) {
        if (!folositeInIstoric.has(`${id}|${numeProdus?.toLowerCase()}`)) {
          numara('rânduri exemplu sărite');
          continue;
        }
        semnaleaza(`${fila} ${id}, rândul ${r.nr}: marcat „exemplu", dar are planificare în sheet — importat ca rând real`);
      }
      const cmd: Comanda = comenzi.get(id) ?? {
        numar: id, tip: fila, date: [], ceruteLa: [], branduri: [], prioritati: [], stari: [],
        observatii: new Set<string>(), linii: new Map(), kam: null,
      };
      comenzi.set(id, cmd);

      const d = data(r.c(col.data)); if (d) cmd.date.push(d);
      const ceruta = data(r.c(col.ceruta)); if (ceruta) cmd.ceruteLa.push(ceruta);
      const prio = Number(String(r.c(col.prio) ?? '').split(' ')[0]); if (prio >= 1 && prio <= 5) cmd.prioritati.push(prio);
      const stare = text(r.c(col.stare)); if (stare) cmd.stari.push(stare);
      const cine = text(r.c(col.cine));
      if (cine) {
        const kam = oameni.get(cine.toLowerCase());
        if (kam) cmd.kam ??= kam;
        else {
          cmd.observatii.add(`${fila === 'PSF' ? 'KAM' : 'Comandă dată de'}: ${cine}`);
          semnaleaza(`${fila} ${id}: „${cine}" nu e în lista de persoane — trecut doar în observații`);
        }
      }
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
    if (existente.has(cmd.numar)) {
      // Comanda nu se rescrie; primește doar KAM-ul, dacă încă nu are.
      if (cmd.kam) await c.query(`UPDATE comanda SET kam_id = $2 WHERE numar = $1 AND kam_id IS NULL`, [cmd.numar, cmd.kam]);
      numara('comenzi existente, neatinse');
      continue;
    }
    if (cmd.linii.size === 0) {
      semnaleaza(`${cmd.tip} ${cmd.numar}: nicio linie importabilă — comanda nu s-a creat`);
      continue;
    }
    let dataLansare = minim(cmd.date);
    if (!dataLansare && cmd.ceruteLa.length) {
      dataLansare = minim(cmd.ceruteLa);
      cmd.observatii.add('Data lansării lipsea în sheet; s-a pus data cerută.');
      semnaleaza(`${cmd.tip} ${cmd.numar}: fără dată de lansare în sheet — folosită data cerută ${dataLansare}`);
    }
    if (!dataLansare) {
      // Nici dată cerută: e o ciornă din sheet (forecast-ul lunii viitoare, încă nelansat).
      // Nu intră: o comandă din aplicație nu se mai rescrie din sheet, deci datele puse
      // mai târziu n-ar mai ajunge. Intră la importul de după ce primește data lansării.
      semnaleaza(`${cmd.tip} ${cmd.numar}: fără dată de lansare și fără dată cerută — ciornă în sheet, neimportată`);
      numara('ciorne din sheet, neimportate');
      continue;
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
      `INSERT INTO comanda (firma_id, numar, tip, brand_id, data_lansare, prioritate, stare, observatii, kam_id)
       VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [cmd.numar, cmd.tip, branduri.get(brand), dataLansare, cmd.prioritati.length ? Math.min(...cmd.prioritati) : 3, stare,
       ['Import din dashboard.', ...cmd.observatii].join(' '), cmd.kam],
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

// ---------------------------------------------------------------- oameni

/** Rolul din NOM_LISTE („Asigura Stoc - Croit", „KAM - Key Account Manager") → rolurile aplicației. */
function roluri(rol: string): string[] {
  const r = rol.toLowerCase();
  if (r.startsWith('kam') || r.startsWith('head of sales')) return ['kam'];
  if (r.includes('planific')) return ['planificator'];
  if (/croi|croit|termocul|depozitare piese/.test(r)) return ['croit'];
  if (/linia|banda|calcat|stander|ctc/.test(r)) return ['banda'];
  if (/aprovizionare|achizitii|expediaza/.test(r)) return ['depozit'];
  return [];
}

/**
 * Oamenii din NOM_LISTE (coloanele E–F), ca utilizatori fără email: emailul vine
 * odată cu autentificarea. Numele e cheia — „ALex Stanciu" și „Alex Stanciu" sunt
 * același om, deci comparăm fără majuscule.
 */
async function importaOameni(c: PoolClient, wb: ExcelJS.Workbook): Promise<Map<string, string>> {
  const ws = wb.getWorksheet('NOM_LISTE');
  if (!ws) throw new Error('Lipsește fila NOM_LISTE');
  const oameni = new Map<string, string>(); // nume mic → id
  for (let r = 4; r <= ws.rowCount; r++) {
    const nume = text(valoare(ws.getCell(`E${r}`).value));
    if (!nume) continue;
    const rol = text(valoare(ws.getCell(`F${r}`).value)) ?? '';
    const { rows: [u] } = await c.query<{ id: string; nou: boolean }>(
      `INSERT INTO utilizator (firma_id, nume, roluri) VALUES (firma_curenta(), $1, $2::rol[])
       ON CONFLICT (firma_id, nume) DO UPDATE SET nume = EXCLUDED.nume
       RETURNING id, (xmax = 0) AS nou`, [nume, roluri(rol)]);
    oameni.set(nume.toLowerCase(), u.id);
    numara(u.nou ? 'oameni noi' : 'oameni existenți');
  }
  for (const r of (await c.query<{ id: string; nume: string }>(`SELECT id, nume FROM utilizator`)).rows) {
    oameni.set(r.nume.toLowerCase(), r.id);
  }
  return oameni;
}

// ---------------------------------------------------------------- vânzări

/**
 * Vânzările din fila VANZARI: o linie pe comandă și SKU de variantă. SKU-ul e
 * prefixul produsului plus mărimea (MSLL-ROCHIESERAPHYNE-NEGRU-S); mărimea trece
 * prin aliasuri (Shopify scrie 2XS și XXL). Un SKU necunoscut se păstrează, fără
 * produs: vânzarea a existat, doar catalogul n-o știe.
 *
 * Nu suprascrie ce a venit deja din Shopify: sincronizarea e sursa mai bună.
 */
async function importaVanzari(c: PoolClient, wb: ExcelJS.Workbook) {
  const branduri = new Map((await c.query<{ id: string; nume: string }>(`SELECT id, nume FROM brand`)).rows
    .map((b) => [b.nume, b.id]));
  const produse = (await c.query<{ id: string; cod_sku: string }>(`SELECT id, cod_sku FROM produs`)).rows
    .sort((a, b) => b.cod_sku.length - a.cod_sku.length); // cel mai lung prefix câștigă
  const marimi = new Map<string, string>();
  for (const m of (await c.query<{ id: string; cod: string }>(`SELECT id, cod FROM marime`)).rows) marimi.set(m.cod.toUpperCase(), m.id);
  for (const a of (await c.query<{ marime_id: string; alias: string }>(`SELECT marime_id, alias FROM marime_alias`)).rows) {
    if (!marimi.has(a.alias.toUpperCase())) marimi.set(a.alias.toUpperCase(), a.marime_id);
  }

  type Linie = { brand: string; nr: string; sku: string; data: string; produs: string | null; marime: string | null;
                 cantitate: number; valoare: number };
  const linii = new Map<string, Linie>();
  const necunoscute = new Set<string>();
  for (const r of randuri(wb, 'VANZARI')) {
    const brand = text(r.c('Brand'));
    const nr = text(r.c('Nr. comanda'));
    const sku = text(r.c('SKU varianta'))?.toUpperCase();
    const zi = data(r.c('Data comanda'));
    const q = numar(r.c('Cantitate'));
    if (!brand || !nr || !sku || !zi || !q || q <= 0) continue;
    if (!branduri.has(brand)) { semnaleaza(`VANZARI rândul ${r.nr}: brandul „${brand}" nu există — sărit`); continue; }
    const produs = produse.find((p) => sku.startsWith(`${p.cod_sku.toUpperCase()}-`));
    const marime = produs ? marimi.get(sku.slice(produs.cod_sku.length + 1)) ?? null : null;
    if (!produs) necunoscute.add(sku);
    const k = `${brand}|${nr}|${sku}`;
    const x = linii.get(k);
    // Același SKU de două ori în aceeași comandă: în bază e o singură linie, cu suma.
    if (x) { x.cantitate += Math.round(q); x.valoare += numar(r.c('Valoare (RON)')) ?? 0; continue; }
    linii.set(k, { brand, nr, sku, data: zi, produs: produs?.id ?? null, marime, cantitate: Math.round(q),
                   valoare: numar(r.c('Valoare (RON)')) ?? 0 });
  }
  for (const l of linii.values()) {
    const { rowCount } = await c.query(
      `INSERT INTO vanzare (firma_id, brand_id, nr_comanda, sku, data, produs_id, marime_id, cantitate, valoare, sursa)
       VALUES (firma_curenta(), $1, $2, $3, ($4::date + time '12:00') AT TIME ZONE 'Europe/Bucharest', $5, $6, $7, $8, 'dashboard')
       ON CONFLICT (firma_id, brand_id, nr_comanda, sku) DO UPDATE
          SET cantitate = EXCLUDED.cantitate, valoare = EXCLUDED.valoare, data = EXCLUDED.data,
              produs_id = EXCLUDED.produs_id, marime_id = EXCLUDED.marime_id
        WHERE vanzare.sursa = 'dashboard'`,
      [branduri.get(l.brand), l.nr, l.sku, l.data, l.produs, l.marime, l.cantitate, l.valoare]);
    numara('linii de vânzare', rowCount ?? 0);
  }
  if (necunoscute.size) {
    numara('SKU-uri vândute necunoscute în catalog', necunoscute.size);
    semnaleaza(`${necunoscute.size} SKU-uri din VANZARI nu se potrivesc cu niciun produs din catalog (păstrate fără produs), de ex.: ${[...necunoscute].slice(0, 8).join(', ')}`);
  }
}

// ---------------------------------------------------------------- istoric

/**
 * Istoricul de producție: planificările (PLANIFICARE), loturile croite (CROIT) și
 * tranșele de pe bandă (ALIMENTARE_BANDA), legate prin ID-urile din sheet:
 * psf-ms-sep-1/P1 → /P1/C1 → /P1/C1/B1.
 *
 * Ce NU face: nu scrie mișcări în fișa de magazie. Stocul de materiale n-a fost
 * ținut niciodată, deci un consum istoric ar duce stocul pe minus fără sens. Stocul
 * pornește din inventar și din intrările de acum; rezervările, în schimb, ies
 * corect din ce e planificat și necroit sau croit și încă nedat pe bandă.
 *
 * Datele din sheet se importă cum sunt, și când încalcă regulile pe care aplicația
 * le impune de acum (croit peste cerut, bandă peste croit): istoria s-a întâmplat.
 * Fiecare astfel de caz apare în raport.
 */
async function importaIstoric(c: PoolClient, wb: ExcelJS.Workbook) {
  const marimi = new Map((await c.query<{ id: string; cod: string }>(`SELECT id, cod FROM marime`)).rows
    .map((m) => [m.cod, m.id]));
  const motive = new Map((await c.query<{ id: string; nume: string }>(
    `SELECT id, nume FROM motiv WHERE 'croit' = ANY (contexte)`)).rows.map((m) => [m.nume.toLowerCase(), m.id]));
  const etape = (await c.query<{ id: string; ordine: number }>(`SELECT id, ordine FROM etapa_croit ORDER BY ordine`)).rows;

  /** Linia comenzii pentru un produs, după numărul comenzii și denumirea produsului. */
  async function linie(comanda: string, produs: string): Promise<{ id: string; comanda_id: string } | null> {
    const { rows: [l] } = await c.query<{ id: string; comanda_id: string }>(
      `SELECT cl.id, cl.comanda_id FROM comanda_linie cl
         JOIN comanda c ON c.id = cl.comanda_id JOIN produs p ON p.id = cl.produs_id
        WHERE c.numar = $1 AND lower(p.denumire) = lower($2)`, [comanda, produs]);
    return l ?? null;
  }
  const peMarimi = (r: Rand, prefix: string) => {
    const m = new Map<string, number>();
    for (const cod of MARIMI) {
      const q = numar(r.c(`${prefix} ${cod}`));
      if (q && q > 0) m.set(marimi.get(cod)!, Math.round(q));
    }
    return m;
  };
  const da = (v: Celula) => text(v)?.toLowerCase() === 'da';

  // -- planificări
  type Plan = { id: string; linie: string; existent: boolean };
  const planuri = new Map<string, Plan>(); // 'comanda/pN' → planificare
  const planDupaId = async (cod: string) => {
    const [comanda, p] = cod.split('/');
    const n = Number(p.slice(1));
    const { rows: [x] } = await c.query<{ id: string; linie_id: string }>(
      `SELECT pl.id, pl.linie_id FROM planificare pl JOIN comanda_linie cl ON cl.id = pl.linie_id
         JOIN comanda c ON c.id = cl.comanda_id WHERE c.numar = $1 AND pl.numar_transa = $2`, [comanda, n]);
    return x;
  };

  async function creeazaPlan(cod: string, l: { id: string }, cant: Map<string, number>, data: string | null,
                             observatii: string | null): Promise<Plan | null> {
    const existent = await planDupaId(cod);
    if (existent) { numara('planificări existente, neatinse'); return { id: existent.id, linie: existent.linie_id, existent: true }; }
    if (cant.size === 0) { semnaleaza(`planificarea ${cod}: fără cantități — sărită`); return null; }
    const { rows: [p] } = await c.query<{ id: string }>(
      `INSERT INTO planificare (firma_id, linie_id, numar_transa, data_planificare, stadiu, observatii)
       VALUES (firma_curenta(), $1, $2, coalesce($3::date, CURRENT_DATE), 'gata_de_lansat', $4) RETURNING id`,
      [l.id, Number(cod.split('/')[1].slice(1)), data, observatii]);
    for (const [m, q] of cant) {
      await c.query(`INSERT INTO planificare_cantitate (firma_id, planificare_id, marime_id, cantitate)
                     VALUES (firma_curenta(), $1, $2, $3)`, [p.id, m, q]);
    }
    numara('planificări importate');
    return { id: p.id, linie: l.id, existent: false };
  }

  for (const r of randuri(wb, 'PLANIFICARE')) {
    const brut = text(r.c('ID Planificare'));
    if (!brut) continue;
    const comanda = text(r.c('Comanda (PSF/PSC)'))?.toLowerCase();
    let cod = brut.toLowerCase();
    if (!/^[a-z0-9-]+\/p\d+$/.test(cod)) {
      // ID stricat în sheet: îl refacem din coloana comenzii, doar dacă e neechivoc.
      if (!comanda) { semnaleaza(`PLANIFICARE rândul ${r.nr}: ID „${brut}" fără comandă — sărit`); continue; }
      const refacut = `${comanda}/p1`;
      semnaleaza(`PLANIFICARE rândul ${r.nr}: ID „${brut}" refăcut ca ${refacut}`);
      cod = refacut;
    }
    const produs = text(r.c('Produs / Model'));
    const nrComanda = cod.split('/')[0];
    const l = produs ? await linie(nrComanda, produs) : null;
    if (!l) {
      semnaleaza(`planificarea ${cod}: comanda sau produsul („${produs}") nu există în aplicație — sărită`);
      numara('planificări fără comandă');
      continue;
    }
    const cant = peMarimi(r, 'PLANIFICAT');
    const cerut = peMarimi(r, 'CERUT');
    if ([...cant].some(([m, q]) => q > (cerut.get(m) ?? 0))) numara('planificări peste cerut (importate cum sunt)');
    const obs = ['Import din dashboard.', text(r.c('ID vechi (fisa tiparita)')) && `ID vechi: ${text(r.c('ID vechi (fisa tiparita)'))}`,
                 text(r.c('Observatii'))].filter(Boolean).join(' ');
    const p = await creeazaPlan(cod, l, cant, data(r.c('Data planificare')), obs);
    if (p) planuri.set(cod, p);
  }

  // -- loturi croite
  type Lot = { id: string; plan: string; croit: Map<string, number> };
  const loturi = new Map<string, Lot>();
  const atinse = new Set<string>(); // planificări cu loturi noi, pentru stadiu
  for (const r of randuri(wb, 'CROIT')) {
    const brut = text(r.c('ID Croit'));
    if (!brut) continue;
    const cod = brut.toLowerCase();
    if (!/^[a-z0-9-]+\/p\d+\/c\d+$/.test(cod)) {
      semnaleaza(`CROIT rândul ${r.nr}: ID „${brut}" nu e de forma comanda/Pn/Cn — sărit`);
      numara('loturi sărite');
      continue;
    }
    const codPlan = cod.replace(/\/c\d+$/, '');
    const cerut = peMarimi(r, 'CERUT');
    const croit = peMarimi(r, 'CROIT EFECTIV');
    let plan = planuri.get(codPlan);
    if (!plan) {
      const x = await planDupaId(codPlan);
      if (x) plan = { id: x.id, linie: x.linie_id, existent: true };
    }
    if (!plan) {
      // Lot croit fără planificare în sheet: planificarea se reface din ce i s-a cerut lotului.
      const produs = text(r.c('Produs / Model'));
      const l = produs ? await linie(codPlan.split('/')[0], produs) : null;
      if (!l) {
        semnaleaza(`lotul ${cod}: nici planificarea, nici linia comenzii nu există — sărit`);
        numara('loturi sărite');
        continue;
      }
      const p = await creeazaPlan(codPlan, l, cerut.size ? cerut : croit, data(r.c('Data primire comanda croit (auto)')),
        'Import din dashboard. Planificare refăcută: lotul croit exista fără planificare în sheet.');
      if (!p) continue;
      plan = p;
      planuri.set(codPlan, p);
      semnaleaza(`lotul ${cod}: planificarea ${codPlan} lipsea din sheet — refăcută din cantitățile lotului`);
    }
    const n = Number(cod.split('/c')[1]);
    const { rows: [exista] } = await c.query<{ id: string }>(
      `SELECT id FROM lot_croit WHERE planificare_id = $1 AND numar_lot = $2`, [plan.id, n]);
    if (exista) { numara('loturi existente, neatinse'); loturi.set(cod, { id: exista.id, plan: plan.id, croit }); continue; }

    const eCroit = [...croit.values()].some((q) => q > 0);
    const primit = data(r.c('Data primire comanda croit (auto)'));
    const croitLa = eCroit ? data(r.c('Data croire (auto)')) ?? primit : null;
    const responsabil = text(r.c('Responsabil croit'));
    const { rows: [lot] } = await c.query<{ id: string }>(
      `INSERT INTO lot_croit (firma_id, planificare_id, numar_lot, data_primire, croit_la, observatii)
       VALUES (firma_curenta(), $1, $2, coalesce($3::date, CURRENT_DATE), $4::date, $5) RETURNING id`,
      [plan.id, n, primit, eCroit ? croitLa ?? primit ?? new Date().toISOString().slice(0, 10) : null,
       ['Import din dashboard.', responsabil && `Responsabil: ${responsabil}`,
        text(r.c('ID vechi (fisa tiparita)')) && `ID vechi: ${text(r.c('ID vechi (fisa tiparita)'))}`,
        text(r.c('Observatii'))].filter(Boolean).join(' ')]);
    for (const [m, q] of cerut) {
      await c.query(`INSERT INTO lot_croit_cantitate (firma_id, lot_id, marime_id, cantitate) VALUES (firma_curenta(), $1, $2, $3)`,
        [lot.id, m, q]);
    }
    if (eCroit) {
      const motivText = text(r.c('Motiv diferenta croit'))?.toLowerCase();
      const motivId = motivText ? motive.get(motivText) ?? null : null;
      if (motivText && !motivId) semnaleaza(`lotul ${cod}: motivul „${motivText}" nu e în listă — importat fără motiv`);
      // Toate mărimile cerute primesc un rând, și cele necroite (zero): „cerut 8, croit 0" e o informație.
      const toate = new Set([...cerut.keys(), ...croit.keys()]);
      let peste = false;
      for (const m of toate) {
        const q = croit.get(m) ?? 0;
        if (q > (cerut.get(m) ?? 0)) peste = true;
        await c.query(
          `INSERT INTO lot_croit_efectiv (firma_id, lot_id, marime_id, cantitate, motiv_id) VALUES (firma_curenta(), $1, $2, $3, $4)`,
          [lot.id, m, q, q !== (cerut.get(m) ?? 0) ? motivId : null]);
      }
      if (peste) numara('loturi croite peste cerut (importate cum sunt)');
      numara('loturi croite importate');
    } else {
      numara('loturi necroite importate');
    }
    // Etapele bifate în sheet. Sheet-ul nu ține ora fiecărei etape, doar a croirii.
    const coloaneEtape = ['1. Comanda primita', '2. Necesar efectuat', '3. Materie prima disponibila', '4. Accesorii disponibile',
      '5. Model trasat', '6. Intins', '7. Croit', '8. Separat', '9. Dat spre Asambleaza comanda'];
    for (const [i, col] of coloaneEtape.entries()) {
      if (!da(r.c(col)) || !etape[i]) continue;
      await c.query(
        `INSERT INTO lot_etapa (firma_id, lot_id, etapa_id, bifat_la)
         VALUES (firma_curenta(), $1, $2, coalesce($3::date, $4::date, now())) ON CONFLICT DO NOTHING`,
        [lot.id, etape[i].id, i >= 6 ? croitLa : primit, primit]);
    }
    loturi.set(cod, { id: lot.id, plan: plan.id, croit });
    atinse.add(plan.id);
  }

  /** Lot (și, la nevoie, planificare) refăcut din ce a intrat pe bandă. */
  async function refaLot(codLot: string, produs: string | null, cant: Map<string, number>,
                         zi: string | null): Promise<Lot | null> {
    const codPlan = codLot.replace(/\/c\d+$/, '');
    let plan = planuri.get(codPlan);
    if (!plan) {
      const x = await planDupaId(codPlan);
      if (x) plan = { id: x.id, linie: x.linie_id, existent: true };
    }
    if (!plan) {
      const l = produs ? await linie(codPlan.split('/')[0], produs) : null;
      if (!l) return null;
      const p = await creeazaPlan(codPlan, l, cant, zi,
        'Import din dashboard. Planificare refăcută: tranșa de pe bandă exista fără lot și planificare în sheet.');
      if (!p) return null;
      plan = p;
      planuri.set(codPlan, p);
    }
    const n = Number(codLot.split('/c')[1]);
    // La o rulare repetată lotul refăcut există deja: nu e în CROIT, deci nu e în harta loturilor.
    const { rows: [exista] } = await c.query<{ id: string }>(
      `SELECT id FROM lot_croit WHERE planificare_id = $1 AND numar_lot = $2`, [plan.id, n]);
    if (exista) {
      const { rows } = await c.query<{ marime_id: string; cantitate: number }>(
        `SELECT marime_id, cantitate FROM lot_croit_efectiv WHERE lot_id = $1`, [exista.id]);
      return { id: exista.id, plan: plan.id, croit: new Map(rows.map((x) => [x.marime_id, x.cantitate])) };
    }
    const { rows: [lot] } = await c.query<{ id: string }>(
      `INSERT INTO lot_croit (firma_id, planificare_id, numar_lot, data_primire, croit_la, observatii)
       VALUES (firma_curenta(), $1, $2, coalesce($3::date, CURRENT_DATE), coalesce($3::date, CURRENT_DATE), $4)
       RETURNING id`,
      [plan.id, n, zi, 'Import din dashboard. Lot refăcut: tranșa de pe bandă exista fără lot croit în sheet.']);
    for (const [m, q] of cant) {
      await c.query(`INSERT INTO lot_croit_cantitate (firma_id, lot_id, marime_id, cantitate) VALUES (firma_curenta(), $1, $2, $3)`,
        [lot.id, m, q]);
      await c.query(`INSERT INTO lot_croit_efectiv (firma_id, lot_id, marime_id, cantitate) VALUES (firma_curenta(), $1, $2, $3)`,
        [lot.id, m, q]);
    }
    atinse.add(plan.id);
    return { id: lot.id, plan: plan.id, croit: new Map(cant) };
  }

  // -- tranșe pe bandă
  const alimentatPeLot = new Map<string, Map<string, number>>();
  // Întâi tranșele cu număr explicit (…/B2), apoi cele fără: altfel o tranșă fără
  // număr ar putea lua B1 înaintea rândului care chiar e B1 în sheet.
  const cuNumar = (r: Rand) => /\/b\d+$/i.test(text(r.c('ID Plan')) ?? '');
  const randuriBanda = randuri(wb, 'ALIMENTARE_BANDA');
  // Numărul unei tranșe fără /Bn vine din sheet, nu din bază: după cel mai mare /Bn
  // explicit al lotului, în ordinea rândurilor. Așa fiecare rulare dă același număr,
  // iar una repetată îl găsește și nu-l mai creează o dată.
  const maxExplicit = new Map<string, number>();
  for (const r of randuriBanda) {
    const m = /^(.+)\/b(\d+)$/.exec((text(r.c('ID Plan')) ?? '').toLowerCase());
    if (m) maxExplicit.set(m[1], Math.max(maxExplicit.get(m[1]) ?? 0, Number(m[2])));
  }
  const faraNumar = new Map<string, number>();
  for (const r of [...randuriBanda.filter(cuNumar), ...randuriBanda.filter((x) => !cuNumar(x))]) {
    const brut = text(r.c('ID Plan'));
    if (!brut) continue;
    const ESTE_LOT = /^[a-z0-9-]+\/p\d+\/c\d+$/;
    let cod = brut.toLowerCase();
    let codLot = (text(r.c('ID Croit (alege din lista)')) ?? '').toLowerCase();
    if (!ESTE_LOT.test(codLot)) codLot = '';
    let numarTransa: number | null = null;
    if (/^[a-z0-9-]+\/p\d+\/c\d+\/b\d+$/.test(cod)) {
      numarTransa = Number(cod.split('/b')[1]);
      codLot ||= cod.replace(/\/b\d+$/, '');
    } else if (ESTE_LOT.test(cod) && (!codLot || codLot === cod)) {
      // ID-ul e chiar lotul (fără /Bn): prima tranșă liberă a lotului.
      codLot = cod;
      semnaleaza(`ALIMENTARE_BANDA rândul ${r.nr}: ID „${brut}" fără tranșă — importat ca tranșă a lotului ${cod}`);
    } else if (codLot) {
      // ID scris greșit (psf-ms-sep0/P1), dar coloana lotului e validă: ea decide.
      semnaleaza(`ALIMENTARE_BANDA rândul ${r.nr}: ID „${brut}" stricat — importat după lotul din coloană, ${codLot}`);
    } else {
      semnaleaza(`ALIMENTARE_BANDA rândul ${r.nr}: ID „${brut}" nu se poate lega de un lot — sărit`);
      numara('tranșe sărite');
      continue;
    }
    const lotCod = codLot;
    const cant = peMarimi(r, 'LANSAT');
    if (cant.size === 0) { numara('tranșe fără bucăți, sărite'); continue; }
    let lot = loturi.get(lotCod);
    if (!lot) {
      // Bucăți date pe bandă dintr-un lot care lipsește din CROIT (rând stricat sau
      // necompletat): ce a intrat pe bandă a fost croit, deci lotul se reface din
      // tranșă — cerut = croit = ce a intrat pe bandă. Planificarea, la fel, dacă lipsește.
      lot = await refaLot(lotCod, text(r.c('Produs / Model')), cant,
        data(r.c('Data intrare productie')) ?? data(r.c('Data prioritizare'))) ?? undefined;
      if (!lot) {
        semnaleaza(`tranșa ${cod}: lotul ${lotCod} nu există și nu se poate reface (comanda sau produsul lipsesc) — sărită`);
        numara('tranșe sărite');
        continue;
      }
      loturi.set(lotCod, lot);
      semnaleaza(`tranșa ${cod}: lotul ${lotCod} lipsea din CROIT — refăcut din cantitățile tranșei`);
    }
    let n = numarTransa;
    if (n !== null) {
      const { rows: [exista] } = await c.query<{ id: string }>(
        `SELECT id FROM alimentare_banda WHERE lot_id = $1 AND numar = $2`, [lot.id, n]);
      if (exista) { numara('tranșe existente, neatinse'); continue; }
    } else {
      const k = (faraNumar.get(lotCod) ?? 0) + 1;
      faraNumar.set(lotCod, k);
      n = (maxExplicit.get(lotCod) ?? 0) + k;
      const { rows: [exista] } = await c.query<{ id: string }>(
        `SELECT id FROM alimentare_banda WHERE lot_id = $1 AND numar = $2`, [lot.id, n]);
      if (exista) { numara('tranșe existente, neatinse'); continue; }
    }

    // Etapele: o etapă bifată le implică pe cele dinainte, cu aceeași dată dacă lipsește a lor.
    const fl = { intrat: da(r.c('Intrat in productie')), iesit: da(r.c('Iesit din productie')),
                 ctc: da(r.c('La ambalare-CTC')), predat: da(r.c('Livrat depozit')) };
    const dIntrare = data(r.c('Data intrare productie'));
    const dIesire = data(r.c('Data iesire productie'));
    const dDepozit = data(r.c('Data iesire spre depozit'));
    const predat = fl.predat ? dDepozit ?? dIesire ?? dIntrare : null;
    const ctc = fl.ctc || fl.predat ? dIesire ?? predat ?? dIntrare : null;
    const iesit = fl.iesit || ctc ? dIesire ?? ctc ?? dIntrare : null;
    const intrat = fl.intrat || iesit ? dIntrare ?? iesit : null;
    const lipsaData = (fl.intrat || fl.iesit || fl.ctc || fl.predat) && !(dIntrare || dIesire || dDepozit);
    const zi = (d: string | null) => d ?? (lipsaData ? new Date().toISOString().slice(0, 10) : null);
    if ((fl.predat && !fl.ctc) || (fl.ctc && !fl.iesit) || (fl.iesit && !fl.intrat)) numara('tranșe cu etape completate (lipseau în sheet)');

    const timp = numar(r.c('Timp productie (min/buc)'));
    const pers = numar(r.c('Nr. persoane alocate'));
    const { rows: [ab] } = await c.query<{ id: string }>(
      `INSERT INTO alimentare_banda (firma_id, lot_id, numar, alimentat_la, responsabil, persoane, timp_min_buc,
                                     intrat_productie_la, iesit_productie_la, ctc_la, predat_depozit_la, observatii)
       VALUES (firma_curenta(), $1, $2, coalesce($3::date, $4::date, now()), $5, $6, $7,
               $8::date, $9::date, $10::date, $11::date, $12) RETURNING id`,
      [lot.id, n, data(r.c('Data prioritizare')), dIntrare, text(r.c('Responsabil banda')),
       pers && pers > 0 ? Math.round(pers) : null, timp && timp > 0 ? timp : null,
       zi(intrat), zi(iesit), zi(ctc), zi(predat),
       ['Import din dashboard.', text(r.c('ID vechi (fisa tiparita)')) && `ID vechi: ${text(r.c('ID vechi (fisa tiparita)'))}`,
        text(r.c('Observatii'))].filter(Boolean).join(' ')]);
    const peLot = alimentatPeLot.get(lot.id) ?? new Map<string, number>();
    for (const [m, q] of cant) {
      await c.query(`INSERT INTO alimentare_cantitate (firma_id, alimentare_id, marime_id, cantitate) VALUES (firma_curenta(), $1, $2, $3)`,
        [ab.id, m, q]);
      peLot.set(m, (peLot.get(m) ?? 0) + q);
    }
    alimentatPeLot.set(lot.id, peLot);
    numara('tranșe importate');
  }
  for (const [lotId, pe] of alimentatPeLot) {
    const lot = [...loturi.entries()].find(([, l]) => l.id === lotId);
    if (lot && [...pe].some(([m, q]) => q > (lot[1].croit.get(m) ?? 0))) {
      semnaleaza(`lotul ${lot[0]}: pe bandă ${[...pe.values()].reduce((a, b) => a + b, 0)} buc, croite ${[...lot[1].croit.values()].reduce((a, b) => a + b, 0)} — importat cum e`);
      numara('loturi cu bandă peste croit (importate cum sunt)');
    }
  }

  // -- stadiul planificărilor importate, din loturile lor
  for (const p of planuri.values()) {
    if (p.existent) continue;
    const { rows: [s] } = await c.query<{ loturi: number; necroite: number; rest: number }>(
      `SELECT (SELECT count(*) FROM lot_croit WHERE planificare_id = $1)::int AS loturi,
              (SELECT count(*) FROM lot_croit WHERE planificare_id = $1 AND croit_la IS NULL)::int AS necroite,
              (SELECT coalesce(sum(greatest(pc.cantitate - coalesce(
                  (SELECT sum(le.cantitate) FROM lot_croit lc JOIN lot_croit_efectiv le ON le.lot_id = lc.id
                    WHERE lc.planificare_id = pc.planificare_id AND le.marime_id = pc.marime_id), 0), 0)), 0)
                 FROM planificare_cantitate pc WHERE pc.planificare_id = $1)::int AS rest`, [p.id]);
    // Fără lot: planificatorul o lansează din aplicație. Cu lot necroit: e la croit.
    // Toate croite: încheiată dacă nu mai e nimic de croit, altfel în croit — restul
    // apare la „Rămas de croit", unde cineva decide dacă se mai croiește.
    const stadiu = s.loturi === 0 ? 'gata_de_lansat'
      : s.necroite > 0 ? (s.necroite < s.loturi ? 'in_croit' : 'lansat_spre_croit')
      : s.rest === 0 ? 'incheiat' : 'in_croit';
    await c.query(
      `UPDATE planificare SET stadiu = $2::stadiu_planificare,
              incheiat_la = CASE WHEN $2::text = 'incheiat' THEN now() END WHERE id = $1`,
      [p.id, stadiu]);
    numara(`planificări: ${stadiu}`);
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
await caFirma(firmaDinMediu(), async (c) => {
  await importa(c, wb);
  await importaIstoric(c, wb);
  await importaVanzari(c, wb);
  // Regulile de acum ale aplicației (0022): fiecare culoare pe materialul ei, fiecare
  // lot croit într-o taiere, planificările trimise la coada croitului.
  numara('produse trecute pe materialul culorii lor',
    (await c.query<{ n: number }>(`SELECT imparte_materiale_pe_culori() AS n`)).rows[0].n);
  numara('taieri noi pentru loturile importate',
    (await c.query<{ n: number }>(`SELECT taieri_pentru_loturi() AS n`)).rows[0].n);
});

console.log('\nImport terminat.\n');
for (const [k, v] of Object.entries(contor)) console.log(`  ${String(v).padStart(6)}  ${k}`);
if (raport.length) {
  console.log(`\nDe verificat (${raport.length}):`);
  for (const r of raport) console.log(`  - ${r}`);
}
process.exit(0);
