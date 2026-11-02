import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Fragment } from 'react';
import { Stadiu, Termen } from '../Insigne';
import { cere, poateModifica } from '../lib/sesiune';
import { azi } from '../lib/format';
import { adaugaZile, luni } from '../lib/perioade';
import { deAlimentat, transe, type LotDeAlimentat, type Transa } from '../lib/banda';
import { STADII_LINIE } from '../lib/centralizator';
import { comenziInPlan, oameniPeTranse, programeaza, scoateDinPlan, type ComandaInPlan, type LinieInPlan } from '../lib/productie';
import { parametriTimp } from '../lib/parametriTimp';
import './productie.css';
import FileProductie from './FileProductie';
import RandCascada from './RandCascada';
import { rangMarime } from '../lib/format';

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
type Cautare = { sapt?: string; de?: string; pana?: string; faza?: string; eroare?: string };

/** Unde e comanda programată: încă neintrată în lucru, intrată (ceva e pe bandă), gata în depozit. */
const FAZE = {
  planificat: 'Planificate, neintrate în lucru',
  in_lucru: 'Intrate în lucru',
  gata: 'Gata, în depozit',
} as const;
type Faza = keyof typeof FAZE;
const fazaComenzii = (c: ComandaInPlan): Faza => (c.stadiu === 'gata' ? 'gata' : c.banda > 0 ? 'in_lucru' : 'planificat');
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

  const [comenzi, loturi, peBanda, oameni, param] = await Promise.all([
    comenziInPlan(saptamani), deAlimentat(), transe(false), oameniPeTranse(), parametriTimp(),
  ]);
  // Ce a rămas neterminat din săptămânile trecute (din afara perioadei) apare în săptămâna de acum.
  const dinSaptamana = (s: string) => comenzi.filter((c) => c.saptamana === s
    || (s === curenta && c.saptamana !== null && c.saptamana < curenta && !saptamani.includes(c.saptamana) && c.stadiu !== 'gata'));
  const faza = f.faza && f.faza in FAZE ? (f.faza as Faza) : null;
  const toatePe = saptamani.map((s) => ({ s, lista: dinSaptamana(s) }));
  const inPerioada = toatePe.flatMap((x) => x.lista);
  const peFaze = Object.fromEntries((Object.keys(FAZE) as Faza[]).map((k) => [k, inPerioada.filter((c) => fazaComenzii(c) === k)])) as Record<Faza, ComandaInPlan[]>;
  const peSaptamani = toatePe.map((x) => ({ ...x, lista: faza ? x.lista.filter((c) => fazaComenzii(c) === faza) : x.lista }));
  const deProgramat = comenzi.filter((c) => !c.saptamana && c.stadiu !== 'gata');
  const loturiPe = grupa(loturi, (l) => l.comanda);
  const transePe = grupa(peBanda, (t) => t.comanda);

  const capacitate = param.operatori * param.orePeZi * 5;
  const deLucru = inPerioada.filter((c) => c.stadiu !== 'gata');
  const faraTimp = deLucru.filter((c) => c.ore_om === null).length;
  const suma = (lista: ComandaInPlan[], k: 'cerut' | 'rest_de_croit' | 'intrat') => lista.reduce((s, c) => s + c[k], 0);
  const adresa = (a: string, b: string, fz: Faza | null = faza) =>
    (a === b ? `/productie?sapt=${a}` : `/productie?de=${a}&pana=${b}`) + (fz ? `&faza=${fz}` : '');
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

  async function pune(date: FormData) {
    'use server';
    await cere(['planificare', 'banda'], 'modifica');
    // Un buton rapid pe rând („săpt. asta") trimite comanda și săptămâna lui; altfel, cele bifate.
    const [unaId, unaSapt] = String(date.get('una') ?? '').split('|');
    const e = unaId
      ? await programeaza([unaId], unaSapt)
      : await programeaza(date.getAll('comanda').map(String), String(date.get('saptamana') ?? ''));
    redirect(e ? `${aici}&eroare=${encodeURIComponent(e)}` : aici);
  }
  async function muta(date: FormData) {
    'use server';
    await cere(['planificare', 'banda'], 'modifica');
    const unde = String(date.get('saptamana') ?? '');
    if (date.get('scoate')) await scoateDinPlan(String(date.get('comanda')));
    else {
      const e = await programeaza([String(date.get('comanda'))], unde);
      if (e) redirect(`${aici}&eroare=${encodeURIComponent(e)}`);
    }
    redirect(aici);
  }

  return (
    <main className="lat">
      <h1>Producție</h1>
      <FileProductie activ="plan" />
      <p className="slab">Pune PSF-urile și PSC-urile pe săptămâna în care se lucrează. Ce s-a croit se dă pe bandă și oamenii se alocă din fila 2 · Bandă.</p>
      <div className="liste-actiuni perioade">
        <span className="filtre">
          <Link href={adresa(adaugaZile(de, -7 * nr), adaugaZile(pana, -7 * nr))} className="buton">← {nr === 1 ? 'săptămâna dinainte' : `${nr} săpt. înainte`}</Link>
          {PRESETARI.map(([nume, a, b]) => (
            <Link key={nume} href={adresa(a, b)} className={`buton ${a === de && b === pana ? 'activ-buton' : ''}`}>{nume}</Link>
          ))}
          <Link href={adresa(adaugaZile(de, 7 * nr), adaugaZile(pana, 7 * nr))} className="buton">{nr === 1 ? 'săptămâna următoare' : `${nr} săpt. după`} →</Link>
        </span>
      </div>
      <form method="get" className="filtre" key={`${de}${pana}`}>
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
        {inPerioada.length} comenzi · cerut {suma(inPerioada, 'cerut')} · rămas de croit {suma(inPerioada, 'rest_de_croit')}
        {' · '}în depozit {suma(inPerioada, 'intrat')} buc
        {deLucru.length > 0 && <> · de lucru ≈ {oreText(deLucru.reduce((s, c) => s + ramase(c), 0))} din {oreText(capacitate * nr)}{' '}
          <span className="slab">({param.operatori} operatori × {param.orePeZi} h × 5 zile{nr > 1 && ` × ${nr} săptămâni`})</span></>}
        {faraTimp > 0 && <span className="slab"> · {faraTimp} fără timp în nomenclator</span>}
      </p>
      <nav className="faze" aria-label="Ce e planificat și ce a intrat în lucru">
        <Link href={adresa(de, pana, null)} className={`faza ${!faza ? 'activ-faza' : ''}`}>
          <strong>{inPerioada.length}</strong> toate programate <span className="slab">{suma(inPerioada, 'cerut')} buc</span>
        </Link>
        {(Object.keys(FAZE) as Faza[]).map((k) => (
          <Link key={k} href={adresa(de, pana, k)} className={`faza ${k} ${faza === k ? 'activ-faza' : ''}`}>
            <strong>{peFaze[k].length}</strong> {FAZE[k].toLowerCase()} <span className="slab">{suma(peFaze[k], 'cerut')} buc</span>
          </Link>
        ))}
      </nav>

      {peSaptamani.map(({ s, lista }) => {
        const ore = lista.filter((c) => c.stadiu !== 'gata').reduce((t, c) => t + ramase(c), 0);
        return (
          <section key={s}>
            {nr > 1 && (
              <h3>
                {numeSaptamana(s)}{s === curenta && <span className="slab"> · săptămâna asta</span>}
                <span className="slab"> · {lista.length} {lista.length === 1 ? 'comandă' : 'comenzi'} · cerut {suma(lista, 'cerut')} buc{ore > 0 && ` · ≈ ${oreText(ore)} din ${oreText(capacitate)}`}</span>
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
      <p className="slab">PSF-urile și PSC-urile lansate (sunt deja la croit), încă neplanificate. Un clic pe „săpt. asta" sau „săpt. viitoare" pe rând, sau bifează mai multe și alege din calendar orice săptămână.</p>
      {deProgramat.length === 0 ? <p className="slab">Toate comenzile deschise sunt programate.</p> : (
        <form action={pune}>
          <fieldset disabled={!m} className="filtre">
            <span className="slab">Bifează comenzile, apoi alege din calendar o zi din săptămâna de lucru:</span>
            <input type="date" name="saptamana" defaultValue={de} aria-label="O zi din săptămâna de lucru" />
            <button>Pune pe săptămâna ei</button>
          </fieldset>
          <div className="tabel-derulant">
            <table className="centralizator">
              <thead>
                <tr><th /><th>Comandă</th><th>Model</th><th>Termen</th><th className="nr">Cerut</th>
                    <th className="nr">Rămas de croit</th><th className="nr">Croit</th><th>Stadiu</th><th className="nr">Timp</th>{m && <th>Planifică</th>}</tr>
              </thead>
              <tbody>
                {deProgramat.map((c) => (
                  <RandCascada key={c.comanda_id} coloane={m ? 10 : 9} detalii={<Marimi linii={c.linii} />} celule={<>
                    <td><input type="checkbox" name="comanda" value={c.comanda_id} disabled={!m} aria-label={`Programează ${c.numar}`} /></td>
                    <td className="cascada">
                      <Link href={`/necesar/${encodeURIComponent(c.numar)}`}>{c.numar}</Link>{' '}
                      <span className="slab">{c.tip} · {c.brand} · P{c.prioritate}{c.kam && ` · ${c.kam}`}</span>
                    </td>
                    <td>{c.model}</td>
                    <td><Termen data={c.data_ceruta} /></td>
                    <td className="nr">{c.cerut}</td>
                    <td className="nr">{c.rest_de_croit || '—'}</td>
                    <td className="nr">{c.croit || '—'}</td>
                    <td><Stadiu cheie={c.stadiu} nume={STADII_LINIE[c.stadiu]} /></td>
                    <td className="nr slab">{c.ore_om === null ? '—' : oreText(c.ore_om)}</td>
                    {m && (
                      <td>
                        <span className="rapid">
                          <button name="una" value={`${c.comanda_id}|${curenta}`} className="secundar">săpt. asta</button>
                          <button name="una" value={`${c.comanda_id}|${adaugaZile(curenta, 7)}`} className="secundar">săpt. viitoare</button>
                        </span>
                      </td>
                    )}
                  </>} />
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

/** Orele care mai sunt de lucru pe comandă: cât n-a ajuns încă în depozit. */
const ramase = (c: ComandaInPlan) => (c.ore_om ?? 0) * Math.max(0, c.cerut - c.intrat) / (c.cerut || 1);

function TabelSaptamana({ s, lista, loturiPe, transePe, oameni, m, muta }: {
  s: string; lista: ComandaInPlan[]; loturiPe: Map<string, LotDeAlimentat[]>; transePe: Map<string, Transa[]>;
  oameni: Map<string, number>; m: boolean; muta: (date: FormData) => Promise<void>;
}) {
  // Pe faze, în ordinea drumului: ce e planificat și n-a intrat, ce a intrat, ce e gata.
  const grupe = (Object.keys(FAZE) as Faza[]).map((k) => ({ k, randuri: lista.filter((c) => fazaComenzii(c) === k) }))
    .filter((g) => g.randuri.length > 0);
  const coloane = m ? 11 : 10;
  return (
    <div className="tabel-derulant">
      <table className="centralizator">
        <thead>
          <tr>
            <th>Comandă</th><th>Model</th><th>Termen</th><th className="nr">Cerut</th>
            <th className="nr">Rămas de croit</th><th className="nr">Croit, nedat pe bandă</th><th className="nr">În lucru</th>
            <th className="nr">În depozit</th><th>Stadiu</th><th>Pe bandă</th>{m && <th />}
          </tr>
        </thead>
        <tbody>
          {grupe.map((g) => (
            <Fragment key={g.k}>
            <tr className={`grupa-faza ${g.k}`}>
              <td colSpan={coloane}>{FAZE[g.k]} · {g.randuri.length} {g.randuri.length === 1 ? 'comandă' : 'comenzi'} · {g.randuri.reduce((t, c) => t + c.cerut, 0)} buc</td>
            </tr>
          {g.randuri.map((c) => (
            <RandCascada key={c.comanda_id} coloane={coloane} detalii={<Marimi linii={c.linii} />} celule={<>
              <td className="cascada">
                <Link href={`/necesar/${encodeURIComponent(c.numar)}`}>{c.numar}</Link>{' '}
                <span className="slab">{c.tip} · {c.brand} · P{c.prioritate}</span>
                {c.saptamana !== s && c.saptamana && <><br /><span className="insigna galben">rămas din {numeSaptamana(c.saptamana)}</span></>}
              </td>
              <td>{c.model}{c.ore_om !== null && <span className="slab"> · ≈ {oreText(c.ore_om)}</span>}</td>
              <td><Termen data={c.data_ceruta} gata={c.stadiu === 'gata'} /></td>
              <td className="nr">{c.cerut}</td>
              <td className="nr">{c.rest_de_croit || '—'}</td>
              <td className="nr">{Math.max(0, c.croit - c.banda) || '—'}</td>
              <td className="nr">{Math.max(0, c.banda - c.intrat) || '—'}</td>
              <td className="nr">{c.intrat || '—'}</td>
              <td><Stadiu cheie={c.stadiu} nume={STADII_LINIE[c.stadiu]} /></td>
              <td><InLucru c={c} loturi={loturiPe.get(c.numar) ?? []} transe={transePe.get(c.numar) ?? []} oameni={oameni} m={m} /></td>
              {m && (
                <td>
                  <form action={muta} className="muta">
                    <input type="hidden" name="comanda" value={c.comanda_id} />
                    <input type="date" name="saptamana" defaultValue={c.saptamana ?? s} aria-label={`Mută ${c.numar}: o zi din săptămâna nouă`} />
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
function InLucru({ c, loturi, transe, oameni }: {
  c: ComandaInPlan; loturi: LotDeAlimentat[]; transe: Transa[]; oameni: Map<string, number>; m: boolean;
}) {
  const deDat = loturi.reduce((s, l) => s + l.rest, 0);
  const faraOameni = transe.filter((t) => !oameni.get(t.id) && ['alimentat', 'în producție'].includes(t.etapa)).length;
  const cauta = encodeURIComponent(c.numar);
  if (deDat === 0 && transe.length === 0) {
    return <span className="slab">{c.stadiu === 'gata' ? 'gata' : c.rest_de_croit > 0 ? 'se așteaptă croitul' : '—'}</span>;
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

/**
 * O comandă desfăcută: pe fiecare culoare (produs) și mărime — cerut, croit, pe
 * bandă, în depozit și ce a rămas de croit. Mărimile de la cea mai mică la cea mai mare.
 */
function Marimi({ linii }: { linii: LinieInPlan[] }) {
  const marimi = [...new Set(linii.flatMap((l) => l.marimi.map((x) => x.marime)))].sort((a, b) => rangMarime(a) - rangMarime(b));
  const RANDURI: [keyof Omit<LinieInPlan['marimi'][number], 'marime'>, string][] = [
    ['cerut', 'Cerut'], ['rest', 'Rămas de croit'], ['croit', 'Croit'], ['banda', 'Pe bandă'], ['intrat', 'În depozit'],
  ];
  return (
    <div className="tabel-derulant">
      <table className="marimi-comanda">
        <thead>
          <tr><th>Culoare</th><th />{marimi.map((x) => <th key={x}>{x}</th>)}<th>Total</th></tr>
        </thead>
        <tbody>
          {linii.map((l) => RANDURI.map(([k, nume], i) => {
            const total = l.marimi.reduce((t, x) => t + x[k], 0);
            return (
              <tr key={`${l.cod_sku}${k}`} className={`${k === 'cerut' ? 'cerut' : ''} ${i === 0 ? 'prima-culoare' : ''}`}>
                {i === 0 && <td className="culoare" rowSpan={RANDURI.length}>{l.produs} <span className="slab">{l.cod_sku}</span></td>}
                <td className="ce slab">{nume}</td>
                {marimi.map((x) => {
                  const v = l.marimi.find((y) => y.marime === x)?.[k];
                  return <td key={x}>{v ? v : <span className="slab">—</span>}</td>;
                })}
                <td className="total">{total || <span className="slab">—</span>}</td>
              </tr>
            );
          }))}
        </tbody>
      </table>
    </div>
  );
}

function grupa<T>(lista: T[], cheie: (x: T) => string): Map<string, T[]> {
  const pe = new Map<string, T[]>();
  for (const x of lista) pe.set(cheie(x), [...(pe.get(cheie(x)) ?? []), x]);
  return pe;
}
