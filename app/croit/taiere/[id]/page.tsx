import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  corecteaza, fisaTaiere, incepe, inregistreazaCroitTaiere, OPERATII, scoateDinTaiere, scrieMetri, termina,
  type FisaTaiere, type Operatie, type OperatieScrisa,
} from '../../../lib/croitTaiere';
import { cantitate, numarDinFormular } from '../../../lib/format';
import { motiveCroit } from '../../../lib/planificare';
import { cere, cereOperatorCroit, lucreazaLaCroit } from '../../../lib/sesiune';
import { poate } from '../../../lib/acces';
import '../../../formulare.css';

export const dynamic = 'force-dynamic';

const inapoi = (id: string, e?: string | null): never =>
  redirect(e ? `/croit/taiere/${id}?eroare=${encodeURIComponent(e)}` : `/croit/taiere/${id}`);

const ora = (t: string | null) => (t ? t.replace('T', ' ') : '');

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
  const [f, motive] = await Promise.all([fisaTaiere(id), motiveCroit()]);
  if (!f) notFound();
  const deschise = f.loturi.filter((l) => !l.croit_la);
  const neinceputa = f.operatii.length === 0;
  const ultima = f.loturi.length === 1;
  const eu = f.oameni.some((o) => o.id === u.id) ? u.id : '';

  async function incepeOp(date: FormData) {
    'use server';
    await cereOperatorCroit();
    inapoi(id, await incepe(id, String(date.get('componenta') ?? '') || null, String(date.get('operatie')) as Operatie,
      String(date.get('operator') ?? '')));
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
  async function croieste(date: FormData) {
    'use server';
    await cere('croit', 'modifica');
    const croit = new Map<string, Map<string, number>>();
    for (const [k, v] of date.entries()) {
      if (!k.startsWith('q:')) continue;
      const [, lot, marime] = k.split(':');
      croit.set(lot, (croit.get(lot) ?? new Map()).set(marime, numarDinFormular(v) ?? -1));
    }
    inapoi(id, await inregistreazaCroitTaiere({
      taiereId: id, croit, motivId: String(date.get('motiv') ?? '') || null,
      incheie: false, motivIncheiereId: null, observatiiIncheiere: '',
    }));
  }
  async function scoate(date: FormData) {
    'use server';
    await cere('croit', 'modifica');
    const e = await scoateDinTaiere(id, String(date.get('lot')));
    if (!e && ultima) redirect('/croit?vedere=ramas');
    inapoi(id, e);
  }

  const Rand = ({ operatie, componenta }: { operatie: Operatie; componenta: string | null }) => {
    const o = f.operatii.find((x) => x.operatie === operatie && x.componenta_id === componenta);
    return (
      <tr>
        <td><strong>{OPERATII[operatie]}</strong>{operatie === 'termocolat' && <span className="slab"> · dacă e cazul</span>}</td>
        <td>
          {!o ? (
            <form action={incepeOp} className="in-rand"><fieldset disabled={!lucreaza} className="fara-chenar">
              <input type="hidden" name="operatie" value={operatie} />
              <input type="hidden" name="componenta" value={componenta ?? ''} />
              <Oameni f={f} ales={eu} />
              <button>Începe acum</button>
            </fieldset></form>
          ) : !o.terminat_la ? (
            <form action={terminaOp} className="in-rand"><fieldset disabled={!lucreaza} className="fara-chenar">
              <span>{o.operator} · de la {ora(o.inceput_la).slice(11)}</span>
              <input type="hidden" name="id" value={o.id} />
              {operatie === 'intins' && (
                <label className="bifa"><input type="checkbox" name="fata" value="1" required /> am verificat fața materialului</label>
              )}
              <button>Termină acum</button>
            </fieldset></form>
          ) : (
            <span>
              {o.operator} · {ora(o.inceput_la)} – {ora(o.terminat_la).slice(11)}
              {operatie === 'intins' && <span className="slab"> · fața verificată</span>}
              {o.observatii && <span className="slab"> · {o.observatii}</span>}
            </span>
          )}
        </td>
        <td>{o && sef && <Corectura o={o} f={f} actiune={corecteazaOp} />}</td>
      </tr>
    );
  };

  return (
    <main className="formular lat">
      <p className="slab"><Link href="/croit?vedere=de_croit">← Croit</Link></p>
      <h1>{f.taiere.cod} · {f.taiere.model}</h1>
      <p className="sumar">
        {f.loturi.length} {f.loturi.length === 1 ? 'comandă' : 'comenzi'} ·{' '}
        {f.loturi.reduce((s, l) => s + l.marimi.reduce((a, m) => a + m.cerut, 0), 0)} buc cerute ·{' '}
        făcută {f.taiere.facuta_la ?? '—'} ·{' '}
        <strong>{deschise.length ? 'în lucru' : 'croită'}</strong>
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      {f.componente.length === 0 && <p className="slab">Modelul nu are materii prime în rețetă: operațiile se scriu pe material după ce se completează rețeta.</p>}
      {f.componente.map((c) => {
        const mat = f.culori.filter((m) => m.componenta_id === c.id);
        return (
          <section key={c.id}>
            <h2>{c.nume}{c.principal && <span className="slab"> · material de bază</span>}</h2>
            <table>
              <tbody>
                {(['intins', 'taiat', 'termocolat'] as const).map((op) => <Rand key={op} operatie={op} componenta={c.id} />)}
              </tbody>
            </table>
            {mat.length > 0 && (
              <table>
                <thead><tr><th>Culoare · material</th><th className="nr">Teoretic</th><th>Metri folosiți</th><th>Defecte de țesătură</th><th /></tr></thead>
                <tbody>
                  {mat.map((m) => (
                    <tr key={m.produs_id}>
                      <td><strong>{m.culoare}</strong> · <Link href={`/stoc/${m.material_id}`}>{m.material}</Link></td>
                      <td className="nr">{cantitate(m.teoretic)} <span className="slab">{m.unitate}</span></td>
                      <td colSpan={3}>
                        <form action={material} className="in-rand"><fieldset disabled={!lucreaza || !deschise.length} className="fara-chenar">
                          <input type="hidden" name="componenta" value={c.id} />
                          <input type="hidden" name="produs" value={m.produs_id} />
                          <input name="metri" defaultValue={m.metri ? cantitate(m.metri) : ''} inputMode="decimal" className="bucati"
                                 aria-label={`Metri ${m.culoare}`} />
                          <input name="defecte" defaultValue={m.defecte ?? ''} placeholder="fără defecte" aria-label={`Defecte ${m.culoare}`} />
                          <button>Salvează</button>
                        </fieldset></form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}

      <h2>După tăiere</h2>
      <table><tbody><Rand operatie="imperecheat" componenta={null} /></tbody></table>

      {neinceputa && sef && deschise.length > 0 && (
        <details>
          <summary className="slab">scoate o comandă din taiere</summary>
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

      <h2>Comenzile din taiere</h2>
      {deschise.length > 0 ? (
        <form action={croieste}><fieldset disabled={!sef} className="fara-chenar">
          <ComenziInTaiere f={f} editabil />
          {neinceputa && sef && (
            <p className="slab">
              Taierea n-a început: se mai pot scoate comenzi (mai jos) sau adăuga din <Link href="/croit?vedere=ramas">rămas de croit</Link>.
            </p>
          )}
          <div className="antet-comanda">
            <label>
              <span>Motiv, dacă diferă de cerut</span>
              <Motive motive={motive} nume="motiv" />
            </label>
            <p className="slab lat">
              Metrii scriși pe fiecare culoare scad din stoc, împărțiți pe comenzile culorii după bucățile croite; unde nu
              s-au scris, scade consumul teoretic. Ce iese mai puțin decât s-a cerut se întoarce în „rămas de croit".
            </p>
            <div className="actiuni"><button className="principal">Înregistrează croitul taierii</button></div>
          </div>
        </fieldset></form>
      ) : (
        <>
          <ComenziInTaiere f={f} />
          {f.rest_deschis > 0 && (
            <p className="slab">Au rămas {f.rest_deschis} buc necroite din comenzile taierii: sunt în <Link href="/croit?vedere=ramas">rămas de croit</Link>.</p>
          )}
        </>
      )}
    </main>
  );
}

function Oameni({ f, ales, nume = 'operator' }: { f: FisaTaiere; ales: string; nume?: string }) {
  return (
    <select name={nume} defaultValue={ales} required aria-label="Cine">
      <option value="">cine?</option>
      {f.oameni.map((o) => <option key={o.id} value={o.id}>{o.nume}</option>)}
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
        <thead><tr><th>Comandă</th><th>Produs</th><th>Pe mărimi: cerut → croit</th><th className="nr">Total</th></tr></thead>
        <tbody>
          {f.loturi.map((l) => (
            <tr key={l.id}>
              <td><Link href={`/croit/${l.id}`}>{l.cod}</Link> <span className="slab">{l.tip} · P{l.prioritate}</span></td>
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
                    </label>
                  ))}
                </span>
              </td>
              <td className="nr">
                {l.marimi.reduce((s, m) => s + m.cerut, 0)}
                {l.croit_la && <> → {l.marimi.reduce((s, m) => s + (m.croit ?? 0), 0)}</>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
