import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Fragment } from 'react';
import Pliere from '../Pliere';
import { cere, poateModifica } from '../lib/sesiune';
import {
  deplanificat, mutaLaCroit, planificaTot, planificariActive, trimiteLaCroit,
  type LinieDePlanificat, type PlanificareRezumat,
} from '../lib/planificare';
import { STADII } from '../lib/stadii';

export const dynamic = 'force-dynamic';

const inapoi = (eroare?: string | null): never =>
  redirect(eroare ? `/planificare?eroare=${encodeURIComponent(eroare)}` : '/planificare');

/**
 * Planificarea, în ordinea în care se lucrează:
 *
 * 1. De planificat — comenzile deschise, grupate pe model, cu ce a rămas
 *    neplanificat. Se planifică tot ce a rămas pe cele bifate, sau, pe o singură
 *    comandă, alte cantități.
 * 2. De trimis la croit — planificările cu necesarul lor; de aici pleacă la croit.
 * 3. La croit — ce a plecat, în ordinea în care planificarea vrea să fie croit.
 *    Ce se taie odată (o parte dintr-un PSF, un PSF cu un PSC) hotărăște croitul.
 */
export default async function Planificare({ searchParams }: { searchParams: Promise<{ cauta?: string; eroare?: string }> }) {
  await cere('planificare');
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('planificare');
  const { cauta, eroare } = await searchParams;
  const [active, deplan] = await Promise.all([planificariActive(), deplanificat(cauta)]);
  const deTrimis = active.filter((p) => ['gata_de_lansat', 'blocat_materiale', 'fara_cantitate'].includes(p.stadiu));
  const laCroit = active.filter((p) => ['lansat_spre_croit', 'in_croit'].includes(p.stadiu));

  const peModel = new Map<string, LinieDePlanificat[]>();
  for (const l of deplan) peModel.set(l.model_cheie, [...(peModel.get(l.model_cheie) ?? []), l]);

  async function planifica(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    inapoi(await planificaTot(date.getAll('linie').map(String)));
  }
  async function trimite(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    inapoi(await trimiteLaCroit(String(date.get('id'))));
  }
  async function muta(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    await mutaLaCroit(String(date.get('id')), date.get('pas') === 'sus' ? -1 : 1);
    inapoi();
  }

  return (
    <main className="lat">
      <h1>Planificare</h1>
      <p className="sumar">
        {deplan.length} poziții de planificat · {deplan.reduce((s, l) => s + l.rest, 0)} buc ·{' '}
        {deTrimis.length} de trimis la croit · {laCroit.length} la croit
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      <h2>De planificat, pe model</h2>
      <form className="filtre">
        <input name="cauta" defaultValue={cauta ?? ''} placeholder="comandă sau produs" aria-label="Caută" />
        <button>Caută</button>
      </form>
      <p className="filtre"><Pliere semn={cauta ?? ''} /></p>
      <form action={planifica} id="planifica" />
      <div className="tabel-derulant">
        <table className="centralizator">
          <thead>
            <tr><th /><th>Comandă</th><th>Termen</th><th>Produs</th>
                <th className="nr">Cerut</th><th className="nr">Planif.</th><th className="nr">Rest</th><th /></tr>
          </thead>
          <tbody>
            {[...peModel].map(([cheie, linii]) => (
              <Fragment key={cheie}>
                <tr className="grupa-model">
                  <td colSpan={6}>
                    <strong>{linii[0].model}</strong>{' '}
                    <span className="slab">{linii.length} {linii.length === 1 ? 'comandă' : 'comenzi'}</span>
                  </td>
                  <td className="nr"><strong>{linii.reduce((s, l) => s + l.rest, 0)}</strong></td>
                  <td />
                </tr>
                {linii.map((l) => (
                  <tr key={l.linie_id}>
                    <td>
                      {l.are_reteta && (
                        <input type="checkbox" name="linie" value={l.linie_id} form="planifica" disabled={!m}
                               aria-label={`${l.comanda} ${l.produs}`} />
                      )}
                    </td>
                    <td>{l.comanda} <span className="slab">{l.tip} · P{l.prioritate}</span></td>
                    <td className="slab">{l.data_ceruta}</td>
                    <td>{l.produs} <span className="slab">{l.cod_sku}</span></td>
                    <td className="nr">{l.cerut}</td>
                    <td className="nr">{l.planificat || '—'}</td>
                    <td className="nr">{l.rest}</td>
                    <td>{!l.are_reteta ? <span className="lipsa">fără rețetă</span>
                      : m && <Link href={`/planificare/nou?linie=${l.linie_id}`}>alte cantități</Link>}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {deplan.length > 0 && (
        <p><button form="planifica" className="buton" disabled={!m}>Planifică tot ce a rămas pe cele bifate</button></p>
      )}

      <h2>De trimis la croit</h2>
      {deTrimis.length === 0 ? <p className="slab">Nimic de trimis.</p> : (
        <Tabel lista={deTrimis} coloana={(p) => (
          <form action={trimite} className="in-rand">
            <fieldset disabled={!m || p.stofa_lipsa} className="fara-chenar">
              <input type="hidden" name="id" value={p.id} />
              <button>Trimite la croit</button>
            </fieldset>
          </form>
        )} />
      )}

      <h2>La croit, în ordinea de croit</h2>
      {laCroit.length === 0 ? <p className="slab">Nimic la croit.</p> : (
        <Tabel lista={laCroit} coloana={(p, i) => (
          <form action={muta} className="in-rand">
            <fieldset disabled={!m} className="fara-chenar">
              <input type="hidden" name="id" value={p.id} />
              <button name="pas" value="sus" disabled={i === 0} aria-label="Mai sus">↑</button>
              <button name="pas" value="jos" disabled={i === laCroit.length - 1} aria-label="Mai jos">↓</button>
            </fieldset>
          </form>
        )} />
      )}
    </main>
  );
}

function Tabel({ lista, coloana }: { lista: PlanificareRezumat[]; coloana: (p: PlanificareRezumat, i: number) => React.ReactNode }) {
  return (
    <div className="tabel-derulant">
      <table className="centralizator">
        <thead>
          <tr><th>Planificare</th><th>Termen</th><th>Produs</th><th>Stadiu</th>
              <th className="nr">Planif.</th><th className="nr">Croit</th><th>Necesar</th><th /></tr>
        </thead>
        <tbody>
          {lista.map((p, i) => (
            <tr key={p.id}>
              <td><Link href={`/planificare/${p.id}`}>{p.cod}</Link> <span className="slab">P{p.prioritate}</span></td>
              <td className="slab">{p.data_ceruta}</td>
              <td>{p.produs}</td>
              <td>{STADII[p.stadiu] ?? p.stadiu}{p.loturi_deschise > 0 && <span className="slab"> · într-o taiere</span>}</td>
              <td className="nr">{p.planificat}</td>
              <td className="nr">{p.croit || '—'}</td>
              <td>{p.stofa_lipsa ? <span className="lipsa">stofă lipsă</span>
                : p.alte_lipsa > 0 ? <span className="slab">stofă ok · lipsesc {p.alte_lipsa}</span>
                : <span className="slab">acoperit</span>}</td>
              <td>{coloana(p, i)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
