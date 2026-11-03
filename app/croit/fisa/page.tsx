import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fisaCroit, type Fisa, type RandNecesar } from '../../lib/fisaCroit';
import { azi } from '../../lib/format';
import { cere } from '../../lib/sesiune';
import Printeaza from './Printeaza';
import './fisa.css';

export const dynamic = 'force-dynamic';

const nr = (x: number) => x.toLocaleString('ro-RO', { maximumFractionDigits: 2 });
const data = (d: string) => d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4);

/**
 * Foaia de croit, de printat pe A4: comanda de croit (culori × mărimi) și necesarul de
 * materiale din rețetă — întâi ce se întinde și se taie (stofă, căptușeală…), cu materialul
 * fiecărei culori, apoi accesoriile; jos, loc de scris de mână metrajul pe balot, cine a
 * întins și cine a tăiat, observațiile. Din „Rămas de croit" (?pl=…) sau dintr-o taiere (?taiere=…).
 */
export default async function FisaCroit({ searchParams }: { searchParams: Promise<{ pl?: string | string[]; taiere?: string }> }) {
  await cere('croit');
  const f = await searchParams;
  const pl = (Array.isArray(f.pl) ? f.pl : f.pl ? [f.pl] : []).filter(Boolean);
  const fisa = f.taiere ? await fisaCroit({ taiere: f.taiere }) : pl.length ? await fisaCroit({ planificari: pl }) : null;
  if (!fisa) notFound();
  const inapoi = f.taiere ? `/croit/taiere/${f.taiere}` : '/croit?vedere=ramas';
  const termen = fisa.randuri.map((r) => r.data_ceruta).sort()[0];
  const prime = fisa.necesar.filter((n) => n.tip === 'materie_prima');
  const accesorii = fisa.necesar.filter((n) => n.tip === 'accesoriu');
  return (
    <main className="fisa-croit">
      <div className="nu-print bara-fisa">
        <Link href={inapoi}>← Înapoi</Link>
        <Printeaza />
      </div>
      <header>
        <h1>Comandă de croit · {fisa.model}</h1>
        <p>
          {fisa.brand} · {[...new Set(fisa.randuri.map((r) => r.comanda))].join(', ')}
          {fisa.taiere && <> · taierea <strong>{fisa.taiere}</strong></>}
          {' · '}termen <strong>{data(termen)}</strong> · printat {data(azi())}
        </p>
      </header>

      <table className="fisa-tabel">
        <thead>
          <tr><th className="st">Culoare</th><th className="st">Comandă</th>{fisa.marimi.map((m) => <th key={m}>{m}</th>)}<th>Total</th></tr>
        </thead>
        <tbody>
          {fisa.randuri.map((r) => (
            <tr key={`${r.comanda}${r.produs_id}`}>
              <td className="st"><strong>{r.culoare}</strong></td>
              <td className="st mic">{r.comanda}</td>
              {fisa.marimi.map((m) => <td key={m}>{r.marimi.get(m) || ''}</td>)}
              <td><strong>{r.total}</strong></td>
            </tr>
          ))}
          <tr className="total">
            <td className="st" colSpan={2}>Total</td>
            {fisa.marimi.map((m) => <td key={m}>{fisa.randuri.reduce((s, r) => s + (r.marimi.get(m) ?? 0), 0) || ''}</td>)}
            <td>{fisa.randuri.reduce((s, r) => s + r.total, 0)}</td>
          </tr>
        </tbody>
      </table>

      <h2>Necesar de întins și tăiat</h2>
      <Necesar fisa={fisa} randuri={prime} gol="Rețeta modelului n-are materii prime: scrie de mână ce se întinde." />
      {accesorii.length > 0 && <>
        <h2>Accesorii</h2>
        <Necesar fisa={fisa} randuri={accesorii} mic />
      </>}
      {fisa.fara_reteta.length > 0 && (
        <p className="atentie">Fără rețetă: {fisa.fara_reteta.join(', ')} — necesarul se completează în Modele și rețete (sau de mână, aici).</p>
      )}

      <h2>De completat la croit</h2>
      <table className="fisa-tabel de-scris">
        <thead><tr><th className="st">Culoare</th><th className="st">Metraj / balot</th><th className="st">Lățime</th><th className="st">Întins de</th><th className="st">Tăiat de</th><th className="st">Data</th></tr></thead>
        <tbody>
          {[...new Set(fisa.randuri.map((r) => r.culoare))].map((c) => (
            <tr key={c}><td className="st"><strong>{c}</strong></td><td /><td /><td /><td /><td /></tr>
          ))}
        </tbody>
      </table>
      <div className="observatii"><span>Observații</span></div>
    </main>
  );
}

/** Necesarul pe componente (rânduri) și culori (coloane): cantitatea și materialul culorii. */
function Necesar({ fisa, randuri, gol, mic = false }: { fisa: Fisa; randuri: RandNecesar[]; gol?: string; mic?: boolean }) {
  if (!randuri.length) return gol ? <p className="slab">{gol}</p> : null;
  // O coloană pe culoare (produs), în ordinea din comanda de croit.
  const culori = [...new Map(fisa.randuri.map((r) => [r.produs_id, r.culoare])).entries()];
  return (
    <table className={`fisa-tabel necesar ${mic ? 'mic' : ''}`}>
      <thead>
        <tr><th className="st">Material</th><th>Pe bucată</th>{culori.map(([id, c]) => <th key={id}>{c}</th>)}<th>Total</th></tr>
      </thead>
      <tbody>
        {randuri.map((n) => {
          const total = culori.reduce((s, [id]) => s + (n.pe.get(id)?.cantitate ?? 0), 0);
          return (
            <tr key={`${n.tip}${n.componenta}${n.unitate}`}>
              <td className="st"><strong>{n.componenta}</strong></td>
              <td className="mic">{nr(n.consum)} {n.unitate}</td>
              {culori.map(([id]) => {
                const x = n.pe.get(id);
                return (
                  <td key={id}>
                    {x ? <><strong>{nr(x.cantitate)}</strong> {n.unitate}{!mic && <span className="material">{x.material}</span>}</> : <span className="slab">—</span>}
                  </td>
                );
              })}
              <td><strong>{nr(Math.round(total * 100) / 100)}</strong> {n.unitate}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
