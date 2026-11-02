import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Stadiu, Termen } from '../Insigne';
import { cere, poateModifica } from '../lib/sesiune';
import { azi } from '../lib/format';
import { adaugaZile, luni } from '../lib/perioade';
import { deAlimentat, transe, type LotDeAlimentat, type Transa } from '../lib/banda';
import { STADII_LINIE } from '../lib/centralizator';
import { comenziInPlan, oameniPeTranse, programeaza, scoateDinPlan, type ComandaInPlan } from '../lib/productie';
import { parametriTimp } from '../lib/parametriTimp';

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
 * Ce a rămas neterminat din săptămânile trecute apare în săptămâna curentă.
 */
export default async function Productie({ searchParams }: { searchParams: Promise<{ sapt?: string; eroare?: string }> }) {
  await cere(['planificare', 'banda']);
  const m = (await poateModifica('planificare')) || (await poateModifica('banda'));
  const f = await searchParams;
  const curenta = luni(azi());
  const sapt = f.sapt && /^\d{4}-\d{2}-\d{2}$/.test(f.sapt) ? luni(f.sapt) : curenta;
  const [comenzi, loturi, peBanda, oameni, param] = await Promise.all([
    comenziInPlan(sapt), deAlimentat(), transe(false), oameniPeTranse(), parametriTimp(),
  ]);
  const inSaptamana = comenzi.filter((c) => c.saptamana === sapt
    || (sapt === curenta && c.saptamana !== null && c.saptamana < curenta && c.stadiu !== 'gata'));
  const deProgramat = comenzi.filter((c) => !c.saptamana && c.stadiu !== 'gata');
  const loturiPe = grupa(loturi, (l) => l.comanda);
  const transePe = grupa(peBanda, (t) => t.comanda);

  const deLucru = inSaptamana.filter((c) => c.stadiu !== 'gata');
  // Ce mai e de lucru: orele comenzii, cât n-a ajuns încă în depozit.
  const incarcare = deLucru.reduce((s, c) => s + (c.ore_om ?? 0) * Math.max(0, c.cerut - c.intrat) / (c.cerut || 1), 0);
  const capacitate = param.operatori * param.orePeZi * 5;
  const faraTimp = deLucru.filter((c) => c.ore_om === null).length;
  const suma = (lista: ComandaInPlan[], k: 'cerut' | 'rest_de_croit' | 'intrat') => lista.reduce((s, c) => s + c[k], 0);
  const saptamaniDeAles = [0, 1, 2, 3, 4].map((i) => adaugaZile(curenta, i * 7));
  if (!saptamaniDeAles.includes(sapt)) saptamaniDeAles.unshift(sapt);
  const aici = `/productie?sapt=${sapt}`;

  async function pune(date: FormData) {
    'use server';
    await cere(['planificare', 'banda'], 'modifica');
    const e = await programeaza(date.getAll('comanda').map(String), String(date.get('saptamana') ?? ''));
    redirect(e ? `${aici}&eroare=${encodeURIComponent(e)}` : aici);
  }
  async function scoate(date: FormData) {
    'use server';
    await cere(['planificare', 'banda'], 'modifica');
    await scoateDinPlan(String(date.get('comanda')));
    redirect(aici);
  }

  return (
    <main className="lat">
      <h1>Producție</h1>
      <nav className="file">
        <Link href={`/productie?sapt=${adaugaZile(sapt, -7)}`}>← săptămâna trecută</Link>
        <Link href="/productie" className={sapt === curenta ? 'activ' : ''}>Săptămâna asta</Link>
        <Link href={`/productie?sapt=${adaugaZile(sapt, 7)}`}>săptămâna viitoare →</Link>
      </nav>
      {f.eroare && <p className="eroare">{f.eroare}</p>}

      <h2>{numeSaptamana(sapt)}{sapt === curenta && <span className="slab"> · săptămâna asta</span>}</h2>
      <p className="sumar">
        {inSaptamana.length} comenzi · cerut {suma(inSaptamana, 'cerut')} · rămas de croit {suma(inSaptamana, 'rest_de_croit')}
        {' · '}în depozit {suma(inSaptamana, 'intrat')} buc
        {deLucru.length > 0 && <> · de lucru ≈ {oreText(incarcare)} din {oreText(capacitate)}{' '}
          <span className="slab">({param.operatori} operatori × {param.orePeZi} h × 5 zile)</span></>}
        {faraTimp > 0 && <span className="slab"> · {faraTimp} fără timp în nomenclator</span>}
      </p>
      {incarcare > capacitate && <p className="eroare">Săptămâna are mai mult de lucru decât încape cu {param.operatori} operatori: mută ceva pe săptămâna viitoare sau alocă mai mulți oameni.</p>}

      {inSaptamana.length === 0 ? <p className="slab">Nimic programat. Pune comenzi din „De programat", mai jos.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead>
              <tr>
                <th>Comandă</th><th>Model</th><th>Termen</th><th className="nr">Cerut</th>
                <th className="nr">Rămas de croit</th><th className="nr">Croit, nedat pe bandă</th><th className="nr">În lucru</th>
                <th className="nr">În depozit</th><th>Stadiu</th><th>Intră în lucru · cine lucrează</th>{m && <th />}
              </tr>
            </thead>
            <tbody>
              {inSaptamana.map((c) => (
                <tr key={c.comanda_id}>
                  <td>
                    <Link href={`/necesar/${encodeURIComponent(c.numar)}`}>{c.numar}</Link>{' '}
                    <span className="slab">{c.tip} · {c.brand} · P{c.prioritate}</span>
                    {c.saptamana !== sapt && c.saptamana && <><br /><span className="insigna galben">rămas din {numeSaptamana(c.saptamana)}</span></>}
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
                      <form action={scoate}>
                        <input type="hidden" name="comanda" value={c.comanda_id} />
                        <button className="secundar" title="Scoate din săptămână: trece înapoi la De programat">Scoate</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>De programat</h2>
      <p className="slab">PSF-urile și PSC-urile lansate (sunt deja la croit), fără săptămână. Bifează-le și alege săptămâna în care se lucrează.</p>
      {deProgramat.length === 0 ? <p className="slab">Toate comenzile deschise sunt programate.</p> : (
        <form action={pune}>
          <fieldset disabled={!m} className="filtre">
            <select name="saptamana" defaultValue={sapt} aria-label="Săptămâna">
              {saptamaniDeAles.map((s) => <option key={s} value={s}>{numeSaptamana(s)}{s === curenta ? ' · asta' : ''}</option>)}
            </select>
            <button>Pune pe săptămână</button>
          </fieldset>
          <div className="tabel-derulant">
            <table className="centralizator">
              <thead>
                <tr><th /><th>Comandă</th><th>Model</th><th>Termen</th><th className="nr">Cerut</th>
                    <th className="nr">Rămas de croit</th><th className="nr">Croit</th><th>Stadiu</th><th className="nr">Timp</th></tr>
              </thead>
              <tbody>
                {deProgramat.map((c) => (
                  <tr key={c.comanda_id}>
                    <td><input type="checkbox" name="comanda" value={c.comanda_id} disabled={!m} aria-label={`Programează ${c.numar}`} /></td>
                    <td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </form>
      )}
      <p className="slab">
        Toate tranșele de pe bandă: <Link href="/banda?vedere=pe_banda">în lucru</Link> · <Link href="/banda?vedere=predate">terminate</Link>.
      </p>
    </main>
  );
}

/**
 * Ce s-a croit și așteaptă banda (Intră în lucru → tranșa nouă, cu bucățile exacte),
 * apoi tranșele de pe bandă, cu câți oameni sunt alocați — un clic și se alocă.
 */
function InLucru({ c, loturi, transe, oameni, m }: {
  c: ComandaInPlan; loturi: LotDeAlimentat[]; transe: Transa[]; oameni: Map<string, number>; m: boolean;
}) {
  const scurt = (cod: string) => cod.slice(c.numar.length + 1);
  if (loturi.length === 0 && transe.length === 0) {
    return <span className="slab">{c.stadiu === 'gata' ? 'gata' : c.rest_de_croit > 0 ? 'se așteaptă croitul' : '—'}</span>;
  }
  return (
    <>
      {loturi.map((l) => (
        <div key={l.lot_id}>
          {m ? <Link href={`/banda/alimenteaza?lot=${l.lot_id}`}><strong>Intră în lucru</strong></Link> : <strong>De dat pe bandă</strong>}
          {' '}<span className="slab">{scurt(l.cod)} · {l.rest} buc ({l.marimi.map((x) => `${x.marime} ${x.rest}`).join(', ')})</span>
        </div>
      ))}
      {transe.map((t) => {
        const n = oameni.get(t.id) ?? 0;
        return (
          <div key={t.id}>
            <Link href={`/banda/${t.id}`}>{scurt(t.cod)}</Link>{' '}
            <span className="slab">{t.bucati} buc · {t.etapa}{t.eta && ` · gata ≈ ${t.eta.slice(5).split('-').reverse().join('.')}`}</span>{' '}
            {n > 0 ? <span className="insigna verde">{n} {n === 1 ? 'om' : 'oameni'}</span>
              : ['alimentat', 'în producție'].includes(t.etapa) && <Link href={`/banda/${t.id}`} className="insigna galben">alocă oamenii</Link>}
          </div>
        );
      })}
    </>
  );
}

function grupa<T>(lista: T[], cheie: (x: T) => string): Map<string, T[]> {
  const pe = new Map<string, T[]>();
  for (const x of lista) pe.set(cheie(x), [...(pe.get(cheie(x)) ?? []), x]);
  return pe;
}
