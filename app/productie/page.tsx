import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Termen } from '../Insigne';
import { cere, poateModifica } from '../lib/sesiune';
import { azi, numarDinFormular, potriveste } from '../lib/format';
import Cauta from '../Cauta';
import { adaugaZile, luni } from '../lib/perioade';
import {
  aduLaUrgenta, cautaComenziDeschise, daInLucruCuloare, planPeSaptamani, scoateUrgenta, STADII_PLAN,
  type ComandaPlan, type CuloarePlan, type StadiuPlan,
} from '../lib/productieComenzi';
import './productie.css';
import FileProductie from './FileProductie';

export const dynamic = 'force-dynamic';

const zi = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', timeZone: 'UTC' });
/** „2 – 6 noiembrie": de luni până vineri. */
const numeSaptamana = (l: string) => {
  const v = adaugaZile(l, 4);
  return l.slice(5, 7) === v.slice(5, 7) ? `${Number(l.slice(8))} – ${zi(v)}` : `${zi(l)} – ${zi(v)}`;
};
const TON: Record<StadiuPlan, string> = { necroit: 'gri', croit: 'albastru', in_lucru: 'violet', iesit: 'galben', terminat: 'verde' };
const culoare = (produs: string, model: string) => {
  const m = new Set(model.toLowerCase().split(/[\s,]+/));
  return produs.split(/\s+/).slice(1).filter((w) => !m.has(w.toLowerCase())).join(' ') || produs;
};
const eData = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

type Cautare = { sapt?: string; de?: string; pana?: string; stadiu?: string; eroare?: string; cauta?: string; deschis?: string; urg?: string; us?: string };

/**
 * Planul pe săptămâni se face singur, după termen: în fiecare săptămână sunt comenzile
 * cu termenul în ea (pe culori), cu stadiul lor — necroit, doar croit, intrat în lucru,
 * ieșit din lucru, terminat. Ce e croit se dă în lucru chiar de aici: „Dă în lucru" pe
 * comandă deschide mărimile și se scrie exact ce intră; ce nu intră rămâne în plan, cu
 * „rămas de intrat în lucru". Ce a rămas nefăcut cu termenul trecut apare în săptămâna
 * de acum, ca întârziat. Peste plan, „Reprioritizare" aduce la urgență o comandă dintr-o
 * altă săptămână (caută după PSF/PSC sau model).
 */
export default async function Productie({ searchParams }: { searchParams: Promise<Cautare> }) {
  await cere(['planificare', 'banda']);
  const m = (await poateModifica('banda')) || (await poateModifica('planificare'));
  const f = await searchParams;
  const curenta = luni(azi());
  let de = eData(f.de) ? luni(f.de!) : eData(f.sapt) ? luni(f.sapt!) : curenta;
  let pana = eData(f.pana) ? luni(f.pana!) : de;
  if (pana < de) [de, pana] = [pana, de];
  const saptamani: string[] = [];
  for (let s = de; s <= pana && saptamani.length < 26; s = adaugaZile(s, 7)) saptamani.push(s);
  pana = saptamani[saptamani.length - 1];
  const nr = saptamani.length;

  const toate = (await planPeSaptamani(de, pana, curenta, luni))
    .filter((c) => potriveste(f.cauta, c.numar, c.model, ...c.culori.map((l) => l.produs)));
  const stadiu = f.stadiu && f.stadiu in STADII_PLAN ? (f.stadiu as StadiuPlan) : null;
  const comenzi = stadiu ? toate.filter((c) => c.stadiu === stadiu) : toate;
  const adresa = (a: string, b: string, st: StadiuPlan | null = stadiu) =>
    (a === b ? `/productie?sapt=${a}` : `/productie?de=${a}&pana=${b}`) + (st ? `&stadiu=${st}` : '') + (f.cauta ? `&cauta=${encodeURIComponent(f.cauta)}` : '');
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
  const buc = (l: ComandaPlan[], k: 'cerut' | 'ramas_de_intrat' | 'de_dat') => l.reduce((s, c) => s + c[k], 0);
  // Reprioritizarea: căutarea comenzilor de adus la urgență în săptămâna `us`.
  const gasite = f.us && f.urg ? await cautaComenziDeschise(f.urg) : [];

  async function urgent(date: FormData) {
    'use server';
    await cere(['planificare', 'banda'], 'modifica');
    const numar = String(date.get('numar'));
    await aduLaUrgenta(String(date.get('comanda')), String(date.get('saptamana')));
    const inapoiLa = String(date.get('inapoi') ?? '/productie');
    redirect(`${inapoiLa}${inapoiLa.includes('?') ? '&' : '?'}deschis=${encodeURIComponent(numar)}#c-${encodeURIComponent(numar)}`);
  }
  async function faraUrgenta(date: FormData) {
    'use server';
    await cere(['planificare', 'banda'], 'modifica');
    await scoateUrgenta(String(date.get('comanda')));
    redirect(String(date.get('inapoi') ?? '/productie'));
  }

  async function da(date: FormData) {
    'use server';
    await cere('banda', 'modifica');
    const linie = String(date.get('linie'));
    const numar = String(date.get('numar'));
    const inapoiLa = String(date.get('inapoi') ?? '/productie');
    const lista = await planPeSaptamani('2000-01-03', '2100-01-04', luni(azi()), luni);
    const l = lista.flatMap((c) => c.culori).find((x) => x.linie_id === linie);
    const cantitati = new Map((l?.marimi ?? []).map((x) => [x.marime_id,
      date.get('tot') ? x.de_dat : numarDinFormular(date.get(`q:${x.marime_id}`)) ?? 0] as [string, number]));
    const e = l ? await daInLucruCuloare(linie, cantitati) : 'Culoarea nu mai are nimic croit de dat în lucru.';
    const sep = inapoiLa.includes('?') ? '&' : '?';
    redirect(`${inapoiLa}${sep}deschis=${encodeURIComponent(numar)}${e ? `&eroare=${encodeURIComponent(e)}` : ''}#c-${encodeURIComponent(numar)}`);
  }

  return (
    <main className="lat">
      <h1>Producție</h1>
      <FileProductie activ="plan" />
      <p className="slab">În fiecare săptămână intră singure comenzile cu termenul în ea. Deschide comanda (sau „Dă în lucru") și scrie exact ce intră în lucru; ce nu intră rămâne aici.</p>
      <div className="liste-actiuni perioade">
        <span className="filtre">
          <Link href={adresa(adaugaZile(de, -7 * nr), adaugaZile(pana, -7 * nr))} className="buton">← {nr === 1 ? 'săptămâna dinainte' : `${nr} săpt. înainte`}</Link>
          {PRESETARI.map(([nume, a, b]) => (
            <Link key={nume} href={adresa(a, b)} className={`buton ${a === de && b === pana ? 'activ-buton' : ''}`}>{nume}</Link>
          ))}
          <Link href={adresa(adaugaZile(de, 7 * nr), adaugaZile(pana, 7 * nr))} className="buton">{nr === 1 ? 'săptămâna următoare' : `${nr} săpt. după`} →</Link>
        </span>
      </div>
      <Cauta valoare={f.cauta} pastreaza={{ sapt: de === pana ? de : undefined, de: de !== pana ? de : undefined, pana: de !== pana ? pana : undefined, stadiu: stadiu ?? undefined }}
             placeholder="caută: PSF/PSC, model sau culoare" />
      <form method="get" className="filtre" key={`${de}${pana}`}>
        {f.cauta && <input type="hidden" name="cauta" value={f.cauta} />}
        <span className="slab">Perioadă aleasă: de la</span>
        <input type="date" name="de" defaultValue={de} aria-label="De la" />
        <span className="slab">până la</span>
        <input type="date" name="pana" defaultValue={adaugaZile(pana, 4)} aria-label="Până la" />
        <button className="buton">Arată perioada</button>
      </form>
      {f.eroare && <p className="eroare">{f.eroare}</p>}

      <h2>
        {nr === 1 ? numeSaptamana(de) : `${zi(de)} – ${zi(adaugaZile(pana, 4))}`}
        {nr === 1 && de === curenta && <span className="slab"> · săptămâna asta</span>}
        <span className="slab"> · {toate.length} comenzi cu termen · {buc(toate, 'cerut')} buc · {buc(toate, 'ramas_de_intrat')} buc rămase de intrat în lucru</span>
      </h2>
      <nav className="faze" aria-label="Stadiul comenzilor">
        <Link href={adresa(de, pana, null)} className={`faza ${!stadiu ? 'activ-faza' : ''}`}><strong>{toate.length}</strong> toate</Link>
        {(Object.keys(STADII_PLAN) as StadiuPlan[]).map((k) => {
          const din = toate.filter((c) => c.stadiu === k);
          return (
            <Link key={k} href={adresa(de, pana, k)} className={`faza stadiu-${k} ${stadiu === k ? 'activ-faza' : ''}`}>
              <strong>{din.length}</strong> {STADII_PLAN[k].toLowerCase()} <span className="slab">{buc(din, 'cerut')} buc</span>
            </Link>
          );
        })}
      </nav>

      {saptamani.map((s) => {
        const lista = comenzi.filter((c) => c.saptamana === s);
        return (
          <section key={s}>
            {nr > 1 && <h3>{numeSaptamana(s)}{s === curenta && <span className="slab"> · săptămâna asta</span>}<span className="slab"> · {lista.length} comenzi · {buc(lista, 'cerut')} buc</span></h3>}
            {m && (
              <details className="reprioritizare" open={f.us === s}>
                <summary><span className="buton">⚡ Reprioritizare{nr > 1 ? ` · ${numeSaptamana(s)}` : ''}</span> <span className="slab">adu la urgență un PSF/PSC în săptămâna asta</span></summary>
                <form method="get" className="filtre">
                  {de === pana ? <input type="hidden" name="sapt" value={de} /> : <><input type="hidden" name="de" value={de} /><input type="hidden" name="pana" value={pana} /></>}
                  <input type="hidden" name="us" value={s} />
                  <input name="urg" type="search" defaultValue={f.us === s ? f.urg ?? '' : ''} placeholder="caută: PSF/PSC sau numele modelului" aria-label="Caută comanda de adus la urgență" autoFocus={f.us === s} />
                  <button>Caută</button>
                </form>
                {f.us === s && f.urg && (gasite.length === 0 ? <p className="slab">Nicio comandă deschisă nu se potrivește.</p> : (
                  <table className="marimi-comanda">
                    <tbody>
                      {gasite.map((g) => {
                        const deja = lista.some((c) => c.comanda_id === g.comanda_id);
                        return (
                          <tr key={g.comanda_id}>
                            <td className="ce"><strong>{g.numar}</strong> <span className="slab">{g.tip} · {g.brand}</span></td>
                            <td className="ce">{g.model}</td>
                            <td className="ce"><Termen data={g.data_ceruta} /></td>
                            <td>{g.cerut} buc</td>
                            <td>
                              {deja ? <span className="slab">e deja în săptămâna asta</span> : (
                                <form action={urgent}>
                                  <input type="hidden" name="comanda" value={g.comanda_id} />
                                  <input type="hidden" name="numar" value={g.numar} />
                                  <input type="hidden" name="saptamana" value={s} />
                                  <input type="hidden" name="inapoi" value={aici} />
                                  <button className="principal">Adu în săptămâna asta</button>
                                </form>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ))}
              </details>
            )}
            {lista.length === 0 ? <p className="slab">Nicio comandă cu termen în săptămâna asta.</p> : (
              <div className="plan-lista">
                <div className="plan-cap"><span /><span>Termen</span><span>Comandă</span><span>Produs · culori</span><span className="nr">Cerut</span>
                  <span className="nr">Croit</span><span className="nr">În lucru</span><span className="nr">În depozit</span><span>Stadiu</span><span /></div>
                {grupePlan(lista, s).map((g) => (
                  <details key={g.cheie} className={`grupa-plan ${g.ton}`} open={g.deschisa || lista.some((c) => c.numar === f.deschis && g.comenzi.includes(c))}>
                    <summary>
                      <strong>{g.nume}</strong>
                      <span className="slab"> · {g.comenzi.length} {g.comenzi.length === 1 ? 'comandă' : 'comenzi'} · {buc(g.comenzi, 'cerut')} buc
                        {buc(g.comenzi, 'ramas_de_intrat') > 0 && ` · ${buc(g.comenzi, 'ramas_de_intrat')} rămase de intrat în lucru`}</span>
                    </summary>
                    {g.comenzi.map((c) => (
                      <ComandaInPlan key={`${c.comanda_id}${s}`} c={c} m={m} deschis={f.deschis === c.numar} da={da} aici={aici} faraUrgenta={faraUrgenta} />
                    ))}
                  </details>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </main>
  );
}

/**
 * Comenzile unei săptămâni, în cascadă după termen: întâi cele aduse la urgență, apoi
 * întârziatele, pe săptămâna termenului lor (de la cea mai veche), apoi cele cu termenul
 * în săptămâna asta. Întârziatele pornesc strânse, ca săptămâna să se citească întâi.
 */
function grupePlan(lista: ComandaPlan[], s: string) {
  const grupe: { cheie: string; nume: string; ton: string; deschisa: boolean; comenzi: ComandaPlan[] }[] = [];
  const urgente = lista.filter((c) => c.urgenta);
  if (urgente.length) grupe.push({ cheie: 'urgente', nume: '⚡ Aduse la urgență', ton: 'urgente', deschisa: true, comenzi: urgente });
  const restul = lista.filter((c) => !c.urgenta);
  const intarziate = new Map<string, ComandaPlan[]>();
  for (const c of restul.filter((x) => luni(x.data_ceruta) < s)) intarziate.set(luni(c.data_ceruta), [...(intarziate.get(luni(c.data_ceruta)) ?? []), c]);
  for (const [l, cs] of [...intarziate].sort(([a], [b]) => a.localeCompare(b))) {
    grupe.push({ cheie: `int-${l}`, nume: `Întârziate · termen ${numeSaptamana(l)}`, ton: 'intarziate', deschisa: false, comenzi: cs });
  }
  const aleSaptamanii = restul.filter((x) => luni(x.data_ceruta) >= s);
  if (aleSaptamanii.length) grupe.push({ cheie: 'aici', nume: `Cu termen în ${numeSaptamana(s)}`, ton: 'aici', deschisa: true, comenzi: aleSaptamanii });
  return grupe;
}

/** O comandă din plan: stadiul, termenul, ce a rămas de intrat în lucru; deschisă, culorile cu „Intră acum". */
function ComandaInPlan({ c, m, deschis, da, aici, faraUrgenta }: {
  c: ComandaPlan; m: boolean; deschis: boolean; da: (d: FormData) => Promise<void>; aici: string; faraUrgenta: (d: FormData) => Promise<void>;
}) {
  return (
    <details id={`c-${c.numar}`} className="comanda-productie" open={deschis}>
      <summary>
        <span className="p-termen"><Termen data={c.data_ceruta} gata={c.stadiu === 'terminat'} /></span>
        <span className="p-comanda"><strong>{c.numar}</strong><span className="slab">{c.tip} · {c.brand} · P{c.prioritate}</span></span>
        <span className="p-produs"><strong>{c.model}</strong><span className="slab">{c.culori.map((l) => `${culoare(l.produs, c.model)} ${l.cerut}`).join(' · ')}</span></span>
        <span className="nr"><strong>{c.cerut}</strong></span>
        <span className={`nr ${c.croit < c.cerut ? 'slab' : ''}`}>{c.croit || '—'}</span>
        <span className="nr">{Math.max(0, c.dat - c.gata) || '—'}</span>
        <span className="nr">{c.depozit || '—'}</span>
        <span className="p-stadiu">
          <span className={`insigna ${TON[c.stadiu]}`}>{STADII_PLAN[c.stadiu]}</span>
          {c.urgenta && <span className="insigna rosu" title="Adusă la urgență în săptămâna asta, peste plan">⚡ urgentă</span>}
          {c.dat > 0 && c.ramas_de_intrat > 0 && <span className="insigna galben">rămas de intrat: {c.ramas_de_intrat}</span>}
        </span>
        <span>{m && c.de_dat > 0 && <span className="buton buton-da">Dă în lucru ({c.de_dat})</span>}</span>
      </summary>
      {c.culori.map((l) => <CuloareInPlan key={l.linie_id} c={c} l={l} m={m} da={da} aici={aici} />)}
      {m && c.urgenta && (
        <form action={faraUrgenta} className="fara-urgenta">
          <input type="hidden" name="comanda" value={c.comanda_id} />
          <input type="hidden" name="inapoi" value={aici} />
          <button className="secundar">Scoate urgența</button> <span className="slab">se întoarce în săptămâna termenului ({c.data_ceruta.slice(5).split('-').reverse().join('.')})</span>
        </form>
      )}
    </details>
  );
}

function CuloareInPlan({ c, l, m, da, aici }: { c: ComandaPlan; l: CuloarePlan; m: boolean; da: (d: FormData) => Promise<void>; aici: string }) {
  return (
    <form action={da} className="culoare-productie">
      <input type="hidden" name="linie" value={l.linie_id} />
      <input type="hidden" name="numar" value={c.numar} />
      <input type="hidden" name="inapoi" value={aici} />
      <div className="tabel-derulant">
        <table className="marimi-comanda">
          <thead>
            <tr>
              <th>{culoare(l.produs, c.model)} <span className={`insigna ${TON[l.stadiu]}`}>{STADII_PLAN[l.stadiu]}</span></th>
              {l.marimi.map((x) => <th key={x.marime_id}>{x.marime}</th>)}<th>Total</th>
            </tr>
          </thead>
          <tbody>
            {([['cerut', 'Cerut'], ['croit', 'Croit'], ['dat', 'Dat în lucru'], ['gata', 'Ieșit din lucru'], ['depozit', 'În depozit']] as const).map(([k, nume]) => (
              <tr key={k} className={k === 'cerut' ? 'cerut' : ''}>
                <td className="ce slab">{nume}</td>
                {l.marimi.map((x) => <td key={x.marime_id}>{x[k] || <span className="slab">—</span>}</td>)}
                <td className="total">{l[k] || <span className="slab">—</span>}</td>
              </tr>
            ))}
            {l.de_dat > 0 && (
              <tr className="intra-acum">
                <td className="ce"><strong>Intră acum</strong></td>
                {l.marimi.map((x) => (
                  <td key={x.marime_id}>
                    {x.de_dat > 0
                      ? <input name={`q:${x.marime_id}`} inputMode="numeric" className="bucati" placeholder={String(x.de_dat)} disabled={!m}
                               aria-label={`${l.produs} ${x.marime}: intră acum, din ${x.de_dat}`} />
                      : <span className="slab">—</span>}
                  </td>
                ))}
                <td className="total">{l.de_dat}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {m && l.de_dat > 0 && (
        <div className="actiuni-culoare">
          <button name="tot" value="1" className="secundar">Tot ({l.de_dat})</button>
          <button className="principal">Dă în lucru</button>
        </div>
      )}
      {l.de_dat === 0 && l.croit < l.cerut && l.stadiu !== 'terminat' && (
        <p className="slab">Mai sunt {l.cerut - l.croit} buc de croit: <Link href={`/croit?vedere=ramas&cauta=${encodeURIComponent(c.numar)}`}>la croit</Link>.</p>
      )}
    </form>
  );
}
