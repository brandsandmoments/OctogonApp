import Link from 'next/link';
import AlegeOameni from './AlegeOameni';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import {
  corecteaza, fisaTaiere, incepe, materialeCroite, OPERATII, salveazaMaterialCroit, salveazaTaierea, scoateDinTaiere, scrieMetri,
  schimbaDificultateTaiere, stergeMaterialCroit, termina, type FisaTaiere, type MaterialCroit, type Operatie, type OperatieScrisa,
} from '../../../lib/croitTaiere';
import { cantitate, numarDinFormular } from '../../../lib/format';
import { motiveCroit } from '../../../lib/planificare';
import { cere, cereOperatorCroit, lucreazaLaCroit } from '../../../lib/sesiune';
import { poate } from '../../../lib/acces';
import { DIFICULTATI, dificultateDin } from '../../../lib/dificultate';
import '../../../formulare.css';

export const dynamic = 'force-dynamic';

const OPERATII_TAIERE: Operatie[] = ['intins', 'taiat', 'separat', 'termocolat'];

const inapoi = (id: string, e?: string | null): never =>
  redirect(e ? `/croit/taiere/${id}?eroare=${encodeURIComponent(e)}` : `/croit/taiere/${id}`);

const ora = (t: string | null) => (t ? t.replace('T', ' ') : '');

/** Înapoi la materialele croite: aceeași adresă cu altă ancoră nu reîncarcă pagina, deci o cerem. */
const laMateriale = (id: string, e?: string | null): never => {
  revalidatePath(`/croit/taiere/${id}`);
  redirect(`/croit/taiere/${id}${e ? `?eroare=${encodeURIComponent(e)}` : ''}#materiale`);
};

/**
 * Fișa taierii, cum o folosește croitul pe tabletă. Pe fiecare tip de material:
 * cine întinde (și că a verificat fața), cine taie, cine termocolează, de la ce
 * oră la ce oră; metrii folosiți și defectele, pe fiecare culoare. Apoi
 * împerecherea pieselor, iar la final croitul efectiv al fiecărei comenzi.
 *
 * Operatorii bifează operațiile, metrii și defectele; șefa de croit face taierea,
 * o corectează și înregistrează croitul. Ce nu se croiește se întoarce în „rămas
 * de croit", de unde tot ea stinge comanda.
 */
export default async function FisaTaierePagina({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string }>;
}) {
  const u = await cere('croit');
  const lucreaza = lucreazaLaCroit(u);
  const sef = poate(u, 'croit', 'modifica');
  const [{ id }, { eroare }] = await Promise.all([params, searchParams]);
  const [f, motive, materiale] = await Promise.all([fisaTaiere(id), motiveCroit(), materialeCroite(id)]);
  if (!f) notFound();
  const deschise = f.loturi.filter((l) => !l.croit_la);
  const neinceputa = f.operatii.length === 0;
  const ultima = f.loturi.length === 1;
  // Cel logat, dacă e și în Oameni producție (după nume): pornește bifat la prima operație.
  const eu = [...f.oameni, ...f.altii].find((o) => o.nume.toLowerCase() === u.nume.toLowerCase())?.id ?? '';

  async function incepeOp(date: FormData) {
    'use server';
    await cereOperatorCroit();
    // Unul sau mai mulți oameni deodată pe aceeași operație: fiecare primește rândul lui.
    const cine = date.getAll('operator').map(String).filter(Boolean);
    if (cine.length === 0) inapoi(id, 'Bifează cine lucrează.');
    const erori: string[] = [];
    for (const om of cine) {
      const e = await incepe(id, String(date.get('componenta') ?? '') || null, String(date.get('operatie')) as Operatie, om);
      if (e) erori.push(e);
    }
    inapoi(id, erori[0] ?? null);
  }
  async function terminaOp(date: FormData) {
    'use server';
    await cereOperatorCroit();
    inapoi(id, await termina(String(date.get('id')), date.get('fata') === '1'));
  }
  async function corecteazaOp(date: FormData) {
    'use server';
    await cere('croit', 'modifica');
    inapoi(id, await corecteaza(String(date.get('id')), String(date.get('operator')), String(date.get('inceput') ?? ''),
      String(date.get('terminat') ?? ''), date.get('fata') === '1', String(date.get('observatii') ?? '')));
  }
  async function material(date: FormData) {
    'use server';
    await cereOperatorCroit();
    inapoi(id, await scrieMetri(id, String(date.get('componenta')), String(date.get('produs')),
      String(date.get('metri') ?? '').trim() ? numarDinFormular(date.get('metri')) ?? -1 : null,
      String(date.get('defecte') ?? '')));
  }
  // Toată taierea dintr-o salvare: ce se taie acum (pe mărimi) și cine a lucrat la fiecare operație.
  async function salveaza(date: FormData) {
    'use server';
    await cere('croit', 'modifica');
    const cantitati = new Map<string, Map<string, number>>();
    for (const [k, v] of date.entries()) {
      if (!k.startsWith('t:')) continue;
      const [, lot, marime] = k.split(':');
      cantitati.set(lot, (cantitati.get(lot) ?? new Map()).set(marime, String(v).trim() === '' ? 0 : numarDinFormular(v) ?? -1));
    }
    const oameni = new Map(OPERATII_TAIERE.map((op) => [op, date.getAll(`om:${op}`).map(String).filter(Boolean)] as [Operatie, string[]]));
    inapoi(id, await salveazaTaierea({ taiereId: id, cantitati, oameni }));
  }
  // Materialele croite (căptușeală, stofă…): numele și bucățile pe comandă și mărime.
  async function salvMaterial(date: FormData) {
    'use server';
    await cereOperatorCroit();
    const bucati = new Map<string, Map<string, number>>();
    for (const [k, v] of date.entries()) {
      if (!k.startsWith('q:')) continue;
      const [, lot, marime] = k.split(':');
      bucati.set(lot, (bucati.get(lot) ?? new Map()).set(marime, String(v).trim() === '' ? 0 : numarDinFormular(v) ?? -1));
    }
    const e = await salveazaMaterialCroit(id, String(date.get('material') ?? ''), bucati, String(date.get('vechi') ?? '') || undefined);
    laMateriale(id, e);
  }
  async function stergeMaterial(date: FormData) {
    'use server';
    await cereOperatorCroit();
    await stergeMaterialCroit(id, String(date.get('material')));
    laMateriale(id);
  }
  async function dificultate(date: FormData) {
    'use server';
    await cereOperatorCroit();
    await schimbaDificultateTaiere(id, dificultateDin(date.get('dificultate')));
    revalidatePath(`/croit/taiere/${id}`);
    inapoi(id);
  }
  async function scoate(date: FormData) {
    'use server';
    await cere('croit', 'modifica');
    const e = await scoateDinTaiere(id, String(date.get('lot')));
    if (!e && ultima) redirect('/croit?vedere=ramas');
    inapoi(id, e);
  }

  // O operație, cu fiecare om care lucrează la ea pe rândul lui (de la ce oră, până la ce
  // oră) și, dedesubt, lista cu „+ Adaugă operator": unul sau mai mulți încep deodată,
  // și se mai pot adăuga oricând, pe oricine.
  const Rand = ({ operatie, componenta }: { operatie: Operatie; componenta: string | null }) => {
    const pe = f.operatii.filter((x) => x.operatie === operatie && x.componenta_id === componenta)
      .sort((a, b) => a.inceput_la.localeCompare(b.inceput_la));
    return (
      <tr>
        <td><strong>{OPERATII[operatie]}</strong>{operatie === 'termocolat' && <span className="slab"> · dacă e cazul</span>}
          {pe.length > 1 && <span className="slab"> · {pe.length} oameni</span>}</td>
        <td>
          {pe.map((o) => (
            <div key={o.id} className="om-operatie">
              {!o.terminat_la ? (
                <form action={terminaOp} className="in-rand"><fieldset disabled={!lucreaza} className="fara-chenar">
                  <span><strong>{o.operator}</strong> · de la {ora(o.inceput_la).slice(11)}</span>
                  <input type="hidden" name="id" value={o.id} />
                  {operatie === 'intins' && (
                    <label className="bifa"><input type="checkbox" name="fata" value="1" required /> am verificat fața materialului</label>
                  )}
                  <button>Termină acum</button>
                </fieldset></form>
              ) : (
                <span>
                  <strong>{o.operator}</strong> · {ora(o.inceput_la)} – {ora(o.terminat_la).slice(11)}
                  {operatie === 'intins' && <span className="slab"> · fața verificată</span>}
                  {o.observatii && <span className="slab"> · {o.observatii}</span>}
                </span>
              )}
              {sef && <Corectura o={o} f={f} actiune={corecteazaOp} />}
            </div>
          ))}
          <form action={incepeOp} className="in-rand"><fieldset disabled={!lucreaza} className="fara-chenar">
            <input type="hidden" name="operatie" value={operatie} />
            <input type="hidden" name="componenta" value={componenta ?? ''} />
            <AlegeOameni croit={f.oameni.filter((x) => !pe.some((o) => o.operator_id === x.id))}
              altii={f.altii.filter((x) => !pe.some((o) => o.operator_id === x.id))}
              ales={!pe.length && f.oameni.some((x) => x.id === eu) ? eu : ''} dezactivat={!lucreaza} />
            <button className={pe.length ? 'secundar' : ''}>{pe.length ? 'Pornește-i și pe ei' : 'Începe acum'}</button>
          </fieldset></form>
        </td>
      </tr>
    );
  };

  return (
    <main className="formular lat">
      <p className="slab"><Link href="/croit?vedere=croite">← Croite</Link></p>
      <h1>{f.taiere.cod} · {f.taiere.model}</h1>
      <p className="sumar">
        {f.loturi.length} {f.loturi.length === 1 ? 'comandă' : 'comenzi'} ·{' '}
        {f.loturi.reduce((s, l) => s + l.marimi.reduce((a, m) => a + m.cerut, 0), 0)} buc cerute ·{' '}
        făcută {f.taiere.facuta_la ?? '—'} ·{' '}
        <strong>{deschise.length ? 'în lucru' : 'croită'}</strong>
        {' · '}<a href={`/croit/fisa?taiere=${id}`} target="_blank" rel="noopener">Printează foaia de croit</a>
      </p>
      <form action={dificultate} className="in-rand dificultate-taiere">
        <span className="slab">Dificultate (contează în clasament):</span>
        <select name="dificultate" defaultValue={String(f.taiere.dificultate)} disabled={!lucreaza} aria-label="Gradul de dificultate al taierii">
          {([1, 2, 3] as const).map((d) => <option key={d} value={d}>{DIFICULTATI[d].nume}</option>)}
        </select>
        {lucreaza && <button className="secundar">Salvează</button>}
        <span className={`insigna ${DIFICULTATI[f.taiere.dificultate].ton}`}>{DIFICULTATI[f.taiere.dificultate].nume} · ×{DIFICULTATI[f.taiere.dificultate].pondere}</span>
      </form>
      {eroare && <p className="eroare">{eroare}</p>}

      {deschise.length > 0 ? (
        <>
          {f.componente.length > 0 && f.culori.length > 0 && (
            <details>
              <summary className="slab">metri de material pe culori (opțional, înainte de salvare)</summary>
              {f.componente.map((c) => {
                const mat = f.culori.filter((m) => m.componenta_id === c.id);
                return mat.length === 0 ? null : (
                  <table key={c.id}>
                    <thead><tr><th>{c.nume} · culoare</th><th className="nr">Teoretic</th><th>Metri folosiți · defecte</th></tr></thead>
                    <tbody>
                      {mat.map((m) => (
                        <tr key={m.produs_id}>
                          <td><strong>{m.culoare}</strong> · <Link href={`/stoc/${m.material_id}`}>{m.material}</Link></td>
                          <td className="nr">{cantitate(m.teoretic)} <span className="slab">{m.unitate}</span></td>
                          <td>
                            <form action={material} className="in-rand"><fieldset disabled={!lucreaza} className="fara-chenar">
                              <input type="hidden" name="componenta" value={c.id} />
                              <input type="hidden" name="produs" value={m.produs_id} />
                              <input name="metri" defaultValue={m.metri ? cantitate(m.metri) : ''} inputMode="decimal" className="bucati"
                                     aria-label={`Metri ${m.culoare}`} />
                              <input name="defecte" defaultValue={m.defecte ?? ''} placeholder="fără defecte" aria-label={`Defecte ${m.culoare}`} />
                              <button className="secundar">Salvează</button>
                            </fieldset></form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })}
            </details>
          )}

          <form action={salveaza} className="fisa-taiere"><fieldset disabled={!sef} className="fara-chenar">
            <h2>1 · Ce se taie acum</h2>
            <p className="slab">Pe fiecare mărime, câte bucăți tai acum. Ce nu tai rămâne în rămas de croit, pentru altă taiere.</p>
            <table>
              <tbody>
                {deschise.map((l) => (
                  <tr key={l.id}>
                    <td><strong>{l.produs}</strong> <span className="slab">{l.cod}</span></td>
                    <td>
                      <span className="marimi-croit">
                        {l.marimi.map((x) => (
                          <label key={x.marime_id}>
                            <span className="slab">{x.marime} · din {x.maxim}</span>
                            <input name={`t:${l.id}:${x.marime_id}`} defaultValue={x.cerut} inputMode="numeric" className="bucati"
                                   aria-label={`${l.produs} ${x.marime}, cel mult ${x.maxim}`} />
                          </label>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2>2 · Cine a lucrat</h2>
            <table>
              <tbody>
                {OPERATII_TAIERE.map((op) => {
                  const deja = f.operatii.filter((o) => o.operatie === op);
                  return (
                    <tr key={op}>
                      <td><strong>{OPERATII[op]}</strong>{op === 'termocolat' && <span className="slab"> · dacă e cazul</span>}
                        {deja.length > 0 && <div className="slab">deja: {deja.map((o) => o.operator).join(', ')}</div>}</td>
                      <td>
                        <AlegeOameni nume={`om:${op}`} croit={f.oameni} altii={f.altii} dezactivat={!sef}
                          ales={(op === 'intins' || op === 'taiat') && f.oameni.some((x) => x.id === eu) ? eu : ''}
                          obligatoriu={(op === 'intins' || op === 'taiat') && deja.length === 0} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="actiuni"><button className="principal">Salvează taierea</button></div>
            <p className="slab">La salvare: bucățile scrise trec drept croite (și scad materialul din stoc), oamenii se trec pe operații.</p>
          </fieldset></form>

          {neinceputa && sef && (
            <details>
              <summary className="slab">scoate o comandă întreagă din taiere</summary>
              <table>
                <tbody>
                  {deschise.map((l) => (
                    <tr key={l.id}>
                      <td>{l.cod} <span className="slab">{l.produs}</span></td>
                      <td>
                        <form action={scoate} className="in-rand"><fieldset className="fara-chenar">
                          <input type="hidden" name="lot" value={l.id} />
                          <button>Scoate — se întoarce în rămas de croit</button>
                        </fieldset></form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      ) : (
        <>
          <h2>Cine a lucrat</h2>
          <table>
            <tbody>
              {OPERATII_TAIERE.map((op) => {
                const pe = f.operatii.filter((o) => o.operatie === op);
                return (
                  <tr key={op}>
                    <td><strong>{OPERATII[op]}</strong></td>
                    <td>
                      {pe.length === 0 ? <span className="slab">—</span> : pe.map((o) => (
                        <div key={o.id} className="om-operatie">
                          <span><strong>{o.operator}</strong>{o.terminat_la && <span className="slab"> · {ora(o.terminat_la)}</span>}</span>
                          {sef && <Corectura o={o} f={f} actiune={corecteazaOp} />}
                        </div>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h2>După tăiere</h2>
          <table><tbody><Rand operatie="imperecheat" componenta={null} /></tbody></table>
          <h2>Ce s-a croit</h2>
          <ComenziInTaiere f={f} />
          {f.rest_deschis > 0 && (
            <p className="slab">Au rămas {f.rest_deschis} buc necroite din comenzile taierii: sunt în <Link href="/croit?vedere=ramas">rămas de croit</Link>.</p>
          )}
        </>
      )}
      <MaterialeCroite f={f} materiale={materiale} editabil={lucreaza} salveaza={salvMaterial} sterge={stergeMaterial} />
    </main>
  );
}

/**
 * Materialele croite, pentru produsele din mai multe materiale: fiecare material (scris de
 * mână, nepredefinit) cu bucățile lui pe comandă și mărime. „+ Adaugă material de croit"
 * pornește cu bucățile comenzii de croit; se corectează în plus sau în minus, după ce s-a
 * tăiat de fapt din materialul acela. Diferența față de comandă se vede lângă fiecare căsuță.
 */
function MaterialeCroite({ f, materiale, editabil, salveaza, sterge }: {
  f: FisaTaiere; materiale: MaterialCroit[]; editabil: boolean;
  salveaza: (d: FormData) => Promise<void>; sterge: (d: FormData) => Promise<void>;
}) {
  const baza = (m: FisaTaiere['loturi'][number]['marimi'][number]) => m.croit ?? m.cerut;   // bucățile comenzii de croit
  const Grila = ({ mat }: { mat?: MaterialCroit }) => (
    <div className="tabel-derulant">
      <table className="grila grila-material">
        <tbody>
          {f.loturi.map((l) => (
            <tr key={l.id}>
              <td><strong>{l.cod}</strong> <span className="slab">{l.produs}</span></td>
              <td>
                <span className="marimi-croit">
                  {l.marimi.map((m) => {
                    const b = baza(m);
                    const scris = mat?.bucati.get(l.id)?.get(m.marime_id);
                    const dif = scris === undefined ? 0 : scris - b;
                    return (
                      <label key={m.marime_id}>
                        <span className="slab">{m.marime} · {b}</span>
                        {editabil
                          ? <input name={`q:${l.id}:${m.marime_id}`} defaultValue={scris ?? b} inputMode="numeric" className="bucati"
                                   aria-label={`${mat?.material ?? 'Material nou'} · ${l.cod} ${m.marime}`} />
                          : <strong>{scris ?? '—'}</strong>}
                        {dif !== 0 && <span className={`insigna ${dif > 0 ? 'albastru' : 'rosu'}`}>{dif > 0 ? `+${dif}` : dif}</span>}
                      </label>
                    );
                  })}
                </span>
              </td>
              <td className="nr slab">
                {mat ? l.marimi.reduce((s, m) => s + (mat.bucati.get(l.id)?.get(m.marime_id) ?? 0), 0) : l.marimi.reduce((s, m) => s + baza(m), 0)} buc
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <section id="materiale" className="materiale-croite">
      <h2>Materiale croite</h2>
      <p className="slab">Pentru produsele din mai multe materiale: fiecare material cu bucățile croite din el. Pornește de la bucățile comenzii (scrise lângă mărime); corectează unde s-a tăiat în plus sau în minus.</p>
      {materiale.map((mat) => (
        <div key={mat.material} className="material-croit">
          <form action={salveaza}>
            <input type="hidden" name="vechi" value={mat.material} />
            <div className="cap-material">
              {editabil ? <input name="material" defaultValue={mat.material} required aria-label="Numele materialului" /> : <strong>{mat.material}</strong>}
              {editabil && <button className="principal">Salvează</button>}
            </div>
            <Grila mat={mat} />
          </form>
          {editabil && (
            <form action={sterge} className="sterge-material">
              <input type="hidden" name="material" value={mat.material} />
              <button className="secundar">Șterge materialul</button>
            </form>
          )}
        </div>
      ))}
      {editabil && (
        <details className="material-nou">
          <summary className="buton">+ Adaugă material de croit</summary>
          <form action={salveaza} className="material-croit">
            <div className="cap-material">
              <input name="material" required placeholder="numele materialului (ex. căptușeală, stofă, inserție)" aria-label="Numele materialului" autoComplete="off" />
              <button className="principal">Salvează materialul</button>
            </div>
            <Grila />
          </form>
        </details>
      )}
    </section>
  );
}

function Oameni({ f, ales, nume = 'operator' }: { f: FisaTaiere; ales: string; nume?: string }) {
  return (
    <select name={nume} defaultValue={ales} required aria-label="Cine">
      <option value="">cine?</option>
      <optgroup label="Croit">{f.oameni.map((o) => <option key={o.id} value={o.id}>{o.nume}</option>)}</optgroup>
      <optgroup label="Alți oameni din producție">{f.altii.map((o) => <option key={o.id} value={o.id}>{o.nume}</option>)}</optgroup>
    </select>
  );
}

function Motive({ motive, nume }: { motive: { id: string; nume: string }[]; nume: string }) {
  return (
    <select name={nume} defaultValue="">
      <option value="">—</option>
      {motive.map((m) => <option key={m.id} value={m.id}>{m.nume}</option>)}
    </select>
  );
}

/** Corectura șefei de croit: omul, orele, fața, observațiile. Fără început, operația se șterge. */
function Corectura({ o, f, actiune }: { o: OperatieScrisa; f: FisaTaiere; actiune: (d: FormData) => Promise<void> }) {
  return (
    <details>
      <summary className="slab">corectează</summary>
      <form action={actiune} className="antet-comanda">
        <input type="hidden" name="id" value={o.id} />
        <label><span>Cine</span><Oameni f={f} ales={o.operator_id} /></label>
        <label><span>Început</span><input type="datetime-local" name="inceput" defaultValue={o.inceput_la} /></label>
        <label><span>Terminat</span><input type="datetime-local" name="terminat" defaultValue={o.terminat_la ?? ''} /></label>
        {o.operatie === 'intins' && (
          <label className="bifa-linie"><input type="checkbox" name="fata" value="1" defaultChecked={o.fata_verificata} /> fața verificată</label>
        )}
        <label><span>Observații</span><input name="observatii" defaultValue={o.observatii ?? ''} /></label>
        <div className="actiuni"><button className="secundar">Salvează corectura</button></div>
        <p className="slab lat">Șterge ora de început ca să anulezi operația.</p>
      </form>
    </details>
  );
}

function ComenziInTaiere({ f, editabil = false }: { f: FisaTaiere; editabil?: boolean }) {
  return (
    <div className="tabel-derulant">
      <table className="grila">
        <thead><tr><th>Comandă</th><th>Model</th><th>Produs</th><th>Pe mărimi: cerut → croit</th><th className="nr">Total</th><th className="nr">Rămas de croit</th></tr></thead>
        <tbody>
          {f.loturi.map((l) => (
            <tr key={l.id}>
              <td><Link href={`/croit/${l.id}`}>{l.cod}</Link> <span className="slab">{l.tip} · P{l.prioritate}</span></td>
              <td>{f.taiere.model}</td>
              <td>{l.produs}</td>
              <td>
                <span className="marimi-croit">
                  {l.marimi.map((m) => (
                    <label key={m.marime_id}>
                      <span className="slab">{m.marime} · {m.cerut}</span>
                      {editabil && !l.croit_la
                        ? <input name={`q:${l.id}:${m.marime_id}`} defaultValue={m.cerut} inputMode="numeric" className="bucati"
                                 aria-label={`Croit ${l.cod} ${m.marime}`} />
                        : <strong className={m.croit !== null && m.croit !== m.cerut ? 'lipsa' : ''}>{m.croit ?? '—'}</strong>}
                      {l.croit_la && m.rest > 0 && <span className="slab">rămas {m.rest}</span>}
                    </label>
                  ))}
                </span>
              </td>
              <td className="nr">
                {l.marimi.reduce((s, m) => s + m.cerut, 0)}
                {l.croit_la && <> → {l.marimi.reduce((s, m) => s + (m.croit ?? 0), 0)}</>}
              </td>
              <td className="nr">{(() => { const r = l.marimi.reduce((s, m) => s + m.rest, 0); return r ? <strong className="lipsa">{r}</strong> : <span className="slab">—</span>; })()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
