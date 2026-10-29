import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import {
  cost, fisa, materialNou, materialPeCuloare, pretPeCuloare, salveazaComponenta, salveazaManopera, salveazaMasuri, stergeComponentaFisa,
  type ComponentaFisa, type Fisa,
} from '../../../lib/fisa';
import { Fragment } from 'react';
import CautaMaterial from '../../../CautaMaterial';
import { numarDinFormular } from '../../../lib/format';
import { cere, poateModifica } from '../../../lib/sesiune';
import '../../../formulare.css';

export const dynamic = 'force-dynamic';

// O redirecționare pe aceeași adresă, cu altă ancoră, nu reîncarcă pagina: o cerem explicit.
const inapoi = (id: string, e?: string | null, ancora = ''): never => {
  revalidatePath(`/dezvoltare/${id}/fisa`);
  redirect(`/dezvoltare/${id}/fisa${e ? `?eroare=${encodeURIComponent(e)}` : ''}${ancora}`);
};
const lei = (n: number) => n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const UNITATI = ['m', 'm2', 'kg', 'buc', 'set'];
const MASURI_IMPLICITE = ['BUST', 'TALIE', 'ȘOLD', 'LUNGIME'];

/**
 * Fișa de produs, cum o completează dezvoltarea: materiile prime și accesoriile
 * (furnizor, cod, consum, preț, materialul fiecărei culori), tabelul de mărimi și
 * manopera; jos, costul pe bucată pe fiecare culoare. Se descarcă în Excel sau PDF.
 * La aprobarea mostrei devine rețeta modelului.
 */
export default async function FisaPagina({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string }>;
}) {
  await cere(['dezvoltare', 'comenzi']);
  const m = await poateModifica('dezvoltare');
  const [{ id }, { eroare }] = await Promise.all([params, searchParams]);
  const f = await fisa(id);
  if (!f) notFound();
  const d = f.dezvoltare;
  const marimi = f.marimi;

  async function componenta(date: FormData) {
    'use server';
    await cere('dezvoltare', 'modifica');
    const s = (k: string) => String(date.get(k) ?? '');
    const compId = s('id') || undefined;
    const e = await salveazaComponenta(id, {
      id: compId, nume: s('nume'), tip: s('tip'), unitate: s('unitate'), consum: numarDinFormular(s('consum')) ?? 0,
      principal: s('principal') === '1', furnizor: s('furnizor'), cod: s('cod'),
      materialId: s('material'), pret: s('pret').trim() ? numarDinFormular(s('pret')) ?? -1 : null,
    });
    if (e || !compId) inapoi(id, e, '#componente');
    for (const culoare of date.getAll('culoare').map(String)) {
      const c = (k: string) => String(date.get(`${k}:${culoare}`) ?? '');
      const e2 = await materialPeCuloare(compId!, culoare, {
        materialId: c('material'), cod: c('cod'), denumire: c('denumire'),
        pret: c('pret').trim() ? numarDinFormular(c('pret')) ?? -1 : null,
      });
      if (e2) inapoi(id, e2, '#componente');
    }
    inapoi(id, null, '#componente');
  }
  async function sterge(date: FormData) {
    'use server';
    await cere('dezvoltare', 'modifica');
    await stergeComponentaFisa(String(date.get('id')));
    inapoi(id, null, '#componente');
  }
  async function masuri(date: FormData) {
    'use server';
    await cere('dezvoltare', 'modifica');
    const nume = date.getAll('masura').map(String);
    await salveazaMasuri(id, nume.map((n, i) => ({
      nume: n,
      valori: Object.fromEntries(marimi.map((mr) => [mr, String(date.get(`v:${i}:${mr}`) ?? '').trim()]).filter(([, v]) => v)),
    })));
    inapoi(id, null, '#masuri');
  }
  async function manopera(date: FormData) {
    'use server';
    await cere('dezvoltare', 'modifica');
    const v = (k: string) => { const x = String(date.get(k) ?? '').trim(); return x ? numarDinFormular(x) ?? -1 : null; };
    inapoi(id, await salveazaManopera(id, v('manopera'), v('timp')), '#cost');
  }
  async function materialNomenclator(date: FormData) {
    'use server';
    await cere('dezvoltare', 'modifica');
    const s = (k: string) => String(date.get(k) ?? '');
    inapoi(id, await materialNou({
      tip: s('tip'), cod: s('cod'), denumire: s('denumire'), culoare: s('culoare'), unitate: s('unitate'),
      furnizor: s('furnizor'), pret: s('pret').trim() ? numarDinFormular(s('pret')) ?? -1 : null,
    }), '#componente');
  }

  const masuriRanduri = f.masuri.length ? [...f.masuri, { id: 'nou1', nume: '', valori: {} }]
    : MASURI_IMPLICITE.map((n) => ({ id: n, nume: n, valori: {} as Record<string, string> }));

  return (
    <main className="formular lat">
      <p className="slab"><Link href={`/dezvoltare/${id}`}>← {d.model}</Link></p>
      <h1>Fișa de produs · {d.categorie ? `${d.categorie} ` : ''}{d.model}</h1>
      <p className="sumar">
        {d.brand} · culori: {d.culori.join(', ') || '—'} · mărimi: {f.marimi.join(', ')} ·{' '}
        <a href={`/dezvoltare/${id}/fisa/excel`}>descarcă Excel</a> · <Link href={`/dezvoltare/${id}/fisa/tipar`} target="_blank">PDF</Link>
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      <div className="poze">
        {d.culori.map((c) => {
          const p = f.poze.find((x) => x.culoare === c);
          return (
            <figure key={c}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p ? <img src={`/dezvoltare/poza/${p.id}`} alt={c} /> : <div className="fara-poza">fără poză</div>}
              <figcaption><strong>{c}</strong></figcaption>
            </figure>
          );
        })}
      </div>
      {d.culori.some((c) => !f.poze.find((x) => x.culoare === c)) && (
        <p className="slab">Pozele pe culori se încarcă la <Link href={`/dezvoltare/${id}#referinte`}>referințele cererii</Link>, cu culoarea aleasă.</p>
      )}

      <section id="componente">
        {(['materie_prima', 'accesoriu'] as const).map((tip) => (
          <Fragmente key={tip} tip={tip} f={f} m={m} salveaza={componenta} sterge={sterge} material={materialNomenclator} />
        ))}
      </section>

      <section id="masuri">
        <h2>Dimensiuni</h2>
        <form action={masuri}><fieldset disabled={!m} className="fara-chenar">
          <div className="tabel-derulant">
            <table className="grila">
              <thead><tr><th>Măsura</th>{f.marimi.map((mr) => <th key={mr}>{mr}</th>)}</tr></thead>
              <tbody>
                {masuriRanduri.map((r, i) => (
                  <tr key={r.id}>
                    <td><input name="masura" defaultValue={r.nume} placeholder="ex. LUNGIME MÂNECĂ" /></td>
                    {f.marimi.map((mr) => (
                      <td key={mr}><input name={`v:${i}:${mr}`} defaultValue={r.valori[mr] ?? ''} className="bucati" /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actiuni"><button className="secundar">Salvează dimensiunile</button></div>
        </fieldset></form>
      </section>

      <section id="cost">
        <h2>Cost pe bucată</h2>
        <form action={manopera} className="antet-comanda"><fieldset disabled={!m} className="fara-chenar">
          <label><span>Manoperă pe bucată (lei)</span><input name="manopera" defaultValue={d.manopera ? Number(d.manopera) : ''} inputMode="decimal" /></label>
          <label><span>Timp de lucru pe bucată (minute)</span><input name="timp" defaultValue={d.timp_min_buc ? Number(d.timp_min_buc) : ''} inputMode="decimal" /></label>
          <div className="actiuni"><button className="secundar">Salvează</button></div>
          <p className="slab lat">Timpul pe bucată trece pe model la aprobare și din el se socotește cât stă o tranșă pe bandă.</p>
        </fieldset></form>
        <table>
          <thead><tr><th>Culoare</th><th className="nr">Materii prime</th><th className="nr">Accesorii</th><th className="nr">Manoperă</th><th className="nr">Total</th><th /></tr></thead>
          <tbody>
            {(d.culori.length ? d.culori : ['—']).map((c) => {
              const x = cost(f, c);
              return (
                <tr key={c}>
                  <td>{c}</td>
                  <td className="nr">{lei(x.materie)}</td>
                  <td className="nr">{lei(x.accesorii)}</td>
                  <td className="nr">{lei(x.manopera)}</td>
                  <td className="nr"><strong>{lei(x.total)} lei</strong></td>
                  <td>{x.faraPret > 0 && <span className="lipsa">{x.faraPret} fără preț</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}

/**
 * Materiile prime sau accesoriile fișei: un tabel cu ce s-a salvat — componenta,
 * consumul, furnizorul, materialul fiecărei culori, prețul —, fiecare rând cu
 * „editează"; dedesubt, o componentă nouă și un material nou în nomenclator.
 */
function Fragmente({ tip, f, m, salveaza, sterge, material }: {
  tip: 'materie_prima' | 'accesoriu'; f: Fisa; m: boolean;
  salveaza: (d: FormData) => Promise<void>; sterge: (d: FormData) => Promise<void>; material: (d: FormData) => Promise<void>;
}) {
  const lista = f.componente.filter((c) => c.tip === tip);
  const prima = f.dezvoltare.culori[0] ?? '';
  return (
    <>
      <h2>{tip === 'materie_prima' ? 'Materii prime' : 'Accesorii'}</h2>
      <p className="slab">
        {tip === 'materie_prima'
          ? 'Ce se întinde și se taie: material de bază 1, 2, contrast 1, 2, căptușeală 1, 2. Consumul e pe bucată.'
          : 'Tot restul: ață, thermo, fermoare, nasturi, balene, etichete, pungi. Consumul e pe bucată.'}
      </p>
      {lista.length === 0 ? <p className="slab">Nimic adăugat încă.</p> : (
        <div className="tabel-derulant">
          <table className="componente-fisa">
            <thead>
              <tr><th>Componentă</th><th className="nr">Consum / buc</th><th>Furnizor · cod</th><th>Material, pe culori</th>
                  <th className="nr">Preț</th><th className="nr">Preț / buc</th></tr>
            </thead>
            <tbody>
              {lista.map((c) => {
                const pret = pretPeCuloare(c, prima);
                return (
                  <Fragment key={c.id}>
                    <tr>
                      <td><strong>{c.nume}</strong>{c.principal && <span className="slab"> · principal</span>}</td>
                      <td className="nr">{Number(c.consum)} {c.unitate}</td>
                      <td className="slab">{[c.furnizor, c.cod].filter(Boolean).join(' · ') || '—'}</td>
                      <td>
                        {c.material ? <span>{c.material} <span className="slab">· toate culorile</span></span>
                          : f.dezvoltare.culori.map((cul) => {
                            const x = c.culori.find((y) => y.culoare === cul);
                            return (
                              <div key={cul}><span className="slab">{cul}:</span>{' '}
                                {x ? (x.material ?? `${x.denumire} (nou)`) : <span className="lipsa">fără material</span>}</div>
                            );
                          })}
                      </td>
                      <td className="nr">{pret === null ? <span className="lipsa">—</span> : lei(pret)}</td>
                      <td className="nr">{pret === null ? '—' : lei(Number(c.consum) * pret)}</td>
                    </tr>
                    {m && (
                      <tr className="editeaza">
                        <td colSpan={6}>
                          <details>
                            <summary className="slab">editează {c.nume}</summary>
                            <Componenta c={c} f={f} m={m} salveaza={salveaza} sterge={sterge} />
                          </details>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {m && (
        <>
          <details className="caseta">
            <summary>Adaugă {tip === 'materie_prima' ? 'o materie primă' : 'un accesoriu'}</summary>
            <Componenta c={null} tip={tip} f={f} m={m} salveaza={salveaza} sterge={sterge} />
          </details>
          <details className="caseta">
            <summary>Material nou în nomenclator</summary>
            <form action={material} className="antet-comanda">
              <input type="hidden" name="tip" value={tip} />
              <label><span>Denumire</span><input name="denumire" required placeholder={tip === 'materie_prima' ? 'Stofa Damaris' : 'Nasturi mari'} /></label>
              <label><span>Culoare</span>
                <input name="culoare" list={`culori-${tip}`} placeholder="ex. Roșu; gol dacă e la fel pe toate" />
                <datalist id={`culori-${tip}`}>{f.dezvoltare.culori.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              <label><span>Cod</span><input name="cod" placeholder="din denumire, dacă e gol" /></label>
              <label><span>Unitate</span>
                <select name="unitate" defaultValue={tip === 'materie_prima' ? 'm' : 'buc'}>{UNITATI.map((u) => <option key={u}>{u}</option>)}</select>
              </label>
              <label><span>Furnizor</span><input name="furnizor" /></label>
              <label><span>Preț / unitate (lei)</span><input name="pret" inputMode="decimal" className="bucati" /></label>
              <div className="actiuni"><button className="secundar">Adaugă în nomenclator</button></div>
              <p className="slab lat">Apoi se alege, scriind, în componentă sau la culoarea ei.</p>
            </form>
          </details>
        </>
      )}
    </>
  );
}

function Componenta({ c, tip, f, m, salveaza, sterge }: {
  c: ComponentaFisa | null; tip?: string; f: Fisa; m: boolean;
  salveaza: (d: FormData) => Promise<void>; sterge: (d: FormData) => Promise<void>;
}) {
  const t = c?.tip ?? tip!;
  return (
    <div className="componenta-fisa">
      <form action={salveaza}><fieldset disabled={!m} className="fara-chenar">
        {c && <input type="hidden" name="id" value={c.id} />}
        <input type="hidden" name="tip" value={t} />
        <div className="antet-comanda">
          <label><span>Componentă</span><input name="nume" defaultValue={c?.nume ?? ''} required
            placeholder={t === 'materie_prima' ? 'Material de bază 1' : 'Nasturi mari'} /></label>
          <label><span>Consum / buc</span><input name="consum" defaultValue={c ? Number(c.consum) : ''} inputMode="decimal" required className="bucati" /></label>
          <label><span>Unitate</span>
            <select name="unitate" defaultValue={c?.unitate ?? (t === 'materie_prima' ? 'm' : 'buc')}>
              {UNITATI.map((u) => <option key={u}>{u}</option>)}
            </select>
          </label>
          <label><span>Furnizor</span><input name="furnizor" defaultValue={c?.furnizor ?? ''} /></label>
          <label><span>Cod furnizor</span><input name="cod" defaultValue={c?.cod ?? ''} /></label>
          <label><span>Preț / unitate (lei)</span><input name="pret" defaultValue={c?.pret ? Number(c.pret) : ''} inputMode="decimal" className="bucati" /></label>
          <label className="lat"><span>Material din nomenclator, dacă e același pe toate culorile (altfel, gol)</span>
            <CautaMaterial nume="material" tip={t} ales={c?.material_id ? { id: c.material_id, denumire: c.material ?? '' } : null} />
          </label>
          {t === 'materie_prima' && (
            <label className="bifa-linie"><input type="checkbox" name="principal" value="1" defaultChecked={c?.principal} /> material de bază principal</label>
          )}
        </div>
        {c && f.dezvoltare.culori.length > 0 && !c.material_id && (
          <table className="grila">
            <thead><tr><th>Culoare</th><th>Material din nomenclator</th><th>sau denumire nouă</th><th>cod nou</th><th>Preț</th></tr></thead>
            <tbody>
              {f.dezvoltare.culori.map((cul) => {
                const x = c.culori.find((y) => y.culoare === cul);
                return (
                  <tr key={cul}>
                    <td>{cul}<input type="hidden" name="culoare" value={cul} /></td>
                    <td><CautaMaterial nume={`material:${cul}`} tip={t} eticheta={`Material ${cul}`}
                          ales={x?.material_id ? { id: x.material_id, denumire: x.material ?? '' } : null} placeholder={`ex. ${c.nume} ${cul}`} /></td>
                    <td><input name={`denumire:${cul}`} defaultValue={x?.denumire ?? ''} placeholder={`${c.nume} ${cul}`} /></td>
                    <td><input name={`cod:${cul}`} defaultValue={x?.material_id ? '' : x?.cod ?? ''} className="bucati" /></td>
                    <td><input name={`pret:${cul}`} defaultValue={x?.pret ? Number(x.pret) : ''} inputMode="decimal" className="bucati" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!c && <p className="slab">După „Adaugă", componenta apare în tabelul de sus; acolo, la „editează”, se alege materialul fiecărei culori.</p>}
        <div className="actiuni"><button className={c ? 'secundar' : 'principal'}>{c ? 'Salvează' : 'Adaugă'}</button></div>
      </fieldset></form>
      {c && m && (
        <form action={sterge} className="in-rand"><input type="hidden" name="id" value={c.id} /><button>Șterge componenta</button></form>
      )}
    </div>
  );
}
