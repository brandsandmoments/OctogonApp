import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  cost, fisa, materialPeCuloare, salveazaComponenta, salveazaManopera, salveazaMasuri, stergeComponentaFisa,
  type ComponentaFisa, type Fisa,
} from '../../../lib/fisa';
import { numarDinFormular } from '../../../lib/format';
import { cere, poateModifica } from '../../../lib/sesiune';
import '../../../formulare.css';

export const dynamic = 'force-dynamic';

const inapoi = (id: string, e?: string | null, ancora = ''): never =>
  redirect(`/dezvoltare/${id}/fisa${e ? `?eroare=${encodeURIComponent(e)}` : ''}${ancora}`);
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
      principal: s('principal') === '1', seCroieste: s('se_croieste') === '1', furnizor: s('furnizor'), cod: s('cod'),
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
    const v = String(date.get('manopera') ?? '').trim();
    inapoi(id, await salveazaManopera(id, v ? numarDinFormular(v) ?? -1 : null), '#cost');
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
          <Fragmente key={tip} tip={tip} f={f} m={m} salveaza={componenta} sterge={sterge} />
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
          <div className="actiuni"><button className="secundar">Salvează manopera</button></div>
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

/** Materiile prime sau accesoriile fișei: câte un formular pe componentă, plus unul pentru o componentă nouă. */
function Fragmente({ tip, f, m, salveaza, sterge }: {
  tip: 'materie_prima' | 'accesoriu'; f: Fisa; m: boolean;
  salveaza: (d: FormData) => Promise<void>; sterge: (d: FormData) => Promise<void>;
}) {
  const lista = f.componente.filter((c) => c.tip === tip);
  const materiale = f.materiale.filter((x) => x.tip === tip);
  return (
    <>
      <h2>{tip === 'materie_prima' ? 'Materii prime' : 'Accesorii'}</h2>
      <p className="slab">
        {tip === 'materie_prima'
          ? 'Material de bază 1, 2, contrast 1, 2, căptușeală 1, 2, termo… Consumul e pe bucată.'
          : 'Etichete, pungi, nasturi, fermoare… Consumul e pe bucată.'}
      </p>
      {lista.map((c) => <Componenta key={c.id} c={c} f={f} m={m} materiale={materiale} salveaza={salveaza} sterge={sterge} />)}
      <details className="caseta">
        <summary>Adaugă {tip === 'materie_prima' ? 'o materie primă' : 'un accesoriu'}</summary>
        <Componenta c={null} tip={tip} f={f} m={m} materiale={materiale} salveaza={salveaza} sterge={sterge} />
      </details>
    </>
  );
}

function Componenta({ c, tip, f, m, materiale, salveaza, sterge }: {
  c: ComponentaFisa | null; tip?: string; f: Fisa; m: boolean; materiale: Fisa['materiale'];
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
          <label className="lat"><span>Material din nomenclator (același pe toate culorile)</span>
            <select name="material" defaultValue={c?.material_id ?? ''}>
              <option value="">— diferă pe culori, sau nou —</option>
              {materiale.map((x) => <option key={x.id} value={x.id}>{x.denumire} · {x.cod} ({x.unitate})</option>)}
            </select>
          </label>
          {t === 'materie_prima' && (
            <>
              <label className="bifa-linie"><input type="checkbox" name="principal" value="1" defaultChecked={c?.principal} /> material de bază principal</label>
              <label className="bifa-linie"><input type="checkbox" name="se_croieste" value="1" defaultChecked={c ? c.se_croieste : true} /> se întinde și se taie</label>
            </>
          )}
        </div>
        {c && f.dezvoltare.culori.length > 0 && !c.material_id && (
          <table className="grila">
            <thead><tr><th>Culoare</th><th>Material din nomenclator</th><th>sau cod nou</th><th>denumire nouă</th><th>Preț</th></tr></thead>
            <tbody>
              {f.dezvoltare.culori.map((cul) => {
                const x = c.culori.find((y) => y.culoare === cul);
                return (
                  <tr key={cul}>
                    <td>{cul}<input type="hidden" name="culoare" value={cul} /></td>
                    <td>
                      <select name={`material:${cul}`} defaultValue={x?.material_id ?? ''}>
                        <option value="">—</option>
                        {materiale.map((y) => <option key={y.id} value={y.id}>{y.denumire} · {y.cod}</option>)}
                      </select>
                    </td>
                    <td><input name={`cod:${cul}`} defaultValue={x?.material_id ? '' : x?.cod ?? ''} className="bucati" /></td>
                    <td><input name={`denumire:${cul}`} defaultValue={x?.denumire ?? ''} placeholder={`${c.nume} ${cul}`} /></td>
                    <td><input name={`pret:${cul}`} defaultValue={x?.pret ? Number(x.pret) : ''} inputMode="decimal" className="bucati" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="actiuni"><button className={c ? 'secundar' : 'principal'}>{c ? 'Salvează' : 'Adaugă'}</button></div>
      </fieldset></form>
      {c && m && (
        <form action={sterge} className="in-rand"><input type="hidden" name="id" value={c.id} /><button>Șterge componenta</button></form>
      )}
    </div>
  );
}
