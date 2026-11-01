import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { caFirma, firmaDinMediu } from './db';
import { extractText, getDocumentProxy } from 'unpdf';
import { citestePlatiCard } from './shopify';

/**
 * Citirea datelor pentru zona de financiar, de la trei surse, doar citire:
 *
 * - **xConnector**, pe fiecare magazin: comenzile din ultimele 60 de zile (prima dată 180), cu AWB-urile
 *   și facturile lor (SmartBill), inclusiv stornările;
 * - **Fan Courier** (selfAWB), pe contul de client al fiecărui brand: toate AWB-urile,
 *   zi de zi — și cele făcute de mână în selfAWB —, stadiul lor și rambursurile virate;
 * - **GLS** (MyGLS): toate coletele contului, pe zile, și stadiul lor. GLS nu dă prin
 *   API rambursurile virate;
 * - **Shopify Payments**, pe fiecare magazin: plățile cu cardul, cu comisionul, și
 *   viramentele către bancă;
 * - **SmartBill**: facturile făcute direct acolo (schimburi, retrimiteri), pe care
 *   xConnector nu le știe — citite din PDF, număr cu număr.
 *
 * La prima citire se iau ultimele 60 de zile; apoi doar ultimele câteva, peste ce e.
 * Datele de acces stau în .env pe server (XCONNECTOR_KEY_<COD>, FAN_USER, FAN_PAROLA,
 * GLS_USER, GLS_PAROLA, GLS_CLIENT); o sursă fără ele se sare, cu mesaj.
 */

const ZILE_PRIMA = 60;
const ZILE_PESTE = 4;
const azi = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' });
const zi = (d: string, pas: number) => new Date(Date.parse(`${d}T12:00:00Z`) + pas * 86_400_000).toISOString().slice(0, 10);
const zileIntre = (de: string, pana: string) => { const z: string[] = []; for (let d = de; d <= pana; d = zi(d, 1)) z.push(d); return z; };
const pauza = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Fan scrie datele „14.09.2026" sau „14.09.2026 13:05"; le face „2026-09-14" / „2026-09-14 13:05". */
const dataFan = (v: unknown): string | null => {
  const t = String(v ?? '').trim();
  const m = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}${m[4] ? ` ${m[4]}` : ''}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.replace('T', ' ').slice(0, 19) : null;
};
const numar = (v: unknown) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

/**
 * Brandurile, după nume: un colet trimis către „Maison Loulou" e un retur sau un schimb
 * venit de la client; unul trimis de „Parseea" e al Parseei.
 */
type Branduri = { id: string; cheie: string }[];
const simplu = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
const brandDin = (b: Branduri, nume: string | null | undefined) => { const n = simplu(nume); return n ? b.find((x) => n.includes(x.cheie))?.id ?? null : null; };

export type RezultatFinanciar = { sursa: string; citite?: number; eroare?: string };

async function deUnde(c: PoolClient, sursa: string): Promise<string> {
  const { rows: [r] } = await c.query<{ ultima_zi: string | null }>(
    `SELECT to_char(ultima_zi, 'YYYY-MM-DD') AS ultima_zi FROM sursa_financiar WHERE sursa = $1`, [sursa]);
  return r?.ultima_zi ? zi(r.ultima_zi, -ZILE_PESTE) : zi(azi(), -ZILE_PRIMA);
}

async function gata(c: PoolClient, sursa: string, eroare: string | null) {
  await c.query(
    `INSERT INTO sursa_financiar (firma_id, sursa, ultima_zi, citit_la, eroare) VALUES (firma_curenta(), $1, CASE WHEN $2::text IS NULL THEN $3::date END, now(), $2)
     ON CONFLICT (firma_id, sursa) DO UPDATE SET citit_la = now(), eroare = EXCLUDED.eroare,
       ultima_zi = CASE WHEN EXCLUDED.eroare IS NULL THEN EXCLUDED.ultima_zi ELSE sursa_financiar.ultima_zi END`,
    [sursa, eroare, azi()]);
}

// ---------------------------------------------------------------- xConnector

type DocXc = { name: string; documentType: 'INVOICE' | 'SHIPPING_LABEL'; reversal?: boolean; originalInvoice?: string | null };
type ComandaXc = {
  orderId: number | string; orderName: string; orderStatus?: string; financialStatus?: string; totalPrice?: number;
  documents?: DocXc[]; shippingAddress?: { firstName?: string; lastName?: string; phone?: string } | null;
  billingAddress?: { firstName?: string; lastName?: string; phone?: string } | null; createdAt?: string;
};

async function citesteXconnector(c: PoolClient, m: { id: string; cod: string }): Promise<number> {
  const cheie = process.env[`XCONNECTOR_KEY_${m.cod}`];
  if (!cheie) throw new Error('neconectat (lipsește cheia xConnector)');
  // Facturile apar și după expediere: comenzile din ultimele 60 de zile se recitesc de fiecare dată.
  // Prima dată, 180 de zile: coletele retrimise pentru comenzi vechi (schimburi) își găsesc comanda.
  const { rows: [citit] } = await c.query(`SELECT 1 FROM sursa_financiar WHERE sursa = $1 AND ultima_zi IS NOT NULL`, [`xc:${m.cod}`]);
  const de = zi(azi(), citit ? -ZILE_PRIMA : -180);
  let n = 0;
  // Câte 30 de zile odată: xConnector refuză perioadele lungi.
  for (let start = de; start <= azi(); start = zi(start, 30)) {
    const pana = zi(start, 29) < azi() ? zi(start, 29) : azi();
    for (let pagina = 0; pagina < 60; pagina++) {
      const r = await fetch(`https://xconnector.app/api/orders?fromOrderDate=${start}&toOrderDate=${pana}&page=${pagina}&size=200`,
        { headers: { authorization: `Bearer ${cheie}` }, signal: AbortSignal.timeout(60_000) });
      if (r.status === 429) { await pauza(5_000); pagina--; continue; }
      if (!r.ok) throw new Error(`xConnector ${r.status}`);
      const j = await r.json() as { content: ComandaXc[]; hasNext: boolean };
      for (const o of j.content) {
        const docs = o.documents ?? [];
        const awb = docs.filter((d) => d.documentType === 'SHIPPING_LABEL')
          .flatMap((d) => d.name.replace(/\.pdf$/i, '').split(/[,\s]+/)).filter(Boolean);
        const facturi = docs.filter((d) => d.documentType === 'INVOICE');
        const adr = o.shippingAddress ?? o.billingAddress;
        await c.query(
          `INSERT INTO xc_comanda (firma_id, magazin_id, order_id, nume, creata_la, total, plata, stare, client, telefon, awb, facturi, stornari)
           VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (magazin_id, order_id) DO UPDATE SET nume = EXCLUDED.nume, creata_la = coalesce(EXCLUDED.creata_la, xc_comanda.creata_la),
             total = EXCLUDED.total, plata = EXCLUDED.plata, stare = EXCLUDED.stare, client = EXCLUDED.client, telefon = EXCLUDED.telefon,
             awb = EXCLUDED.awb, facturi = EXCLUDED.facturi, stornari = EXCLUDED.stornari, actualizat_la = now()`,
          [m.id, String(o.orderId), o.orderName, o.createdAt ?? null, o.totalPrice ?? null, o.financialStatus ?? null, o.orderStatus ?? null,
           [adr?.firstName, adr?.lastName].filter(Boolean).join(' ') || null, adr?.phone ?? null, awb,
           facturi.filter((d) => !d.reversal).map((d) => d.name.replace(/\.pdf$/i, '')),
           facturi.filter((d) => d.reversal).map((d) => d.name.replace(/\.pdf$/i, ''))]);
        n++;
      }
      if (!j.hasNext || j.content.length === 0) break;
    }
  }
  return n;
}

// ---------------------------------------------------------------- Fan Courier

const FAN = 'https://api.fancourier.ro';
let tokenFan: { token: string; pana: number } | null = null;

async function fan<T>(cale: string): Promise<T> {
  const user = process.env.FAN_USER, parola = process.env.FAN_PAROLA;
  if (!user || !parola) throw new Error('neconectat (lipsesc utilizatorul și parola selfAWB)');
  // Tokenul ține 24 de ore: se ia o dată și se refolosește.
  if (!tokenFan || tokenFan.pana < Date.now()) {
    const r = await fetch(`${FAN}/login`, { method: 'POST', body: new URLSearchParams({ username: user, password: parola }), signal: AbortSignal.timeout(30_000) });
    const j = await r.json().catch(() => ({})) as { data?: { token?: string } ; message?: string };
    if (!r.ok || !j.data?.token) throw new Error(`Fan: autentificarea a eșuat (${j.message ?? r.status})`);
    tokenFan = { token: j.data.token, pana: Date.now() + 20 * 3600_000 };
  }
  for (let incercare = 0; ; incercare++) {
    const r = await fetch(`${FAN}${cale}`, { headers: { authorization: `Bearer ${tokenFan.token}`, accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
    if (r.status === 401 && incercare === 0) { tokenFan = null; return fan<T>(cale); }
    if (r.status === 429 && incercare < 3) { await pauza(5_000); continue; }
    if (!r.ok) throw new Error(`Fan ${cale.split('?')[0]}: ${r.status}`);
    return r.json() as Promise<T>;
  }
}

/** Toate paginile unei liste Fan pe o zi. */
async function fanZi<T>(cale: string, clientId: string, d: string): Promise<T[]> {
  const tot: T[] = [];
  for (let pagina = 1; pagina <= 50; pagina++) {
    const j = await fan<{ data?: T[] | null }>(`${cale}?clientId=${clientId}&date=${d}&perPage=100&page=${pagina}`);
    const date = Array.isArray(j.data) ? j.data : [];
    tot.push(...date);
    if (date.length < 100) break;
  }
  return tot;
}

type AwbFan = {
  info?: { awbNumber?: string | number; date?: string; cod?: number | string; cost?: number | string; observations?: string | null; content?: string | null };
  recipient?: PersoanaFan;
  sender?: PersoanaFan;
  awbNumber?: string | number;
};
type PersoanaFan = { name?: string; phone?: string; address?: { locality?: string; city?: string } | null; locality?: string };

type VirFan = { info?: { awbNumber?: number | string; amountCollected?: number | string; transactionDate?: string; transferDate?: string;
                         reimbursementAwbNumber?: number | string | null } };

const stareFan = (ev: { id?: string; name?: string }[]): { stare: string; text: string | null } => {
  const ultim = ev[ev.length - 1];
  const nume = ev.map((e) => `${e.id ?? ''} ${e.name ?? ''}`);
  if (nume.some((n) => /^S2\b/.test(n) || /livrat/i.test(n)) && !/refuz|retur/i.test(ultim?.name ?? '')) return { stare: 'livrat', text: ultim?.name ?? null };
  if (nume.some((n) => /refuz/i.test(n))) return { stare: 'refuzat', text: ultim?.name ?? null };
  if (nume.some((n) => /retur/i.test(n))) return { stare: 'returnat', text: ultim?.name ?? null };
  return { stare: ev.length ? 'in_tranzit' : 'creat', text: ultim?.name ?? null };
};

async function citesteFan(c: PoolClient, m: { id: string; cod: string; fan_client_id: string }, b: Branduri): Promise<number> {
  const sursa = `fan:${m.fan_client_id}`;
  let n = 0;
  for (const d of zileIntre(await deUnde(c, sursa), azi())) {
    for (const a of await fanZi<AwbFan>('/reports/awb', m.fan_client_id, d)) {
      const awb = String(a.info?.awbNumber ?? a.awbNumber ?? '').trim();
      if (!awb) continue;
      // Destinatarul e chiar brandul: coletul vine de la client (retur, schimb); clientul e expeditorul.
      const intra = Boolean(brandDin(b, a.recipient?.name));
      const r = intra ? a.sender : a.recipient;
      await c.query(
        `INSERT INTO colet_curier (firma_id, curier, awb, magazin_id, creat_zi, destinatar, telefon, oras, referinta, ramburs, cost, sens)
         VALUES (firma_curenta(), 'fan', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (firma_id, curier, awb) DO UPDATE SET magazin_id = EXCLUDED.magazin_id, destinatar = EXCLUDED.destinatar, sens = EXCLUDED.sens,
           telefon = EXCLUDED.telefon, oras = EXCLUDED.oras, referinta = EXCLUDED.referinta, ramburs = EXCLUDED.ramburs,
           cost = EXCLUDED.cost, actualizat_la = now()`,
        [awb, m.id, (dataFan(a.info?.date) ?? d).slice(0, 10), r?.name ?? null, r?.phone ?? null, r?.address?.locality ?? r?.address?.city ?? r?.locality ?? null,
         [a.info?.content, a.info?.observations].filter(Boolean).join(' · ') || null, numar(a.info?.cod), a.info?.cost == null ? null : numar(a.info.cost),
         intra ? 'intra' : 'iese']);
      n++;
    }
    // Rambursurile virate în ziua asta.
    for (const { info: v } of await fanZi<VirFan>('/reports/bank-transfers', m.fan_client_id, d)) {
      const awb = String(v?.awbNumber ?? '').trim();
      if (!awb) continue;
      await c.query(
        `INSERT INTO ramburs_virat (firma_id, curier, awb, magazin_id, suma, incasat_zi, virat_zi, awb_ramburs)
         VALUES (firma_curenta(), 'fan', $1, $2, $3, $4, $5, $6)
         ON CONFLICT (firma_id, curier, awb, virat_zi) DO UPDATE SET suma = EXCLUDED.suma, incasat_zi = EXCLUDED.incasat_zi, awb_ramburs = EXCLUDED.awb_ramburs`,
        [awb, m.id, numar(v!.amountCollected), dataFan(v!.transactionDate)?.slice(0, 10) ?? null,
         (dataFan(v!.transferDate) ?? d).slice(0, 10), v!.reimbursementAwbNumber == null ? null : String(v!.reimbursementAwbNumber)]);
    }
  }
  // Stadiul coletelor încă pe drum, din ultimele două luni, câte 50 odată.
  const { rows } = await c.query<{ awb: string }>(
    `SELECT awb FROM colet_curier WHERE curier = 'fan' AND magazin_id = $1 AND stare IN ('creat', 'in_tranzit', 'refuzat')
        AND creat_zi > current_date - 62 ORDER BY urmarit_la NULLS FIRST LIMIT 4000`, [m.id]);
  for (let i = 0; i < rows.length; i += 50) {
    const lot = rows.slice(i, i + 50);
    const j = await fan<{ data?: { awbNumber?: string | number; events?: { id?: string; name?: string; date?: string }[]; returnAwbNumber?: string | number | null }[] }>(
      `/reports/awb/tracking?clientId=${m.fan_client_id}&${lot.map((r) => `awb[]=${encodeURIComponent(r.awb)}`).join('&')}`);
    for (const t of j.data ?? []) {
      const ev = t.events ?? [];
      const s = stareFan(ev);
      await c.query(
        `UPDATE colet_curier SET stare = $2, stare_text = $3, stare_la = $4::timestamp AT TIME ZONE 'Europe/Bucharest', awb_retur = $5, urmarit_la = now()
          WHERE curier = 'fan' AND awb = $1`,
        [String(t.awbNumber), s.stare, s.text, dataFan(ev[ev.length - 1]?.date), t.returnAwbNumber ? String(t.returnAwbNumber) : null]);
    }
    await c.query(`UPDATE colet_curier SET urmarit_la = now() WHERE curier = 'fan' AND awb = ANY($1)`, [lot.map((r) => r.awb)]);
  }
  return n;
}

// ---------------------------------------------------------------- GLS

const GLS = 'https://api.mygls.ro/ParcelService.svc/json';
const dataWcf = (s: string | null | undefined) => { const m = /\/Date\((-?\d+)/.exec(s ?? ''); return m ? new Date(Number(m[1])) : null; };

async function gls<T>(metoda: string, corp: Record<string, unknown>): Promise<T> {
  const user = process.env.GLS_USER, parola = process.env.GLS_PAROLA, client = Number(process.env.GLS_CLIENT);
  if (!user || !parola || !client) throw new Error('neconectat (lipsesc datele MyGLS)');
  const r = await fetch(`${GLS}/${metoda}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ Username: user, Password: [...createHash('sha512').update(parola, 'utf8').digest()], ClientNumberList: [client],
      WebshopEngine: 'OctogonApp', ...corp }),
  });
  if (!r.ok) throw new Error(`GLS ${metoda}: ${r.status}`);
  return r.json() as Promise<T>;
}

// Codurile de stadiu GLS: 05/54/55/58 livrat, 23/40 returnat, 17 refuzat, 51/52 doar date primite.
const stareGls = (cod: string) => {
  const n = Number(cod);
  if ([5, 54, 55, 58].includes(n)) return 'livrat';
  if ([23, 40].includes(n)) return 'returnat';
  if (n === 17) return 'refuzat';
  if ([51, 52].includes(n)) return 'creat';
  return 'in_tranzit';
};

type ParcelaGls = {
  ParcelNumber?: number; ClientReference?: string | null;
  Parcel?: { CODAmount?: number; ClientReference?: string | null; Content?: string | null; PickupDate?: string;
             DeliveryAddress?: AdresaGls; PickupAddress?: AdresaGls };
};
type AdresaGls = { Name?: string; ContactName?: string; ContactPhone?: string; City?: string };

async function citesteGls(c: PoolClient, b: Branduri): Promise<number> {
  let n = 0;
  const de = await deUnde(c, 'gls');
  // Câte trei zile odată (după data etichetei).
  for (let d = de; d <= azi(); d = zi(d, 3)) {
    const j = await gls<{ PrintDataInfoList?: ParcelaGls[]; GetParcelListErrors?: { ErrorCode: number; ErrorDescription: string }[] }>('GetParcelList', {
      PrintDateFrom: `/Date(${Date.parse(`${d}T00:00:00+02:00`)})/`, PrintDateTo: `/Date(${Date.parse(`${zi(d, 3)}T00:00:00+02:00`)})/`,
      PickupDateFrom: null, PickupDateTo: null });
    // „Parcel not found" = nicio etichetă în zilele astea, nu o eroare.
    const erori = (j.GetParcelListErrors ?? []).filter((e) => !/not found/i.test(e.ErrorDescription));
    if (erori.length) throw new Error(`GLS: ${erori.map((e) => e.ErrorDescription).join('; ')}`);
    for (const p of j.PrintDataInfoList ?? []) {
      if (!p.ParcelNumber) continue;
      // Către brand = vine de la client (retur, schimb ridicat de GLS); altfel pleacă de la brand la client.
      const spreBrand = brandDin(b, p.Parcel?.DeliveryAddress?.Name);
      const a = spreBrand ? p.Parcel?.PickupAddress : p.Parcel?.DeliveryAddress;
      const magazin = spreBrand ?? brandDin(b, p.Parcel?.PickupAddress?.Name);
      const ziua = (dataWcf(p.Parcel?.PickupDate) ?? new Date(`${d}T12:00:00Z`)).toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' });
      await c.query(
        `INSERT INTO colet_curier (firma_id, curier, awb, creat_zi, destinatar, telefon, oras, referinta, ramburs, sens, magazin_id)
         VALUES (firma_curenta(), 'gls', $1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (firma_id, curier, awb) DO UPDATE SET destinatar = EXCLUDED.destinatar, telefon = EXCLUDED.telefon,
           sens = EXCLUDED.sens, magazin_id = coalesce(EXCLUDED.magazin_id, colet_curier.magazin_id),
           oras = EXCLUDED.oras, referinta = EXCLUDED.referinta, ramburs = EXCLUDED.ramburs, actualizat_la = now()`,
        [String(p.ParcelNumber), ziua, a?.Name ?? a?.ContactName ?? null, a?.ContactPhone ?? null, a?.City ?? null,
         p.ClientReference ?? p.Parcel?.ClientReference ?? p.Parcel?.Content ?? null, numar(p.Parcel?.CODAmount), spreBrand ? 'intra' : 'iese', magazin]);
      n++;
    }
  }
  // Stadiul, colet cu colet, pentru cele încă pe drum din ultimele două luni.
  const { rows } = await c.query<{ awb: string }>(
    `SELECT awb FROM colet_curier WHERE curier = 'gls' AND stare IN ('creat', 'in_tranzit', 'refuzat') AND creat_zi > current_date - 62
      ORDER BY urmarit_la NULLS FIRST LIMIT 1200`);
  for (const { awb } of rows) {
    const j = await gls<{ ParcelStatusList?: { StatusCode: string; StatusDate: string; StatusDescription: string }[] }>('GetParcelStatuses',
      { ParcelNumber: Number(awb), ReturnPOD: false, LanguageIsoCode: 'RO' });
    const lista = [...(j.ParcelStatusList ?? [])].sort((x, y) => (dataWcf(x.StatusDate)?.getTime() ?? 0) - (dataWcf(y.StatusDate)?.getTime() ?? 0));
    const ultim = lista[lista.length - 1];
    // Un refuz rămâne refuz, chiar dacă urmează returul.
    const stare = !ultim ? 'creat' : lista.some((s) => Number(s.StatusCode) === 17) && stareGls(ultim.StatusCode) !== 'livrat' ? 'refuzat' : stareGls(ultim.StatusCode);
    await c.query(`UPDATE colet_curier SET stare = $2, stare_text = $3, stare_la = $4, urmarit_la = now() WHERE curier = 'gls' AND awb = $1`,
      [awb, stare, ultim?.StatusDescription ?? null, dataWcf(ultim?.StatusDate)]);
  }
  return n;
}

// ---------------------------------------------------------------- SmartBill

const SB = 'https://ws.smartbill.ro/SBORO/api';

async function sb(cale: string, accept = 'application/json'): Promise<Response> {
  const email = process.env.SMARTBILL_EMAIL, token = process.env.SMARTBILL_TOKEN;
  if (!email || !token) throw new Error('neconectat (lipsesc emailul și tokenul SmartBill)');
  await pauza(400);  // SmartBill: cel mult 30 de cereri la 10 secunde, altfel blochează 10 minute
  const r = await fetch(`${SB}${cale}`, {
    headers: { authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`, accept }, signal: AbortSignal.timeout(60_000) });
  if (r.status === 429) throw new Error('SmartBill: prea multe cereri; se reia la citirea următoare');
  if (r.status === 401 || r.status === 403) throw new Error('SmartBill: autentificarea a eșuat');
  return r;
}

/** Ce scrie pe o factură SmartBill: data, clientul, telefonul, comanda („Order: #17191"), totalul. */
function dinFactura(text: string) {
  const ia = (re: RegExp) => re.exec(text)?.[1]?.trim() || null;
  const data = ia(/Data \(zi\/luna\/an\):\s*(\d{2}\/\d{2}\/\d{4})/);
  const total = ia(/(-?[\d,]*\d(?:\.\d+)?)\s*Total plata/);
  return {
    data: data ? data.split('/').reverse().join('-') : null,
    client: ia(/Client:\s*(.+?)\s+CIF:/),
    telefon: ia(/Persoana de contact:\s*(\+?\d[\d\s]{7,}\d)/)?.replace(/\s/g, '') ?? null,
    email: ia(/Email:\s*(\S+@\S+)/),
    comanda: ia(/Order:\s*(#\d+)/),
    total: total == null ? null : Number(total.replace(/,/g, '')),
  };
}

/**
 * Facturile din SmartBill pe care xConnector nu le știe: SmartBill nu dă lista lor, dar
 * dă seria cu următorul număr. Numerele din ultimele ~6000 ale seriei care nu sunt nici
 * în xConnector, nici citite deja, se citesc din PDF. Cel mult 1200 pe o citire.
 */
async function citesteSmartBill(c: PoolClient): Promise<number> {
  const cif = process.env.SMARTBILL_CIF;
  if (!cif) throw new Error('neconectat (lipsește CIF-ul SmartBill)');
  const serii = (await (await sb(`/series?cif=${encodeURIComponent(cif)}&type=f`)).json() as { list?: { name: string; nextNumber: number }[] }).list ?? [];
  let n = 0;
  for (const { name: serie, nextNumber } of serii) {
    const { rows } = await c.query<{ n: number }>(
      `SELECT DISTINCT substring(x FROM '-(\\d+)$')::int AS n FROM xc_comanda, unnest(facturi || stornari) x WHERE x LIKE $1 || '-%'
       UNION SELECT numar FROM factura_smartbill WHERE serie = $1`, [serie]);
    const stiute = new Set(rows.map((r) => r.n));
    const lipsa: number[] = [];
    for (let nr = nextNumber - 1; nr >= Math.max(1, nextNumber - 6000) && lipsa.length < 1200; nr--) if (!stiute.has(nr)) lipsa.push(nr);
    for (const nr of lipsa) {
      const r = await sb(`/invoice/pdf?cif=${encodeURIComponent(cif)}&seriesname=${encodeURIComponent(serie)}&number=${nr}`, 'application/octet-stream');
      const bytes = new Uint8Array(await r.arrayBuffer());
      // Un număr nefolosit (sau șters) întoarce un mesaj, nu un PDF.
      if (!r.ok || String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') {
        await c.query(`INSERT INTO factura_smartbill (firma_id, serie, numar, exista) VALUES (firma_curenta(), $1, $2, false) ON CONFLICT DO NOTHING`, [serie, nr]);
        continue;
      }
      const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
      const f = dinFactura(text);
      await c.query(
        `INSERT INTO factura_smartbill (firma_id, serie, numar, data, client, telefon, email, comanda, total)
         VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (firma_id, serie, numar) DO UPDATE SET
           data = EXCLUDED.data, client = EXCLUDED.client, telefon = EXCLUDED.telefon, email = EXCLUDED.email,
           comanda = EXCLUDED.comanda, total = EXCLUDED.total, exista = true, citit_la = now()`,
        [serie, nr, f.data, f.client, f.telefon, f.email, f.comanda, f.total]);
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- potrivirea

/**
 * Fiecare colet, cu comanda lui: întâi după AWB (xConnector știe AWB-ul fiecărei
 * comenzi), apoi după numărul comenzii din referință, apoi, pentru coletele făcute
 * direct la curier (schimburi), după telefon —
 * cea mai recentă comandă a aceluiași client, din același brand când îl știm.
 */
async function potriveste(c: PoolClient) {
  // Fan dă viramentele contului întreg, oricare ar fi clientul cerut: brandul vine din AWB.
  await c.query(
    `UPDATE ramburs_virat v SET magazin_id = k.magazin_id FROM colet_curier k
      WHERE k.curier = v.curier AND k.awb = v.awb AND k.magazin_id IS NOT NULL AND v.magazin_id IS DISTINCT FROM k.magazin_id`);
  // Numărul comenzii scris în referință: „Schimb 23142/ Azaleea", „24685- SCHIMB NAELLA".
  await c.query(
    `UPDATE colet_curier k SET comanda = x.nume, magazin_id = coalesce(k.magazin_id, x.magazin_id), potrivire = 'referinta'
       FROM xc_comanda x
      WHERE k.potrivire IS DISTINCT FROM 'awb' AND k.referinta ~ '\\d{4,6}'
        AND x.nume = '#' || substring(k.referinta FROM '(\\d{4,6})') AND (k.magazin_id IS NULL OR x.magazin_id = k.magazin_id)
        AND (k.comanda IS DISTINCT FROM x.nume OR k.potrivire IS DISTINCT FROM 'referinta')`);
  await c.query(
    `UPDATE colet_curier k SET comanda = x.nume, magazin_id = coalesce(k.magazin_id, x.magazin_id), potrivire = 'awb'
       FROM xc_comanda x WHERE k.awb = ANY(x.awb) AND (k.comanda IS DISTINCT FROM x.nume OR k.potrivire IS DISTINCT FROM 'awb')`);
  await c.query(
    `WITH p AS (
       SELECT k.id, x.nume, x.magazin_id FROM colet_curier k
       CROSS JOIN LATERAL (
         SELECT x.nume, x.magazin_id FROM xc_comanda x
          WHERE right(regexp_replace(coalesce(x.telefon, ''), '\\D', '', 'g'), 9) = right(regexp_replace(k.telefon, '\\D', '', 'g'), 9)
            AND (k.magazin_id IS NULL OR x.magazin_id = k.magazin_id)
          ORDER BY x.creata_la DESC NULLS LAST LIMIT 1) x
        WHERE (k.potrivire IS NULL OR k.potrivire = 'telefon') AND length(regexp_replace(coalesce(k.telefon, ''), '\\D', '', 'g')) >= 9)
     UPDATE colet_curier k SET comanda = p.nume, magazin_id = coalesce(k.magazin_id, p.magazin_id), potrivire = 'telefon'
       FROM p WHERE p.id = k.id`);
}

// ---------------------------------------------------------------- tot

export async function sincronizeazaFinanciar(): Promise<RezultatFinanciar[]> {
  const firma = firmaDinMediu();
  const magazine = await caFirma(firma, async (c) => (await c.query<{ id: string; cod: string; fan_client_id: string | null }>(
    `SELECT id, cod, fan_client_id FROM magazin WHERE activ ORDER BY cod`)).rows);
  const branduri: Branduri = await caFirma(firma, async (c) => (await c.query<{ id: string; nume: string }>(
    `SELECT m.id, b.nume FROM magazin m JOIN brand b ON b.id = m.brand_id`)).rows.map((r) => ({ id: r.id, cheie: simplu(r.nume) })));
  const rez: RezultatFinanciar[] = [];
  const pas = async (sursa: string, fn: (c: PoolClient) => Promise<number>) => {
    try {
      const citite = await caFirma(firma, async (c) => { const n = await fn(c); await gata(c, sursa, null); return n; });
      rez.push({ sursa, citite });
    } catch (e) {
      const eroare = (e as Error).message;
      await caFirma(firma, (c) => gata(c, sursa, eroare)).catch(() => {});
      rez.push({ sursa, eroare });
    }
  };
  for (const m of magazine) await pas(`xc:${m.cod}`, (c) => citesteXconnector(c, m));
  for (const m of magazine) if (m.fan_client_id) await pas(`fan:${m.fan_client_id}`, (c) => citesteFan(c, { ...m, fan_client_id: m.fan_client_id! }, branduri));
  await pas('gls', (c) => citesteGls(c, branduri));
  // Facturile făcute direct în SmartBill (după xConnector, ca să se știe ce numere are el).
  await pas('smartbill', citesteSmartBill);
  // Cardul, din Shopify Payments: prima dată 60 de zile, apoi ultimele câteva.
  for (const m of magazine) await pas(`card:${m.cod}`, async (c) => citestePlatiCard(c, m.id, await deUnde(c, `card:${m.cod}`)));
  await caFirma(firma, potriveste);
  return rez;
}
