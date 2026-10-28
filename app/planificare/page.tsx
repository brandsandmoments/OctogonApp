import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Fragment } from 'react';
import Pliere from '../Pliere';
import { cere, poateModifica } from '../lib/sesiune';
import {
  bifeazaMateriale, deplanificat, materialeDeBifat, mutaLaCroit, planificaTot, planificariActive, trimiteLaCroit,
  type LinieDePlanificat, type PlanificareRezumat,
} from '../lib/planificare';
import { STADII } from '../lib/stadii';
import { cantitate } from '../lib/format';

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
  const materiale = await materialeDeBifat(deTrimis.map((p) => p.id));

  const peModel = new Map<string, LinieDePlanificat[]>();
  for (const l of deplan) peModel.set(l.model_cheie, [...(peModel.get(l.model_cheie) ?? []), l]);

  async function planifica(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    inapoi(await planificaTot(date.getAll('linie').map(String)));
  }
  // Mai multe deodată: cele bifate pleacă, cele cu materiale nebifate rămân și spun de ce.
  async function trimite(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    const erori: string[] = [];
    for (const id of date.getAll('id').map(String)) {
      const e = await trimiteLaCroit(id);
      if (e) erori.push(e);
    }
    inapoi(erori.length ? erori.join(' ') : date.getAll('id').length ? null : 'Bifează ce trimiți la croit.');
  }
  async function bifeaza(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    const id = String(date.get('planificare'));
    const toate = date.get('toate') === '1';
    await bifeazaMateriale(id, toate ? date.getAll('toate_materialele').map(String) : date.getAll('material').map(String));
    inapoi();
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
        <>
          <p className="slab">
            Deschide fiecare planificare și bifează materialele pe care le avem — și pe cele aduse, dar încă
            neinventariate. Pleacă la croit doar cu toate bifate; se pot trimite mai multe deodată.
          </p>
          <form action={trimite} id="trimite" />
          {deTrimis.map((p) => {
            const lista = materiale.get(p.id) ?? [];
            const bifate = lista.filter((x) => x.bifat).length;
            const gata = bifate === lista.length;
            return (
              <details key={p.id} className="caseta de-trimis">
                <summary>
                  <input type="checkbox" name="id" value={p.id} form="trimite" disabled={!m || !gata} aria-label={`Trimite ${p.cod}`} />{' '}
                  <strong>{p.cod}</strong> · {p.produs} · {p.planificat} buc · termen {p.data_ceruta} ·{' '}
                  <span className={gata ? 'slab' : 'lipsa'}>avem {bifate}/{lista.length} materiale</span>
                </summary>
                <form action={bifeaza}><fieldset disabled={!m} className="fara-chenar">
                  <input type="hidden" name="planificare" value={p.id} />
                  {lista.map((x) => <input key={x.material_id} type="hidden" name="toate_materialele" value={x.material_id} />)}
                  <table>
                    <thead><tr><th>Avem</th><th>Material</th><th className="nr">Necesar</th><th className="nr">În stoc</th><th /></tr></thead>
                    <tbody>
                      {(['materie_prima', 'accesoriu'] as const).map((tip) => {
                        const r = lista.filter((x) => x.tip === tip);
                        if (!r.length) return null;
                        return [
                          <tr key={tip} className="tip-rand"><td colSpan={5}>{tip === 'materie_prima' ? 'Materie primă' : 'Accesorii'}</td></tr>,
                          ...r.map((x) => (
                            <tr key={x.material_id}>
                              <td><input type="checkbox" name="material" value={x.material_id} defaultChecked={x.bifat} aria-label={x.denumire} /></td>
                              <td><Link href={`/stoc/${x.material_id}`}>{x.denumire}</Link> <span className="slab">{x.cod}</span></td>
                              <td className="nr">{cantitate(x.necesar)} <span className="slab">{x.unitate}</span></td>
                              <td className="nr">{cantitate(x.stoc)}</td>
                              <td>{x.acoperit ? <span className="slab">acoperit din stoc</span> : <span className="lipsa">lipsă în stoc</span>}</td>
                            </tr>
                          )),
                        ];
                      })}
                    </tbody>
                  </table>
                  <div className="actiuni">
                    <button className="secundar">Salvează bifele</button>
                    <button className="secundar" name="toate" value="1">Le avem pe toate</button>
                    <Link href={`/necesar/${encodeURIComponent(p.comanda)}`} className="buton">Necesarul comenzii</Link>
                  </div>
                </fieldset></form>
              </details>
            );
          })}
          <p><button form="trimite" className="buton" disabled={!m}>Trimite la croit cele bifate</button></p>
        </>
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
