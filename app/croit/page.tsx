import { Stadiu, Termen } from '../Insigne';
import Link from 'next/link';
import { CineCroieste, OameniCroit } from './OameniCroit';
import Mostre from './Mostre';
import { DIFICULTATI, dificultateDin } from '../lib/dificultate';
import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import { croiesteDirect, inchideComanda, loturiCroite, oameniCroit, OPERATII, ramasDeCroit, taieriLaCroit, type LotCroit, type Operatie, type RamasDeCroit, type TaiereLaCroit, type VedereCroit } from '../lib/croitTaiere';
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
  ['mostre', 'Mostre'],
];


/**
 * Ce vede croitul:
 *   toate · croite · rămas de croit · mostre (mostre și comenzi de croit date chiar de aici)
 * „Rămas de croit" e ce a trimis planificarea și n-a intrat încă în nicio taiere,
 * pe model și pe mărimi; de aici șefa de croit face taierile — ce se taie odată —
 * și tot de aici stinge, cu observații, o comandă care nu se mai croiește.
 * O taiere se face abia la croire, deci „Croite" sunt taierile: pe taieri (grupate pe
 * săptămâni, luni, trimestre, ani), pe comenzi sau pe modele.
 */
export default async function Croit({ searchParams }: { searchParams: Promise<{ vedere?: string; grupare?: string; eroare?: string; cauta?: string; pe?: string; ok?: string }> }) {
  await cere('croit');
  const { vedere = 'toate', grupare, eroare, cauta, pe, ok } = await searchParams;
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
      {vedere === 'croite' && (
        <div className="filtre">
          {([['taieri', 'Pe taieri'], ['comenzi', 'Pe comenzi (PSF, PSC)'], ['modele', 'Pe modele']] as const).map(([k, nume]) => (
            <Link key={k} href={`/croit?vedere=croite&pe=${k}${cauta ? `&cauta=${encodeURIComponent(cauta)}` : ''}`}
                  className={`buton ${(pe ?? 'taieri') === k ? 'activ-buton' : ''}`}>{nume}</Link>
          ))}
        </div>
      )}
      {vedere === 'mostre' ? <Mostre cauta={cauta} ok={ok} /> : vedere === 'croite' && (pe === 'comenzi' || pe === 'modele') ? <CroitePe pe={pe} cauta={cauta} /> : vedere === 'ramas' ? <Ramas cauta={cauta} /> : (
        <>
          {/* La Croite, taierile stau sub PSF-ul sau PSC-ul din care au venit (/T1, /T2…). */}
          {vedere === 'toate' && <DeCroitPeScurt cauta={cauta} />}
          {vedere === 'toate' && <h2>Croite</h2>}
          {vedere === 'croite' ? <p className="filtre"><Pliere semn={`croite-${cauta ?? ''}`} /></p> : <Grupare ales={g} pastreaza={{ vedere, cauta }} />}
          <Taieri vedere={vedere as VedereCroit} grupare={g} cauta={cauta} peComanda={vedere === 'croite'} />
        </>
      )}
    </main>
  );
}

/**
 * La „Toate", întâi ce mai e de croit — pe PSF/PSC: modelul, culorile, câte bucăți
 * au rămas și termenul, cu drumul spre „Rămas de croit" unde se croiesc —, apoi croitele.
 */
/** Culoarea din numele produsului: fără tip (Rochie, Palton…) și fără model — „Rochie Valerie Negru" → „Negru". */
const culoare = (produs: string, model: string) => {
  const m = new Set(model.toLowerCase().split(/\s+/));
  const rest = produs.split(/\s+/).slice(1).filter((w) => !m.has(w.toLowerCase()));
  return rest.join(' ') || produs;
};

async function DeCroitPeScurt({ cauta }: { cauta?: string }) {
  const lista = (await ramasDeCroit()).filter((r) => potriveste(cauta, r.cod, r.comanda, r.produs, r.model));
  const pe = new Map<string, RamasDeCroit[]>();
  for (const r of lista) pe.set(r.comanda, [...(pe.get(r.comanda) ?? []), r]);
  const comenzi = [...pe].sort(([, a], [, b]) => a[0].data_ceruta.localeCompare(b[0].data_ceruta));
  return (
    <section>
      <h2>De croit <span className="slab">· {lista.reduce((s, r) => s + r.disponibil, 0)} buc în {pe.size} comenzi</span></h2>
      {pe.size === 0 ? <p className="slab">Nimic de croit.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Comandă</th><th>Model</th><th>Culori</th><th>Termen</th><th className="nr">De croit</th><th /></tr></thead>
            <tbody>
              {comenzi.map(([c, rs]) => (
                <tr key={c}>
                  <td>{c} <span className="slab">{rs[0].tip} · P{rs[0].prioritate}</span></td>
                  <td>{[...new Set(rs.map((r) => r.model))].join(', ')}</td>
                  <td className="slab">{rs.map((r) => `${culoare(r.produs, r.model)} ${r.disponibil}`).join(' · ')}</td>
                  <td><Termen data={rs.map((r) => r.data_ceruta).sort()[0]} /></td>
                  <td className="nr"><strong>{rs.reduce((s, r) => s + r.disponibil, 0)}</strong></td>
                  <td><Link href={`/croit?vedere=ramas&cauta=${encodeURIComponent(c)}`} className="buton">Croiește</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function Taieri({ vedere, grupare, cauta, peComanda = false }: { vedere: VedereCroit; grupare: TipPerioada | ''; cauta?: string; peComanda?: boolean }) {
  const lista = (await taieriLaCroit(vedere)).filter((t) => potriveste(cauta, t.cod, t.model, t.comenzi));
  const deCroit = lista.filter((t) => t.loturi_deschise > 0);
  const zi = (t: TaiereLaCroit) => t.croit_la ?? t.facuta_la;
  // Comanda din care vine taierea: numele ei fără /T (psc-ms-26-noi-1/T2 → psc-ms-26-noi-1).
  const comanda = (t: TaiereLaCroit) => t.cod.replace(/\/T\d+$/, '');
  const grupa = (t: TaiereLaCroit) => (peComanda ? comanda(t) : grupare ? perioada(grupare, zi(t)).nume : '');
  if (peComanda) {
    // Comenzile cu taierea cea mai nouă sus; în comandă, T1, T2… în ordine.
    const ultima = new Map<string, string>();
    for (const t of lista) if (zi(t) > (ultima.get(comanda(t)) ?? '')) ultima.set(comanda(t), zi(t));
    const nr = (t: TaiereLaCroit) => Number(t.cod.match(/\/T(\d+)$/)?.[1] ?? 0);
    lista.sort((a, b) => ultima.get(comanda(b))!.localeCompare(ultima.get(comanda(a))!) || comanda(a).localeCompare(comanda(b)) || nr(a) - nr(b));
  } else if (grupare) lista.sort((a, b) => zi(b).localeCompare(zi(a)));  // grupate, cele mai noi sus; altfel ordinea cozii
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
                const nou = (peComanda || grupare !== '') && (i === 0 || grupa(lista[i - 1]) !== grupa(t));
                const din = nou ? lista.filter((x) => grupa(x) === grupa(t)) : [];
                return (
                  <Fragment key={t.id}>
                    {nou && (
                      <tr className="grupa-model">
                        <td colSpan={4}>
                          <strong>{grupa(t)}</strong>{' '}
                          <span className="slab">{peComanda && `${t.model} · `}{din.length} {din.length === 1 ? 'taiere' : 'taieri'}</span>
                        </td>
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
                        {t.componente ? `${t.intinse}/${t.componente} · ${t.taiate}/${t.componente}` : `${t.intinse ? 'da' : 'nu'} · ${t.taiate ? 'da' : 'nu'}`} · {t.imperecheat ? 'da' : 'nu'}
                      </td>
                      <td>{t.croit_la ? <Stadiu cheie="gata" nume={`croit ${t.croit_la}`} /> : <Stadiu cheie="in_croit" nume="în lucru" />}</td>
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

/**
 * Croitele pe comenzi (PSF, PSC) sau pe modele: fiecare grupă cu totalul ei, iar
 * dedesubt fiecare culoare croită, cu mărimile și taierea în care s-a tăiat — o comandă
 * tăiată în două taieri apare de două ori, o taiere cu un PSF și un PSC apare la amândouă.
 */
async function CroitePe({ pe, cauta }: { pe: 'comenzi' | 'modele'; cauta?: string }) {
  const lista = (await loturiCroite()).filter((l) => potriveste(cauta, l.cod, l.comanda, l.model, l.produs, l.taiere));
  const grupe = new Map<string, LotCroit[]>();
  for (const l of lista) {
    const k = pe === 'comenzi' ? l.comanda : l.model;
    grupe.set(k, [...(grupe.get(k) ?? []), l]);
  }
  return (
    <>
      <p className="sumar">{lista.reduce((s, l) => s + l.croit, 0)} buc croite · {grupe.size} {pe === 'comenzi' ? 'comenzi' : 'modele'} · {new Set(lista.map((l) => l.taiere)).size} taieri</p>
      <p className="filtre"><Pliere semn={`croite-${pe}`} /></p>
      {lista.length === 0 ? <p className="slab">Nimic croit.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead>
              <tr><th>{pe === 'comenzi' ? 'Comandă' : 'Model'}</th><th>{pe === 'comenzi' ? 'Model' : 'Comandă'}</th><th>Culoare</th>
                  <th>Mărimi croite</th><th className="nr">Croit</th><th>Taiere</th><th>Croit la</th></tr>
            </thead>
            <tbody>
              {[...grupe].map(([k, loturi]) => (
                <Fragment key={k}>
                  <tr className="grupa-model">
                    <td colSpan={4}>
                      <strong>{k}</strong>{' '}
                      <span className="slab">
                        {pe === 'comenzi' ? `${loturi[0].tip} · ${loturi[0].brand} · ${loturi[0].model}` : `${new Set(loturi.map((l) => l.comanda)).size} comenzi`}
                        {' · '}{new Set(loturi.map((l) => l.taiere)).size} {new Set(loturi.map((l) => l.taiere)).size === 1 ? 'taiere' : 'taieri'}
                      </span>
                    </td>
                    <td className="nr"><strong>{loturi.reduce((s, l) => s + l.croit, 0)}</strong></td>
                    <td colSpan={2} className="slab">{[...new Set(loturi.map((l) => l.taiere).filter(Boolean))].join(', ')}</td>
                  </tr>
                  {loturi.map((l) => (
                    <tr key={l.lot_id}>
                      <td><Link href={`/croit/${l.lot_id}`}>{l.cod}</Link></td>
                      <td>{pe === 'comenzi' ? l.model : <>{l.comanda} <span className="slab">{l.tip}</span></>}</td>
                      <td>{l.produs}</td>
                      <td className="slab">{l.marimi ?? '—'}</td>
                      <td className="nr">{l.croit}</td>
                      <td>{l.taiere_id ? <Link href={`/croit/taiere/${l.taiere_id}`}>{l.taiere}</Link> : '—'}</td>
                      <td className="slab">{l.croit_la}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Ramas({ cauta }: { cauta?: string }) {
  const m = await poateModifica('croit');
  const [toate, motive, inTaieri, om] = await Promise.all([ramasDeCroit(), motiveCroit(), taieriLaCroit('taieri'), oameniCroit()]);
  const lista = toate.filter((r) => potriveste(cauta, r.cod, r.comanda, r.produs, r.model));
  // Ce e pus deja într-o taiere, dar încă necroit: tot de croit, doar că se croiește din taierea lui.
  const puse = inTaieri.filter((t) => potriveste(cauta, t.cod, t.comenzi, t.model));
  const peModel = new Map<string, RamasDeCroit[]>();
  for (const r of lista) peModel.set(r.model_cheie, [...(peModel.get(r.model_cheie) ?? []), r]);
  // În fiecare model, pe culori: comenzile aceleiași culori stau una lângă alta.
  for (const [k, v] of peModel) peModel.set(k, [...v].sort((a, b) => a.produs.localeCompare(b.produs, 'ro') || (a.ordine ?? 0) - (b.ordine ?? 0)));

  async function stinge(date: FormData) {
    'use server';
    await cere('croit', 'modifica');
    const e = await inchideComanda(String(date.get('planificare')), String(date.get('motiv') ?? ''),
      String(date.get('observatii') ?? ''));
    redirect(`/croit?vedere=ramas${e ? `&eroare=${encodeURIComponent(e)}` : ''}`);
  }

  // Croitul direct: ce s-a tăiat pe mărimi („tot" ia tot ce a rămas, pe mărimile lăsate
  // goale) și cine a lucrat. Abia acum se face taierea, deja croită.
  async function croieste(date: FormData) {
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
    const oameni = new Map((['intins', 'taiat', 'separat', 'termocolat'] as const)
      .map((op) => [op, date.getAll(`om:${op}`).map(String).filter(Boolean)] as [Operatie, string[]]));
    const rez = await croiesteDirect(alocari, oameni, dificultateDin(date.get('dificultate')));
    if (typeof rez === 'string') redirect(`/croit?vedere=ramas&eroare=${encodeURIComponent(rez)}`);
    redirect(`/croit/taiere/${rez.id}`);
  }

  return (
    <>
      <p className="sumar">
        {lista.reduce((s, r) => s + r.disponibil, 0)} buc de croit · {lista.length} comenzi · {peModel.size} modele
        {puse.length > 0 && <> · <strong>{puse.reduce((s, t) => s + t.cerut - t.croit, 0)} buc în {puse.length} {puse.length === 1 ? 'taiere începută' : 'taieri începute'}, încă necroite</strong></>}
      </p>
      {puse.length > 0 && (
        <section>
          <h2>În taieri, încă necroite</h2>
          <p className="slab">Sunt puse deja într-o taiere: se croiesc de acolo (întins, tăiat, apoi „Înregistrează croitul").</p>
          <div className="tabel-derulant">
            <table className="centralizator">
              <thead><tr><th>Taiere</th><th>Model</th><th>Comenzi</th><th>Făcută</th><th className="nr">Buc</th><th>Întins · tăiat</th><th /></tr></thead>
              <tbody>
                {puse.map((t) => (
                  <tr key={t.id}>
                    <td><Link href={`/croit/taiere/${t.id}`}>{t.cod}</Link></td>
                    <td>{t.model}</td>
                    <td>{t.comenzi}</td>
                    <td className="slab">{t.facuta_la}</td>
                    <td className="nr"><strong>{t.cerut - t.croit}</strong></td>
                    <td className="slab">{t.intinse ? 'întins' : 'neîntins'} · {t.taiate ? 'tăiat' : 'netăiat'}</td>
                    <td><Link href={`/croit/taiere/${t.id}`} className="buton">Deschide taierea</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>De croit</h2>
        </section>
      )}
      <p className="filtre"><Pliere semn="ramas" /></p>
      <datalist id="motive-croit">{motive.map((x) => <option key={x.id} value={x.nume} />)}</datalist>
      <p className="slab">
        Pe fiecare model, pe culori: scrie la fiecare comandă câte bucăți ai tăiat pe mărimi (sau bifează „tot"), alege cine
        a lucrat și „Salvează croitul" — abia atunci se face taierea, deja croită. Se pot tăia împreună mai multe comenzi de pe
        același model (PSF cu PSF, PSF cu PSC); o comandă se poate tăia și în mai multe taieri: ce nu tai acum rămâne aici.
      </p>
      {lista.length === 0 ? <p className="slab">{puse.length ? 'Tot ce e de croit e pus deja în taieri (mai sus).' : 'Nu a rămas nimic de croit.'}</p> : (
        <OameniCroit croit={om.oameni} altii={om.altii}>
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Comandă</th><th>Model</th><th>Termen</th><th>Produs</th><th>Rămas pe mărimi → tai acum</th><th className="nr">Rest</th><th /></tr></thead>
            <tbody>
              {[...peModel].map(([cheie, randuri]) => {
                const formular = `t-${cheie}`;
                return (
                  <Fragment key={cheie}>
                    <tr className="grupa-model">
                      <td colSpan={5}>
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
                        <form id={formular} action={croieste}>
                          {randuri.map((r) => <input key={r.planificare_id} type="hidden" name="pl" value={r.planificare_id} />)}
                        </form>
                        <a href={`/croit/fisa?${randuri.map((r) => `pl=${r.planificare_id}`).join('&')}`} target="_blank" rel="noopener" className="buton">
                          Printează foaia de croit
                        </a>
                      </td>
                    </tr>
                    {randuri.map((r) => (
                      <tr key={r.planificare_id}>
                        <td>
                          <Link href={`/planificare/${r.planificare_id}`}>{r.cod}</Link>{' '}
                          <span className="slab">{r.tip} · P{r.prioritate}</span>
                          {r.saptamana && <> <span className="insigna albastru" title="săptămâna termenului, în planul din Producție">săpt. {r.saptamana.slice(5).split('-').reverse().join('.')}</span></>}
                          {r.stofa_lipsa && <> <span className="insigna galben" title="Stocul de stofă din aplicație nu ajunge, în ordinea priorității. Se poate croi oricum, dacă stofa e la croit.">stofă insuficientă</span></>}
                        </td>
                        <td>{r.model}</td>
                        <td><Termen data={r.data_ceruta} /></td>
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
                    <tr className="cine-croieste">
                      <td colSpan={7}>
                        <strong>Cine a lucrat</strong>
                        <CineCroieste formular={formular} dezactivat={!m}
                          operatii={(['intins', 'taiat', 'separat', 'termocolat'] as const).map((op) => [op, OPERATII[op], op === 'intins' || op === 'taiat'])} />
                        <label className="dificultate-croit">
                          <span>Dificultate</span>
                          <select name="dificultate" form={formular} defaultValue="2" disabled={!m} aria-label="Gradul de dificultate al taierii">
                            {([1, 2, 3] as const).map((d) => <option key={d} value={d}>{DIFICULTATI[d].nume}</option>)}
                          </select>
                        </label>
                        <button form={formular} className="principal" disabled={!m}>Salvează croitul</button>
                        <span className="slab"> — devine taierea (deja croită); ce nu tai rămâne aici.</span>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </OameniCroit>
      )}
    </>
  );
}
