import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Fragment } from 'react';
import { Stadiu, Termen } from '../Insigne';
import { cere, poateModifica } from '../lib/sesiune';
import { azi, potriveste } from '../lib/format';
import Cauta from '../Cauta';
import { adaugaZile, luni } from '../lib/perioade';
import { deAlimentat, transe, type LotDeAlimentat, type Transa } from '../lib/banda';
import { STADII_LINIE } from '../lib/centralizator';
import { bucatiProgramate, comenziInPlan, mutaPlan, oameniPeTranse, programeaza, scoateDinPlan, type ComandaInPlan, type LinieInPlan, type PlanLinie } from '../lib/productie';
import { parametriTimp } from '../lib/parametriTimp';
import './productie.css';
import FileProductie from './FileProductie';
import RandCascada from './RandCascada';
import MarimiComanda from './MarimiComanda';

export const dynamic = 'force-dynamic';

const zi = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', timeZone: 'UTC' });
/** „2 – 6 noiembrie": de luni până vineri. */
const numeSaptamana = (l: string) => {
  const v = adaugaZile(l, 4);
  return l.slice(5, 7) === v.slice(5, 7) ? `${Number(l.slice(8))} – ${zi(v)}` : `${zi(l)} – ${zi(v)}`;
};
const oreText = (h: number) => `${Math.round(h).toLocaleString('ro-RO')} ore-om`;

/**
 * Producția pe săptămâni: planificarea și banda într-un singur loc. O comandă
 * lansată e deja la croit; aici managerul de producție o pune pe săptămâna în care
 * se lucrează. Pe fiecare comandă din săptămână se vede cât mai e de croit, cât s-a
 * croit și n-a intrat pe bandă, cât e în lucru și cât a ajuns în depozit — și de aici
 * intră în lucru: ce s-a croit se dă pe bandă, iar pe tranșa dată se alocă oamenii.
 *
 * Se vede o săptămână sau o perioadă aleasă (săptămânile ei, fiecare cu tabelul ei).
 * Ce a rămas neterminat din săptămânile trecute apare în săptămâna curentă.
 */
type Cautare = { sapt?: string; de?: string; pana?: string; faza?: string; eroare?: string; cauta?: string };

/** Unde e comanda programată: încă neintrată în lucru, intrată (ceva e pe bandă), gata în depozit. */
const FAZE = {
  planificat: 'Planificate, neintrate în lucru',
  in_lucru: 'Intrate în lucru',
  gata: 'Gata, în depozit',
} as const;
type Faza = keyof typeof FAZE;
const fazaLiniei = (l: LinieInPlan): Faza => (l.stadiu === 'gata' ? 'gata' : l.banda > 0 ? 'in_lucru' : 'planificat');
/** O programare din săptămână: o culoare a unei comenzi, cu bucățile puse pe săptămâna asta. */
type Intrare = { c: ComandaInPlan; l: LinieInPlan; p: PlanLinie; bucati: number };
/** Câte bucăți se programează: cele scrise; altfel toată culoarea (dacă n-are altă programare) sau ce a rămas. */
const bucatiDeProgramat = (l: LinieInPlan, scris: string): number | null =>
  scris.trim() ? Number(scris) : l.plan.length === 0 ? null : l.de_programat;
const eData = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

export default async function Productie({ searchParams }: { searchParams: Promise<Cautare> }) {
  await cere(['planificare', 'banda']);
  const m = (await poateModifica('planificare')) || (await poateModifica('banda'));
  const f = await searchParams;
  const curenta = luni(azi());
  // Perioada: de la lunea primei săptămâni până la lunea ultimei (o săptămână, implicit cea de acum).
  let de = eData(f.de) ? luni(f.de!) : eData(f.sapt) ? luni(f.sapt!) : curenta;
  let pana = eData(f.pana) ? luni(f.pana!) : de;
  if (pana < de) [de, pana] = [pana, de];
  const saptamani: string[] = [];
  for (let s = de; s <= pana && saptamani.length < 26; s = adaugaZile(s, 7)) saptamani.push(s);
  pana = saptamani[saptamani.length - 1];
  const nr = saptamani.length;

  const [toateComenzile, loturi, peBanda, oameni, param] = await Promise.all([
    comenziInPlan(saptamani), deAlimentat(), transe(false), oameniPeTranse(), parametriTimp(),
  ]);
  // Căutarea: după PSF/PSC, model sau produs (culoare), fără diacritice.
  const comenzi = toateComenzile.filter((c) => potriveste(f.cauta, c.numar, c.model, ...c.linii.map((l) => l.produs)));
  // Programările din fiecare săptămână (culori, cu bucățile lor). Ce a rămas neterminat din
  // săptămânile trecute (din afara perioadei) apare în săptămâna de acum.
  const dinSaptamana = (s: string): Intrare[] => comenzi.flatMap((c) => c.linii.flatMap((l) => l.plan
    .filter((p) => p.saptamana === s || (s === curenta && p.saptamana < curenta && !saptamani.includes(p.saptamana) && l.stadiu !== 'gata'))
    .map((p) => ({ c, l, p, bucati: bucatiProgramate(l, p) }))));
  const faza = f.faza && f.faza in FAZE ? (f.faza as Faza) : null;
  const toatePe = saptamani.map((s) => ({ s, lista: dinSaptamana(s) }));
  const inPerioada = toatePe.flatMap((x) => x.lista);
  const peFaze = Object.fromEntries((Object.keys(FAZE) as Faza[]).map((k) => [k, inPerioada.filter((x) => fazaLiniei(x.l) === k)])) as Record<Faza, Intrare[]>;
  const peSaptamani = toatePe.map((x) => ({ ...x, lista: faza ? x.lista.filter((i) => fazaLiniei(i.l) === faza) : x.lista }));
  const deProgramat = comenzi.filter((c) => c.linii.some((l) => l.de_programat > 0));
  const loturiPe = grupa(loturi, (l) => `${l.comanda}|${l.produs}`);
  const transePe = grupa(peBanda, (t) => `${t.comanda}|${t.produs}`);

  const capacitate = param.operatori * param.orePeZi * 5;
  const deLucru = inPerioada.filter((x) => x.l.stadiu !== 'gata');
  const faraTimp = new Set(deLucru.filter((x) => x.l.ore_om === null).map((x) => x.c.numar)).size;
  const buc = (lista: Intrare[]) => lista.reduce((s, x) => s + x.bucati, 0);
  const nrComenzi = (lista: Intrare[]) => new Set(lista.map((x) => x.c.comanda_id)).size;
  const adresa = (a: string, b: string, fz: Faza | null = faza) =>
    (a === b ? `/productie?sapt=${a}` : `/productie?de=${a}&pana=${b}`) + (fz ? `&faza=${fz}` : '') + (f.cauta ? `&cauta=${encodeURIComponent(f.cauta)}` : '');
  const aici = adresa(de, pana);
  const lunaAsta = azi().slice(0, 8) + '01';
  const sfarsitLuna = adaugaZile(new Date(Date.UTC(Number(lunaAsta.slice(0, 4)), Number(lunaAsta.slice(5, 7)), 1, 12)).toISOString().slice(0, 10), -1);
  const PRESETARI: [string, string, string][] = [
    ['Săptămâna asta', curenta, curenta],
    ['Următoarele 2 săptămâni', curenta, adaugaZile(curenta, 7)],
    ['Următoarele 4 săptămâni', curenta, adaugaZile(curenta, 21)],
    ['Luna asta', luni(lunaAsta), luni(sfarsitLuna)],
    ['Ultimele 4 săptămâni', adaugaZile(curenta, -21), curenta],
  ];

  // Programarea: un buton rapid („săpt. asta") pe o culoare (L:) sau pe toată comanda (C:),
  // ori culorile bifate, pe săptămâna aleasă din calendar; bucățile scrise, sau tot ce a rămas.
  async function pune(date: FormData) {
    'use server';
    await cere(['planificare', 'banda'], 'modifica');
    const toate = (await comenziInPlan([])).flatMap((c) => c.linii.map((l) => ({ c, l })));
    const scris = (id: string) => String(date.get(`b:${id}`) ?? '');
    const [cheie, unaSapt] = String(date.get('una') ?? '').split('|');
    let intrari: { linieId: string; bucati: number | null }[];
    let zi: string;
    if (cheie?.startsWith('C:')) {
      intrari = toate.filter((x) => x.c.comanda_id === cheie.slice(2) && x.l.de_programat > 0)
        .map((x) => ({ linieId: x.l.linie_id, bucati: bucatiDeProgramat(x.l, '') }));
      zi = unaSapt;
    } else if (cheie?.startsWith('L:')) {
      const x = toate.find((y) => y.l.linie_id === cheie.slice(2));
      intrari = x ? [{ linieId: x.l.linie_id, bucati: bucatiDeProgramat(x.l, scris(x.l.linie_id)) }] : [];
      zi = unaSapt;
    } else {
      const bifate = new Set(date.getAll('linie').map(String));
      intrari = toate.filter((x) => bifate.has(x.l.linie_id)).map((x) => ({ linieId: x.l.linie_id, bucati: bucatiDeProgramat(x.l, scris(x.l.linie_id)) }));
      zi = String(date.get('saptamana') ?? '');
    }
    const e = await programeaza(intrari, zi);
    redirect(e ? `${aici}&eroare=${encodeURIComponent(e)}` : aici);
  }
  async function muta(date: FormData) {
    'use server';
    await cere(['planificare', 'banda'], 'modifica');
    const plan = String(date.get('plan'));
    if (date.get('scoate')) await scoateDinPlan(plan);
    else {
      const e = await mutaPlan(plan, String(date.get('saptamana') ?? ''));
      if (e) redirect(`${aici}&eroare=${encodeURIComponent(e)}`);
    }
    redirect(aici);
  }

  return (
    <main className="lat">
      <h1>Producție</h1>
      <FileProductie activ="plan" />
      <p className="slab">Pune pe săptămâna în care se lucrează o comandă întreagă, doar unele culori sau doar o parte din bucăți. Ce s-a croit se dă în lucru din fila 2 · Bandă.</p>
      <div className="liste-actiuni perioade">
        <span className="filtre">
          <Link href={adresa(adaugaZile(de, -7 * nr), adaugaZile(pana, -7 * nr))} className="buton">← {nr === 1 ? 'săptămâna dinainte' : `${nr} săpt. înainte`}</Link>
          {PRESETARI.map(([nume, a, b]) => (
            <Link key={nume} href={adresa(a, b)} className={`buton ${a === de && b === pana ? 'activ-buton' : ''}`}>{nume}</Link>
          ))}
          <Link href={adresa(adaugaZile(de, 7 * nr), adaugaZile(pana, 7 * nr))} className="buton">{nr === 1 ? 'săptămâna următoare' : `${nr} săpt. după`} →</Link>
        </span>
      </div>
      <Cauta valoare={f.cauta} pastreaza={{ sapt: de === pana ? de : undefined, de: de !== pana ? de : undefined, pana: de !== pana ? pana : undefined, faza: faza ?? undefined }}
             placeholder="caută: PSF/PSC, model sau culoare" />
      <form method="get" className="filtre" key={`${de}${pana}`}>
        {f.cauta && <input type="hidden" name="cauta" value={f.cauta} />}
        <span className="slab">Perioadă aleasă: de la</span>
        <input type="date" name="de" defaultValue={de} aria-label="De la" />
        <span className="slab">până la</span>
        <input type="date" name="pana" defaultValue={adaugaZile(pana, 4)} aria-label="Până la" />
        <button className="buton">Arată perioada</button>
        <span className="slab">se iau săptămânile întregi, luni–vineri</span>
      </form>
      {f.eroare && <p className="eroare">{f.eroare}</p>}

      <h2>
        {nr === 1 ? numeSaptamana(de) : `${zi(de)} – ${zi(adaugaZile(pana, 4))}`}
        {nr === 1 && de === curenta && <span className="slab"> · săptămâna asta</span>}
        {nr > 1 && <span className="slab"> · {nr} săptămâni</span>}
      </h2>
      <p className="sumar">
        {nrComenzi(inPerioada)} comenzi · {inPerioada.length} culori · {buc(inPerioada)} buc programate
        {deLucru.length > 0 && <> · de lucru ≈ {oreText(deLucru.reduce((s, x) => s + ramase(x), 0))} din {oreText(capacitate * nr)}{' '}
          <span className="slab">({param.operatori} operatori × {param.orePeZi} h × 5 zile{nr > 1 && ` × ${nr} săptămâni`})</span></>}
        {faraTimp > 0 && <span className="slab"> · {faraTimp} fără timp în nomenclator</span>}
      </p>
      <nav className="faze" aria-label="Ce e planificat și ce a intrat în lucru">
        <Link href={adresa(de, pana, null)} className={`faza ${!faza ? 'activ-faza' : ''}`}>
          <strong>{inPerioada.length}</strong> culori programate <span className="slab">{buc(inPerioada)} buc</span>
        </Link>
        {(Object.keys(FAZE) as Faza[]).map((k) => (
          <Link key={k} href={adresa(de, pana, k)} className={`faza ${k} ${faza === k ? 'activ-faza' : ''}`}>
            <strong>{peFaze[k].length}</strong> {FAZE[k].toLowerCase()} <span className="slab">{buc(peFaze[k])} buc</span>
          </Link>
        ))}
      </nav>

      {peSaptamani.map(({ s, lista }) => {
        const ore = lista.filter((x) => x.l.stadiu !== 'gata').reduce((t, x) => t + ramase(x), 0);
        return (
          <section key={s}>
            {nr > 1 && (
              <h3>
                {numeSaptamana(s)}{s === curenta && <span className="slab"> · săptămâna asta</span>}
                <span className="slab"> · {nrComenzi(lista)} {nrComenzi(lista) === 1 ? 'comandă' : 'comenzi'} · {lista.length} culori · {buc(lista)} buc{ore > 0 && ` · ≈ ${oreText(ore)} din ${oreText(capacitate)}`}</span>
              </h3>
            )}
            {ore > capacitate && <p className="eroare">{nr > 1 ? numeSaptamana(s) : 'Săptămâna'} are mai mult de lucru decât încape cu {param.operatori} operatori: mută ceva pe altă săptămână sau alocă mai mulți oameni.</p>}
            {lista.length === 0 ? <p className="slab">Nimic programat{nr === 1 && '. Pune comenzi din „De programat", mai jos'}.</p> : (
              <TabelSaptamana s={s} lista={lista} loturiPe={loturiPe} transePe={transePe} oameni={oameni} m={m} muta={muta} />
            )}
          </section>
        );
      })}

      <h2>De programat</h2>
      <p className="slab">
        Ce n-a fost pus încă pe o săptămână. Pe toată comanda: „săpt. asta / viitoare" din capul ei. Pe o culoare: butoanele de pe
        rând — cu bucățile scrise (doar o parte) sau, gol, tot ce a rămas. Sau bifează culori și alege din calendar orice săptămână.
      </p>
      {deProgramat.length === 0 ? <p className="slab">Totul e programat.</p> : (
        <form action={pune}>
          <fieldset disabled={!m} className="filtre">
            <span className="slab">Bifează culorile, apoi alege din calendar o zi din săptămâna de lucru:</span>
            <input type="date" name="saptamana" defaultValue={de} aria-label="O zi din săptămâna de lucru" />
            <button>Pune pe săptămâna ei</button>
          </fieldset>
          <div className="tabel-derulant">
            <table className="centralizator">
              <thead>
                <tr><th /><th>Comandă · culoare</th><th>Termen</th><th className="nr">Cerut</th><th className="nr">Deja programat</th>
                    <th>Bucăți de programat</th><th>Stadiu</th>{m && <th>Planifică</th>}</tr>
              </thead>
              <tbody>
                {deProgramat.map((c) => (
                  <Fragment key={c.comanda_id}>
                    <tr className="grupa-faza planificat">
                      <td colSpan={m ? 7 : 7}>
                        <Link href={`/necesar/${encodeURIComponent(c.numar)}`}>{c.numar}</Link>{' '}
                        <span className="slab">{c.tip} · {c.brand} · P{c.prioritate}{c.kam && ` · ${c.kam}`} · {c.model}</span>
                      </td>
                      {m && (
                        <td>
                          <span className="rapid">
                            <button name="una" value={`C:${c.comanda_id}|${curenta}`} className="secundar" title="Toată comanda (ce a rămas) pe săptămâna asta">toată · săpt. asta</button>
                            <button name="una" value={`C:${c.comanda_id}|${adaugaZile(curenta, 7)}`} className="secundar">toată · săpt. viitoare</button>
                          </span>
                        </td>
                      )}
                    </tr>
                    {c.linii.filter((l) => l.de_programat > 0).map((l) => (
                      <RandCascada key={l.linie_id} coloane={m ? 8 : 7} detalii={<Marimi linii={[l]} />} celule={<>
                        <td><input type="checkbox" name="linie" value={l.linie_id} disabled={!m} aria-label={`Programează ${l.produs}`} /></td>
                        <td className="cascada"><strong>{l.produs}</strong></td>
                        <td><Termen data={l.data_ceruta} /></td>
                        <td className="nr">{l.cerut}</td>
                        <td className="nr">{l.cerut - l.de_programat || '—'}</td>
                        <td>
                          <input name={`b:${l.linie_id}`} inputMode="numeric" className="bucati" placeholder={String(l.de_programat)} disabled={!m}
                                 aria-label={`Bucăți de programat din ${l.produs}, gol = toate ${l.de_programat}`} />
                          <span className="slab"> din {l.de_programat}</span>
                        </td>
                        <td><Stadiu cheie={l.stadiu} nume={STADII_LINIE[l.stadiu]} /></td>
                        {m && (
                          <td>
                            <span className="rapid">
                              <button name="una" value={`L:${l.linie_id}|${curenta}`} className="secundar">săpt. asta</button>
                              <button name="una" value={`L:${l.linie_id}|${adaugaZile(curenta, 7)}`} className="secundar">săpt. viitoare</button>
                            </span>
                          </td>
                        )}
                      </>} />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </form>
      )}
      <p className="slab">
        Banda: <Link href="/banda">de dat pe bandă și în lucru</Link> · <Link href="/banda?vedere=predate">terminate</Link>.
      </p>
    </main>
  );
}

/** Orele care mai sunt de lucru pe o programare: partea ei din orele culorii, cât n-a ajuns încă în depozit. */
const ramase = (x: Intrare) => (x.l.ore_om ?? 0) * (x.bucati / (x.l.cerut || 1)) * Math.max(0, x.l.cerut - x.l.intrat) / (x.l.cerut || 1);

function TabelSaptamana({ s, lista, loturiPe, transePe, oameni, m, muta }: {
  s: string; lista: Intrare[]; loturiPe: Map<string, LotDeAlimentat[]>; transePe: Map<string, Transa[]>;
  oameni: Map<string, number>; m: boolean; muta: (date: FormData) => Promise<void>;
}) {
  // Pe faze, în ordinea drumului: ce e planificat și n-a intrat, ce a intrat, ce e gata.
  const grupe = (Object.keys(FAZE) as Faza[]).map((k) => ({ k, randuri: lista.filter((x) => fazaLiniei(x.l) === k) }))
    .filter((g) => g.randuri.length > 0);
  const coloane = m ? 11 : 10;
  return (
    <div className="tabel-derulant">
      <table className="centralizator">
        <thead>
          <tr>
            <th>Comandă · culoare</th><th>Termen</th><th className="nr">Programat</th>
            <th className="nr">Rămas de croit</th><th className="nr">Croit, nedat</th><th className="nr">În lucru</th>
            <th className="nr">În depozit</th><th>Stadiu</th><th>Pe bandă</th><th className="nr">Timp</th>{m && <th />}
          </tr>
        </thead>
        <tbody>
          {grupe.map((g) => (
            <Fragment key={g.k}>
            <tr className={`grupa-faza ${g.k}`}>
              <td colSpan={coloane}>{FAZE[g.k]} · {g.randuri.length} culori · {g.randuri.reduce((t, x) => t + x.bucati, 0)} buc</td>
            </tr>
          {g.randuri.map(({ c, l, p, bucati }) => (
            <RandCascada key={p.id} coloane={coloane} detalii={<Marimi linii={[l]} />} celule={<>
              <td className="cascada">
                <Link href={`/necesar/${encodeURIComponent(c.numar)}`}>{c.numar}</Link> <strong>{l.produs}</strong>{' '}
                <span className="slab">{c.tip} · P{c.prioritate}</span>
                {p.saptamana !== s && <><br /><span className="insigna galben">rămas din {numeSaptamana(p.saptamana)}</span></>}
              </td>
              <td><Termen data={l.data_ceruta} gata={l.stadiu === 'gata'} /></td>
              <td className="nr"><strong>{bucati}</strong>{bucati < l.cerut && <span className="slab"> din {l.cerut}</span>}</td>
              <td className="nr">{l.rest || '—'}</td>
              <td className="nr">{Math.max(0, l.croit - l.banda) || '—'}</td>
              <td className="nr">{Math.max(0, l.banda - l.intrat) || '—'}</td>
              <td className="nr">{l.intrat || '—'}</td>
              <td><Stadiu cheie={l.stadiu} nume={STADII_LINIE[l.stadiu]} /></td>
              <td><InLucru c={c} l={l} loturi={loturiPe.get(`${c.numar}|${l.produs}`) ?? []} transe={transePe.get(`${c.numar}|${l.produs}`) ?? []} oameni={oameni} /></td>
              <td className="nr slab">{l.ore_om === null ? '—' : oreText(l.ore_om * bucati / (l.cerut || 1))}</td>
              {m && (
                <td>
                  <form action={muta} className="muta">
                    <input type="hidden" name="plan" value={p.id} />
                    <input type="date" name="saptamana" defaultValue={p.saptamana} aria-label={`Mută ${l.produs}: o zi din săptămâna nouă`} />
                    <button className="secundar">Mută</button>
                    <button name="scoate" value="1" className="secundar" title="Scoate din plan: trece înapoi la De programat">Scoate</button>
                  </form>
                </td>
              )}
            </>} />
          ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Legătura cu banda, fără să amestece planul cu alimentarea: câte bucăți croite
 * așteaptă banda și câte tranșe sunt pe bandă, fiecare cu drumul spre fila ei.
 */
function InLucru({ c, l, loturi, transe, oameni }: {
  c: ComandaInPlan; l: LinieInPlan; loturi: LotDeAlimentat[]; transe: Transa[]; oameni: Map<string, number>;
}) {
  const deDat = loturi.reduce((s, l) => s + l.rest, 0);
  const faraOameni = transe.filter((t) => !oameni.get(t.id) && ['alimentat', 'în producție'].includes(t.etapa)).length;
  const cauta = encodeURIComponent(c.numar);
  if (deDat === 0 && transe.length === 0) {
    return <span className="slab">{l.stadiu === 'gata' ? 'gata' : l.rest > 0 ? 'se așteaptă croitul' : '—'}</span>;
  }
  return (
    <>
      {deDat > 0 && <div><Link href={`/banda?cauta=${cauta}`}><strong>{deDat} buc de dat pe bandă →</strong></Link></div>}
      {transe.length > 0 && (
        <div>
          <Link href={`/banda?cauta=${cauta}`}>{transe.length} {transe.length === 1 ? 'tranșă' : 'tranșe'} pe bandă →</Link>
          {faraOameni > 0 && <> <span className="insigna galben">{faraOameni} fără oameni</span></>}
        </div>
      )}
    </>
  );
}

/** O comandă desfăcută: pe fiecare culoare și mărime — cerut, rămas de croit, croit, pe bandă, în depozit. */
const Marimi = ({ linii }: { linii: LinieInPlan[] }) => (
  <MarimiComanda linii={linii} masuri={[['cerut', 'Cerut'], ['rest', 'Rămas de croit'], ['croit', 'Croit'], ['banda', 'Pe bandă'], ['intrat', 'În depozit']]} />
);

function grupa<T>(lista: T[], cheie: (x: T) => string): Map<string, T[]> {
  const pe = new Map<string, T[]>();
  for (const x of lista) pe.set(cheie(x), [...(pe.get(cheie(x)) ?? []), x]);
  return pe;
}
