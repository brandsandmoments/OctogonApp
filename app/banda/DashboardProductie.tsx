import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Termen } from '../Insigne';
import { azi, durata, numarDinFormular, potriveste } from '../lib/format';
import { luni } from '../lib/perioade';
import { cere } from '../lib/sesiune';
import { iesitGata, transeSimple } from '../lib/banda';
import { personal, utilaje } from '../lib/alocare';
import { parametriTimp } from '../lib/parametriTimp';
import { dataRo } from '../lib/timp';
import {
  adaugaAlocareComanda, comenziInProductie, daInLucruCuloare, gataEstimat, salveazaTimpOameni, stergeAlocareComanda,
  type ComandaProd, type CuloareProd,
} from '../lib/productieComenzi';

/** Fazele obișnuite din atelier, sugerate când modelul n-are încă procesul tehnologic trecut. */
const FAZE_OBISNUITE = ['Cusut', 'Surfilat', 'Tighel', 'Butoniere', 'Nasturi', 'Călcat interfazic', 'Control interfazic', 'Călcat final', 'CTC și ambalat'];

/** Înapoi la comanda deschisă (cu eroarea, dacă a fost una). */
const inapoi = (numar: string, e?: string | null): never =>
  redirect(`/banda?deschis=${encodeURIComponent(numar)}${e ? `&eroare=${encodeURIComponent(e)}` : ''}#c-${encodeURIComponent(numar)}`);

const culoare = (produs: string, model: string) => {
  const m = new Set(model.toLowerCase().split(/[\s,]+/));
  return produs.split(/\s+/).slice(1).filter((w) => !m.has(w.toLowerCase())).join(' ') || produs;
};

/**
 * Producția ca un dashboard: sus, cât e de dat în lucru, cât e în lucru, ce a ieșit
 * gata și ce e întârziat; dedesubt, comenzile din care s-a croit, pe PSF/PSC. Pe
 * fiecare culoare, mărimile — cerut, croit, dat în lucru, ieșit gata — și, chiar
 * alături, rândul „Intră acum". Deschisă, comanda arată cine lucrează: minutele pe
 * bucată, câți oameni (cu ziua estimată de gata), fazele cu mașina și omul, și
 * tranșele în lucru cu „A ieșit gata".
 */
export default async function DashboardProductie({ m, cauta, deschis }: { m: boolean; cauta?: string; deschis?: string }) {
  const zi = azi();
  const [toate, inLucru, gata, oameni, masini, param] = await Promise.all([
    comenziInProductie(), transeSimple(false), transeSimple(true), personal(), utilaje(), parametriTimp(),
  ]);
  const comenzi = toate.filter((c) => potriveste(cauta, c.numar, c.model, ...c.culori.map((l) => l.produs)));
  const saptamana = luni(zi);
  const intarziate = toate.flatMap((c) => c.culori).filter((l) => l.data_ceruta < zi && l.gata < l.cerut).length;

  async function da(date: FormData) {
    'use server';
    await cere('banda', 'modifica');
    const linie = String(date.get('linie'));
    const numar = String(date.get('numar'));
    const toateAcum = await comenziInProductie();
    const l = toateAcum.flatMap((c) => c.culori).find((x) => x.linie_id === linie);
    if (!l) return inapoi(numar, 'Culoarea nu mai are nimic croit de dat în lucru.');
    const cantitati = new Map(l.marimi.map((x) => [x.marime_id,
      date.get('tot') ? x.de_dat : numarDinFormular(date.get(`q:${x.marime_id}`)) ?? 0] as [string, number]));
    inapoi(numar, await daInLucruCuloare(linie, cantitati));
  }
  async function timp(date: FormData) {
    'use server';
    await cere('banda', 'modifica');
    inapoi(String(date.get('numar')), await salveazaTimpOameni(String(date.get('comanda')),
      numarDinFormular(date.get('minute')), numarDinFormular(date.get('oameni'))));
  }
  async function aloca(date: FormData) {
    'use server';
    await cere('banda', 'modifica');
    inapoi(String(date.get('numar')), await adaugaAlocareComanda(String(date.get('comanda')), String(date.get('faza') ?? ''),
      String(date.get('utilaj') ?? ''), String(date.get('om') ?? '')));
  }
  async function sterge(date: FormData) {
    'use server';
    await cere('banda', 'modifica');
    await stergeAlocareComanda(String(date.get('id')));
    inapoi(String(date.get('numar')));
  }
  async function aIesit(date: FormData) {
    'use server';
    await cere('banda', 'modifica');
    for (const id of date.getAll('id').map(String)) await iesitGata(id);
    inapoi(String(date.get('numar')));
  }

  return (
    <>
      <div className="carduri-productie">
        <div><span>Croite, de dat în lucru</span><strong>{toate.reduce((s, c) => s + c.de_dat, 0)} buc</strong></div>
        <div><span>În lucru</span><strong>{inLucru.reduce((s, t) => s + t.bucati, 0)} buc</strong></div>
        <div><span>Ieșite gata săptămâna asta</span><strong>{gata.filter((t) => (t.gata_la ?? '') >= saptamana).reduce((s, t) => s + t.bucati, 0)} buc</strong></div>
        <div className={intarziate ? 'rosu' : ''}><span>Întârziate</span><strong>{intarziate} {intarziate === 1 ? 'culoare' : 'culori'}</strong></div>
      </div>

      {comenzi.length === 0 ? <p className="slab">Nimic croit care să aștepte sau să fie în lucru.</p> : comenzi.map((c) => (
        <details key={c.comanda_id} id={`c-${c.numar}`} className="comanda-productie" open={deschis === c.numar}>
          <summary>
            <strong>{c.numar}</strong>
            <span className="slab">{c.model} · {c.brand} · {c.tip} · P{c.prioritate}</span>
            <Termen data={c.data_ceruta} gata={c.gata >= c.culori.reduce((s, l) => s + l.cerut, 0)} />
            <span className="cifre">
              {c.croit} croit · {c.in_lucru} în lucru · <strong>{c.de_dat} de dat</strong>
              {c.alocari.length > 0 && ((n) => <> · {n} {n === 1 ? 'om' : 'oameni'}</>)(new Set(c.alocari.map((a) => a.om)).size)}
            </span>
          </summary>

          {c.culori.filter((l) => l.croit > 0).map((l) => <Culoare key={l.linie_id} c={c} l={l} m={m} da={da} />)}

          <CineLucreaza c={c} m={m} oameni={oameni} masini={masini.map((x) => x.nume)} orePeZi={param.orePeZi} zi={zi}
            transe={inLucru.filter((t) => t.comanda === c.numar)} timp={timp} aloca={aloca} sterge={sterge} aIesit={aIesit} />
        </details>
      ))}
    </>
  );
}

/** O culoare: mărimile cu ce s-a cerut, croit, dat în lucru, ieșit gata; alături, „Intră acum". */
function Culoare({ c, l, m, da }: { c: ComandaProd; l: CuloareProd; m: boolean; da: (d: FormData) => Promise<void> }) {
  return (
    <form action={da} className="culoare-productie">
      <input type="hidden" name="linie" value={l.linie_id} />
      <input type="hidden" name="numar" value={c.numar} />
      <div className="tabel-derulant">
        <table className="marimi-comanda">
          <thead>
            <tr><th>{culoare(l.produs, c.model)}</th>{l.marimi.map((x) => <th key={x.marime_id}>{x.marime}</th>)}<th>Total</th></tr>
          </thead>
          <tbody>
            {([['cerut', 'Cerut'], ['croit', 'Croit'], ['dat', 'Dat în lucru'], ['gata', 'Ieșit gata']] as const).map(([k, nume]) => (
              <tr key={k} className={k === 'cerut' ? 'cerut' : ''}>
                <td className="ce slab">{nume}</td>
                {l.marimi.map((x) => <td key={x.marime_id}>{x[k] || <span className="slab">—</span>}</td>)}
                <td className="total">{l[k] || <span className="slab">—</span>}</td>
              </tr>
            ))}
            <tr className="intra-acum">
              <td className="ce"><strong>Intră acum</strong></td>
              {l.marimi.map((x) => (
                <td key={x.marime_id}>
                  {x.de_dat > 0
                    ? <input name={`q:${x.marime_id}`} inputMode="numeric" className="bucati" placeholder={String(x.de_dat)} disabled={!m}
                             aria-label={`${l.produs} ${x.marime}: intră acum, din ${x.de_dat}`} />
                    : <span className="slab">—</span>}
                </td>
              ))}
              <td className="total">{l.de_dat || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {m && l.de_dat > 0 && (
        <div className="actiuni-culoare">
          <button name="tot" value="1" className="secundar">Tot ({l.de_dat})</button>
          <button className="principal">Dă în lucru</button>
        </div>
      )}
    </form>
  );
}

/** Comanda deschisă: minute pe bucată, câți oameni (ziua estimată), fazele cu mașina și omul, tranșele în lucru. */
function CineLucreaza({ c, m, oameni, masini, orePeZi, zi, transe, timp, aloca, sterge, aIesit }: {
  c: ComandaProd; m: boolean; oameni: { id: string; nume: string; functii: string[] }[]; masini: string[];
  orePeZi: number; zi: string; transe: Awaited<ReturnType<typeof transeSimple>>;
  timp: (d: FormData) => Promise<void>; aloca: (d: FormData) => Promise<void>; sterge: (d: FormData) => Promise<void>; aIesit: (d: FormData) => Promise<void>;
}) {
  const estimat = gataEstimat(c, orePeZi, zi);
  const faze = [...new Set([...c.faze_model, ...FAZE_OBISNUITE])];
  const dinBanda = oameni.filter((o) => !o.functii.some((f) => ['taietor', 'croit_auxiliar', 'sef_croit'].includes(f)));
  const altii = oameni.filter((o) => !dinBanda.includes(o));
  return (
    <section className="cine-lucreaza">
      <h4>Cine lucrează</h4>
      <form action={timp} className="in-rand">
        <input type="hidden" name="comanda" value={c.comanda_id} />
        <input type="hidden" name="numar" value={c.numar} />
        <label><span className="slab">Minute pe bucată</span>
          <input name="minute" inputMode="decimal" className="bucati" defaultValue={c.timp_min_buc ?? ''} placeholder="ex. 38" disabled={!m} /></label>
        <label><span className="slab">Câți oameni</span>
          <input name="oameni" inputMode="numeric" className="bucati" defaultValue={c.oameni ?? ''} placeholder="ex. 6" disabled={!m} /></label>
        {m && <button className="secundar">Salvează</button>}
        <span className="slab">
          {estimat ? <>Estimat gata: <strong>{dataRo(estimat)}</strong> · {c.culori.reduce((s, l) => s + l.cerut, 0) - c.gata} buc rămase</>
            : 'Scrie minutele pe bucată și câți oameni, ca să vezi ziua estimată de gata.'}
        </span>
      </form>

      <table className="marimi-comanda alocari-comanda">
        <thead><tr><th>Fază</th><th>Mașină</th><th>Om</th><th /></tr></thead>
        <tbody>
          {c.alocari.map((a) => (
            <tr key={a.id}>
              <td className="ce">{a.faza}</td><td className="ce slab">{a.utilaj ?? '—'}</td><td className="ce">{a.om}</td>
              <td>{m && (
                <form action={sterge}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="numar" value={c.numar} />
                  <button className="secundar" aria-label={`Scoate ${a.om} de la ${a.faza}`}>×</button></form>
              )}</td>
            </tr>
          ))}
          {m && (
            <tr>
              <td colSpan={4}>
                <form action={aloca} className="in-rand">
                  <input type="hidden" name="comanda" value={c.comanda_id} />
                  <input type="hidden" name="numar" value={c.numar} />
                  <input name="faza" list={`faze-${c.comanda_id}`} placeholder="faza" required aria-label="Faza" />
                  <datalist id={`faze-${c.comanda_id}`}>{faze.map((f) => <option key={f} value={f} />)}</datalist>
                  <select name="utilaj" defaultValue="" aria-label="Mașina">
                    <option value="">mașina</option>
                    {masini.map((x) => <option key={x}>{x}</option>)}
                  </select>
                  <select name="om" defaultValue="" required aria-label="Omul">
                    <option value="">cine?</option>
                    <optgroup label="Producție">{dinBanda.map((o) => <option key={o.id} value={o.id}>{o.nume}</option>)}</optgroup>
                    <optgroup label="Croit">{altii.map((o) => <option key={o.id} value={o.id}>{o.nume}</option>)}</optgroup>
                  </select>
                  <button className="secundar">+ Adaugă</button>
                </form>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {transe.length > 0 && (
        <>
          <h4>În lucru acum</h4>
          <table className="marimi-comanda">
            <tbody>
              {transe.map((t) => (
                <tr key={t.id}>
                  <td className="ce"><Link href={`/banda/${t.id}`}>{culoare(t.produs, t.model)}</Link></td>
                  <td className="ce slab">{t.marimi}</td>
                  <td>{t.bucati} buc</td>
                  <td className="ce slab">din {t.intrat_ora} · {durata(t.minute)}</td>
                  <td>{m && (
                    <form action={aIesit}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="numar" value={c.numar} />
                      <button className="secundar">A ieșit gata</button></form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {m && transe.length > 1 && (
            <form action={aIesit}>
              {transe.map((t) => <input key={t.id} type="hidden" name="id" value={t.id} />)}
              <input type="hidden" name="numar" value={c.numar} />
              <button className="secundar">Toate au ieșit gata</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
