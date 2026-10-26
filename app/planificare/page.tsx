import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Fragment } from 'react';
import { cere, poateModifica } from '../lib/sesiune';
import { deplanificat, planificariActive, type LinieDePlanificat } from '../lib/planificare';
import { grupeaza, muta, taieriInPlanificare, trimiteLaCroit, type Taiere } from '../lib/taiere';
import { STADII } from '../lib/stadii';

export const dynamic = 'force-dynamic';

const inapoi = (eroare?: string | null): never =>
  redirect(eroare ? `/planificare?eroare=${encodeURIComponent(eroare)}` : '/planificare');

/**
 * Planificarea, în ordinea în care se lucrează:
 *
 * 1. De planificat — comenzile deschise, grupate pe model. Din fiecare model se
 *    bifează comenzile care se taie împreună și se face o taiere (sau se adaugă la
 *    una existentă).
 * 2. Taieri de trimis la croit — coada, în ordinea pusă de planificator, cu
 *    necesarul acoperit sau nu; de aici pleacă la croit.
 * 3. La croit — ce a plecat și încă lucrează.
 */
export default async function Planificare({ searchParams }: { searchParams: Promise<{ cauta?: string; eroare?: string }> }) {
  await cere('planificare');
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('planificare');
  const { cauta, eroare } = await searchParams;
  const [active, deplan, taieri] = await Promise.all([planificariActive(), deplanificat(cauta), taieriInPlanificare()]);
  const laCroit = active.filter((p) => ['lansat_spre_croit', 'in_croit'].includes(p.stadiu));

  const peModel = new Map<string, LinieDePlanificat[]>();
  for (const l of deplan) peModel.set(l.model_cheie, [...(peModel.get(l.model_cheie) ?? []), l]);
  const taieriPeModel = (cheie: string) => taieri.filter((t) => t.model_cheie === cheie);

  async function taie(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    const r = await grupeaza(date.getAll('linie').map(String), String(date.get('taiere') ?? '') || undefined);
    if ('eroare' in r) inapoi(r.eroare);
    inapoi();
  }
  async function mutaTaierea(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    await muta(String(date.get('id')), date.get('pas') === 'sus' ? -1 : 1);
    inapoi();
  }
  async function trimite(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    inapoi(await trimiteLaCroit(String(date.get('id'))));
  }

  return (
    <main className="lat">
      <h1>Planificare</h1>
      <p className="sumar">
        {deplan.length} poziții de planificat · {deplan.reduce((s, l) => s + l.rest, 0)} buc ·{' '}
        {taieri.length} taieri de trimis · {laCroit.length} planificări la croit
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      <h2>De planificat, pe model</h2>
      <form className="filtre">
        <input name="cauta" defaultValue={cauta ?? ''} placeholder="comandă sau produs" aria-label="Caută" />
        <button>Caută</button>
      </form>
      <p className="slab">Bifează comenzile de pe același model care se taie împreună. Fiecare intră cu tot ce i-a rămas de planificat; pentru alte cantități, „Planifică” pe rândul ei.</p>
      <div className="tabel-derulant">
        <table className="centralizator">
          <thead>
            <tr><th /><th>Comandă</th><th>Termen</th><th>Produs</th>
                <th className="nr">Cerut</th><th className="nr">Planif.</th><th className="nr">Rest</th><th /></tr>
          </thead>
          <tbody>
            {[...peModel].map(([cheie, linii]) => {
              const formular = `taie-${cheie}`;
              const deschise = taieriPeModel(cheie);
              return (
                <Fragment key={cheie}>
                  <tr className="grupa-model">
                    <td colSpan={6}>
                      <strong>{linii[0].model}</strong>{' '}
                      <span className="slab">{linii.length} {linii.length === 1 ? 'comandă' : 'comenzi'}</span>
                    </td>
                    <td className="nr"><strong>{linii.reduce((s, l) => s + l.rest, 0)}</strong></td>
                    <td>
                      <form id={formular} action={taie} className="in-rand">
                        <fieldset disabled={!m} className="fara-chenar">
                          {deschise.length > 0 && (
                            <select name="taiere" defaultValue="" aria-label="În ce taiere">
                              <option value="">taiere nouă</option>
                              {deschise.map((t) => <option key={t.id} value={t.id}>în {t.cod}</option>)}
                            </select>
                          )}
                          <button>Taie împreună</button>
                        </fieldset>
                      </form>
                    </td>
                  </tr>
                  {linii.map((l) => (
                    <tr key={l.linie_id}>
                      <td>
                        {l.are_reteta && (
                          <input type="checkbox" name="linie" value={l.linie_id} form={formular} disabled={!m}
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
                        : m && <Link href={`/planificare/nou?linie=${l.linie_id}`}>Planifică</Link>}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Taieri de trimis la croit</h2>
      {taieri.length === 0 ? <p className="slab">Nicio taiere în așteptare.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead>
              <tr><th>Ordine</th><th>Taiere</th><th>Model</th><th>Comenzi</th><th>Termen</th>
                  <th className="nr">Buc</th><th>Necesar</th><th /></tr>
            </thead>
            <tbody>
              {taieri.map((t, i) => (
                <tr key={t.id}>
                  <td>
                    <form action={mutaTaierea} className="in-rand">
                      <fieldset disabled={!m} className="fara-chenar">
                        <input type="hidden" name="id" value={t.id} />
                        <button name="pas" value="sus" disabled={i === 0} aria-label="Mai sus">↑</button>
                        <button name="pas" value="jos" disabled={i === taieri.length - 1} aria-label="Mai jos">↓</button>
                      </fieldset>
                    </form>
                  </td>
                  <td><Link href={`/planificare/taiere/${t.id}`}>{t.cod}</Link></td>
                  <td>{t.model}</td>
                  <td className="culori-celula">{t.planificari.map((p) => `${p.comanda} (${p.planificat})`).join(', ')}</td>
                  <td className="slab">{t.termen}</td>
                  <td className="nr">{t.bucati}</td>
                  <td><Necesar t={t} /></td>
                  <td>
                    <form action={trimite} className="in-rand">
                      <fieldset disabled={!m || t.stofa_lipsa} className="fara-chenar">
                        <input type="hidden" name="id" value={t.id} />
                        <button>Trimite la croit</button>
                      </fieldset>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>La croit</h2>
      {laCroit.length === 0 ? <p className="slab">Nimic la croit.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead>
              <tr><th>Planificare</th><th>Termen</th><th>Produs</th><th>Stadiu</th>
                  <th className="nr">Planif.</th><th className="nr">Croit</th></tr>
            </thead>
            <tbody>
              {laCroit.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/planificare/${p.id}`}>{p.cod}</Link> <span className="slab">P{p.prioritate}</span></td>
                  <td className="slab">{p.data_ceruta}</td>
                  <td>{p.produs}</td>
                  <td>{STADII[p.stadiu] ?? p.stadiu}{p.loturi_deschise > 0 && <span className="slab"> · lot la croit</span>}</td>
                  <td className="nr">{p.planificat}</td>
                  <td className="nr">{p.croit || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Necesar({ t }: { t: Taiere }) {
  return t.stofa_lipsa ? <span className="lipsa">stofă lipsă</span>
    : t.alte_lipsa > 0 ? <span className="slab">stofă ok · lipsesc {t.alte_lipsa}</span>
    : <span className="slab">acoperit</span>;
}
