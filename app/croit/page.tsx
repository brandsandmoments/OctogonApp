import Link from 'next/link';
import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import { inchideComanda, puneInTaiere, ramasDeCroit, taieriDeschiseToate, taieriLaCroit, type RamasDeCroit, type TaiereLaCroit, type VedereCroit } from '../lib/croitTaiere';
import { numarDinFormular } from '../lib/format';
import { motiveCroit } from '../lib/planificare';
import Cauta from '../Cauta';
import Grupare from '../Grupare';
import { potriveste } from '../lib/format';
import Pliere from '../Pliere';
import { grupareDinAdresa, perioada, type TipPerioada } from '../lib/perioade';
import { cere, poateModifica } from '../lib/sesiune';

export const dynamic = 'force-dynamic';

const VEDERI: [string, string][] = [
  ['toate', 'Toate'],
  ['croite', 'Croite'],
  ['ramas', 'Rămas de croit'],
  ['taieri', 'Taieri'],
];


/**
 * Ce vede croitul:
 *   toate · croite · rămas de croit · taieri
 * „Rămas de croit" e ce a trimis planificarea și n-a intrat încă în nicio taiere,
 * pe model și pe mărimi; de aici șefa de croit face taierile — ce se taie odată —
 * și tot de aici stinge, cu observații, o comandă care nu se mai croiește.
 * „Taieri" sunt cele făcute și încă necroite, „Croite" cele terminate; se pot
 * grupa pe săptămâni, luni, trimestre sau ani.
 */
export default async function Croit({ searchParams }: { searchParams: Promise<{ vedere?: string; grupare?: string; eroare?: string; cauta?: string }> }) {
  await cere('croit');
  const { vedere = 'toate', grupare, eroare, cauta } = await searchParams;
  // Croitul pornește pe săptămâni, strâns: altfel sunt sute de taieri de derulat.
  const g = grupareDinAdresa(grupare, 'saptamana');

  return (
    <main className="lat">
      <h1>Croit</h1>
      <nav className="file">
        {VEDERI.map(([v, nume]) => (
          <Link key={v} href={`/croit?vedere=${v}${grupare ? `&grupare=${grupare}` : ''}`} className={v === vedere ? 'activ' : ''}>{nume}</Link>
        ))}
      </nav>
      {eroare && <p className="eroare">{eroare}</p>}
      <Cauta valoare={cauta} pastreaza={{ vedere, grupare }} placeholder="caută: model, comandă, produs, taiere" />
      {vedere === 'ramas' ? <Ramas cauta={cauta} /> : (
        <>
          <Grupare ales={g} pastreaza={{ vedere, cauta }} />
          <Taieri vedere={vedere as VedereCroit} grupare={g} cauta={cauta} />
        </>
      )}
    </main>
  );
}

async function Taieri({ vedere, grupare, cauta }: { vedere: VedereCroit; grupare: TipPerioada | ''; cauta?: string }) {
  const lista = (await taieriLaCroit(vedere)).filter((t) => potriveste(cauta, t.cod, t.model, t.comenzi));
  const deCroit = lista.filter((t) => t.loturi_deschise > 0);
  const zi = (t: TaiereLaCroit) => t.croit_la ?? t.facuta_la;
  const grupa = (t: TaiereLaCroit) => (grupare ? perioada(grupare, zi(t)).nume : '');
  // Grupate, cele mai noi sus; altfel ordinea cozii.
  if (grupare) lista.sort((a, b) => zi(b).localeCompare(zi(a)));
  return (
    <>
      <p className="sumar">
        {lista.length} taieri · {deCroit.length} în lucru ({deCroit.reduce((s, t) => s + t.cerut - t.croit, 0)} buc) ·{' '}
        {lista.length - deCroit.length} croite ({lista.filter((t) => !t.loturi_deschise).reduce((s, t) => s + t.croit, 0)} buc)
      </p>
      {lista.length === 0 ? <p className="slab">Nicio taiere.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead>
              <tr><th>Taiere</th><th>Model</th><th>Comenzi</th><th>Făcută</th>
                  <th className="nr">Cerut</th><th className="nr">Croit</th><th>Întins · tăiat · împerecheat</th><th>Stare</th></tr>
            </thead>
            <tbody>
              {lista.map((t, i) => {
                const nou = grupare !== '' && (i === 0 || grupa(lista[i - 1]) !== grupa(t));
                const din = nou ? lista.filter((x) => grupa(x) === grupa(t)) : [];
                return (
                  <Fragment key={t.id}>
                    {nou && (
                      <tr className="grupa-model">
                        <td colSpan={4}><strong>{grupa(t)}</strong> <span className="slab">{din.length} taieri</span></td>
                        <td className="nr"><strong>{din.reduce((s, x) => s + x.cerut, 0)}</strong></td>
                        <td className="nr"><strong>{din.reduce((s, x) => s + x.croit, 0)}</strong></td>
                        <td colSpan={2} />
                      </tr>
                    )}
                    <tr>
                      <td><Link href={`/croit/taiere/${t.id}`}>{t.cod}</Link></td>
                      <td>{t.model}</td>
                      <td className="culori-celula slab">{t.comenzi}</td>
                      <td className="slab">{t.facuta_la}</td>
                      <td className="nr">{t.cerut}</td>
                      <td className={`nr ${t.croit_la && t.croit < t.cerut ? 'lipsa' : ''}`}>{t.croit || '—'}</td>
                      <td className="slab">
                        {t.componente ? `${t.intinse}/${t.componente} · ${t.taiate}/${t.componente}` : '—'} · {t.imperecheat ? 'da' : 'nu'}
                      </td>
                      <td>{t.croit_la ? <span className="slab">croit {t.croit_la}</span> : <strong>în lucru</strong>}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Ramas({ cauta }: { cauta?: string }) {
  const m = await poateModifica('croit');
  const [toate, motive, deschise] = await Promise.all([ramasDeCroit(), motiveCroit(), taieriDeschiseToate()]);
  const lista = toate.filter((r) => potriveste(cauta, r.cod, r.comanda, r.produs, r.model));
  const peModel = new Map<string, RamasDeCroit[]>();
  for (const r of lista) peModel.set(r.model_cheie, [...(peModel.get(r.model_cheie) ?? []), r]);

  async function stinge(date: FormData) {
    'use server';
    await cere('croit', 'modifica');
    const e = await inchideComanda(String(date.get('planificare')), String(date.get('motiv') ?? ''),
      String(date.get('observatii') ?? ''));
    redirect(`/croit?vedere=ramas${e ? `&eroare=${encodeURIComponent(e)}` : ''}`);
  }

  // Ce s-a scris pe mărimi; „tot" pe o comandă ia tot ce i-a rămas, pe mărimile lăsate goale.
  async function taie(date: FormData) {
    'use server';
    await cere('croit', 'modifica');
    const ramas = await ramasDeCroit(date.getAll('pl').map(String));
    const alocari = ramas.map((r) => ({
      planificareId: r.planificare_id,
      marimi: new Map(r.marimi.filter((x) => x.disponibil > 0).map((x) => {
        const scris = String(date.get(`q:${r.planificare_id}:${x.marime_id}`) ?? '').trim();
        const q = scris ? numarDinFormular(scris) ?? -1 : date.get(`tot:${r.planificare_id}`) ? x.disponibil : 0;
        return [x.marime_id, q] as [string, number];
      })),
    }));
    const rez = await puneInTaiere(alocari, String(date.get('taiere') ?? '') || undefined);
    if (typeof rez === 'string') redirect(`/croit?vedere=ramas&eroare=${encodeURIComponent(rez)}`);
    redirect(`/croit/taiere/${rez.id}`);
  }

  return (
    <>
      <p className="sumar">
        {lista.reduce((s, r) => s + r.disponibil, 0)} buc rămase de croit · {lista.length} comenzi · {peModel.size} modele
      </p>
      <p className="filtre"><Pliere semn="ramas" /></p>
      <datalist id="motive-croit">{motive.map((x) => <option key={x.id} value={x.nume} />)}</datalist>
      <p className="slab">
        Scrie, la fiecare mărime, câte bucăți tai acum — doar unele mărimi, sau doar o parte dintr-o mărime. „Tot” ia tot ce
        a rămas din comandă. Poți pune în aceeași taiere mai multe comenzi de pe același model (PSF cu PSF, PSF cu PSC).
        Ce nu scrii rămâne aici.
      </p>
      {lista.length === 0 ? <p className="slab">Nu a rămas nimic de croit.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Comandă</th><th>Termen</th><th>Produs</th><th>Rămas pe mărimi → tai acum</th><th className="nr">Rest</th><th /></tr></thead>
            <tbody>
              {[...peModel].map(([cheie, randuri]) => {
                const formular = `t-${cheie}`;
                const ale = deschise.filter((t) => t.model_cheie === cheie);
                return (
                  <Fragment key={cheie}>
                    <tr className="grupa-model">
                      <td colSpan={4}>
                        <strong>{randuri[0].model}</strong>{' '}
                        <span className="slab">{randuri.length} {randuri.length === 1 ? 'comandă' : 'comenzi'}</span>
                        {randuri[0].fara_model && (
                          <span className="slab">
                            {' · '}fără model: ca să se taie cu alte culori, leagă produsul de un model în{' '}
                            <Link href="/modele">Modele și rețete</Link>
                          </span>
                        )}
                      </td>
                      <td className="nr"><strong>{randuri.reduce((s, r) => s + r.disponibil, 0)}</strong></td>
                      <td>
                        <form id={formular} action={taie} className="in-rand">
                          <fieldset disabled={!m} className="fara-chenar">
                            {randuri.map((r) => <input key={r.planificare_id} type="hidden" name="pl" value={r.planificare_id} />)}
                            {ale.length > 0 && (
                              <select name="taiere" defaultValue="" aria-label="În ce taiere">
                                <option value="">taiere nouă</option>
                                {ale.map((t) => <option key={t.id} value={t.id}>adaugă în {t.cod}</option>)}
                              </select>
                            )}
                            <button>Fă taierea</button>
                          </fieldset>
                        </form>
                      </td>
                    </tr>
                    {randuri.map((r) => (
                      <tr key={r.planificare_id}>
                        <td>
                          <Link href={`/planificare/${r.planificare_id}`}>{r.cod}</Link>{' '}
                          <span className="slab">{r.tip} · P{r.prioritate}</span>
                        </td>
                        <td className="slab">{r.data_ceruta}</td>
                        <td>{r.produs}</td>
                        <td>
                          <span className="marimi-croit">
                            {r.marimi.filter((x) => x.disponibil > 0).map((x) => (
                              <label key={x.marime_id}>
                                <span className="slab">{x.marime} · {x.disponibil}</span>
                                <input name={`q:${r.planificare_id}:${x.marime_id}`} form={formular} inputMode="numeric"
                                       className="bucati" placeholder="0" disabled={!m} aria-label={`${r.cod} ${x.marime}, din ${x.disponibil}`} />
                              </label>
                            ))}
                            <label className="bifa-tot">
                              <span className="slab">tot</span>
                              <input type="checkbox" name={`tot:${r.planificare_id}`} value="1" form={formular} disabled={!m}
                                     aria-label={`Tot ce a rămas din ${r.cod}`} />
                            </label>
                          </span>
                          {r.in_taieri > 0 && <span className="slab">{r.in_taieri} buc deja în taieri necroite</span>}
                        </td>
                        <td className="nr"><strong>{r.disponibil}</strong></td>
                        <td>
                          {m && (
                            <details>
                              <summary className="slab">stinge comanda</summary>
                              <form action={stinge} className="antet-comanda">
                                <input type="hidden" name="planificare" value={r.planificare_id} />
                                <label>
                                  <span>Motiv</span>
                                  <input name="motiv" list="motive-croit" required placeholder="din listă sau scrie ce vrei" />
                                </label>
                                <label><span>Observații</span><input name="observatii" placeholder="opțional" /></label>
                                <div className="actiuni"><button className="secundar">Închide: nu se mai croiește</button></div>
                              </form>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
