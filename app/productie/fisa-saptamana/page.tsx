import Link from 'next/link';
import Printeaza from '../../croit/fisa/Printeaza';
import { azi } from '../../lib/format';
import { luni, numeSaptamanaLucru } from '../../lib/perioade';
import { planPeSaptamani, STADII_PLAN, type ComandaPlan, type CuloarePlan } from '../../lib/productieComenzi';
import { cere, interogare } from '../../lib/sesiune';
import '../../croit/fisa-saptamana/fisa-saptamana.css';
import './fisa-productie.css';

export const dynamic = 'force-dynamic';

const data = (d: string) => d.split('-').reverse().join('.');
const scurt = (d: string) => d.slice(8, 10) + '.' + d.slice(5, 7);
/** Pe hârtie, 2XL se scrie XXL, ca pe foile obișnuite. */
const eticheta = (m: string) => (m === '2XL' ? 'XXL' : m);
const culoare = (produs: string, model: string) => {
  const m = new Set(model.toLowerCase().split(/[\s,]+/));
  return produs.split(/\s+/).slice(1).filter((w) => !m.has(w.toLowerCase())).join(' ') || produs;
};

/**
 * Planul de producție al unei săptămâni, de printat pe A4 culcat: comenzile cu termenul (sau aduse la
 * urgență) în săptămâna aleasă, plus întârziatele, în săptămâna de acum — pe modele, un rând pe
 * culoare: comanda, termenul, mărimile cerute, cât e croit, în lucru și ieșit, stadiul, și coloane
 * goale pentru cine lucrează și observații.
 */
export default async function FisaProductie({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await cere(['planificare', 'banda']);
  const { s } = await searchParams;
  const curenta = luni(azi());
  const sapt = s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? luni(s) : curenta;
  const [plan, marimi] = await Promise.all([
    planPeSaptamani(sapt, sapt, curenta, luni),
    interogare<{ cod: string }>(`SELECT cod FROM marime ORDER BY ordine`),
  ]);
  const coduri = marimi.map((m) => m.cod);
  // Rândurile: o culoare a unei comenzi, cu comanda ei; pe modele, iar în model pe termen și culoare.
  type Rand = { c: ComandaPlan; l: CuloarePlan };
  const peModel = new Map<string, Rand[]>();
  for (const c of plan) for (const l of c.culori) {
    if (l.stadiu === 'terminat') continue;
    const model = c.model.split(', ').length > 1 ? (c.model.split(', ').find((m) => l.produs.toLowerCase().includes(m.toLowerCase())) ?? c.model) : c.model;
    peModel.set(model, [...(peModel.get(model) ?? []), { c, l }]);
  }
  const modele = [...peModel.entries()]
    .map(([m, r]) => [m, r.sort((a, b) => a.l.data_ceruta.localeCompare(b.l.data_ceruta) || a.l.produs.localeCompare(b.l.produs, 'ro'))] as const)
    .sort(([a], [b]) => a.localeCompare(b, 'ro'));
  const q = (l: CuloarePlan, m: string) => l.marimi.find((x) => x.marime === m)?.cerut ?? 0;
  const randuri = modele.flatMap(([, r]) => r);
  const total = randuri.reduce((t, { l }) => t + l.cerut, 0);

  return (
    <main className="fisa-saptamana fisa-productie">
      <div className="nu-print bara-fisa">
        <Link href={`/productie?sapt=${sapt}`}>← Plan pe săptămâni</Link>
        <Printeaza />
      </div>
      <header>
        <h1>Plan producție · {numeSaptamanaLucru(sapt)}{sapt === curenta && ' (săptămâna asta)'}</h1>
        <p>
          {modele.length} modele · {new Set(randuri.map((r) => r.c.numar)).size} comenzi · <strong>{total} buc</strong>
          {sapt === curenta && ' · cu întârziatele'} · printat {data(azi())}
        </p>
      </header>
      {modele.length === 0 ? <p>Nimic de lucrat în săptămâna asta.</p> : (
        <table>
          <colgroup>
            <col className="c-model" /><col className="c-culoare" /><col className="c-comanda" /><col className="c-termen" />
            {coduri.map((m) => <col key={m} className="c-marime" />)}
            <col className="c-total" /><col className="c-cifra" /><col className="c-cifra" /><col className="c-cifra" />
            <col className="c-stadiu" /><col className="c-cine" /><col className="c-obs" />
          </colgroup>
          <thead>
            <tr>
              <th>Model</th><th>Culoare</th><th>Comandă</th><th>Term.</th>
              {coduri.map((m) => <th key={m}>{eticheta(m)}</th>)}
              <th>Total</th><th>Croit</th><th>În lucru</th><th>Ieșit</th><th>Stadiu</th><th>Cine lucrează</th><th>Observații</th>
            </tr>
          </thead>
          {modele.map(([model, rs]) => (
            <tbody key={model} className="model">
              {rs.map(({ c, l }, i) => (
                <tr key={`${c.numar}${l.linie_id}`}>
                  {i === 0 && <td rowSpan={rs.length + 1} className="model-nume">{model}</td>}
                  <td className="st"><strong>{culoare(l.produs, model)}</strong></td>
                  <td className="st mic">{c.numar}{c.urgenta && ' ⚡'}{c.externalizare && ` · ext. ${c.externalizare}`}</td>
                  <td className={`mic ${l.data_ceruta < sapt ? 'intarziat' : ''}`}>{scurt(l.data_ceruta)}</td>
                  {coduri.map((m) => <td key={m}>{q(l, m) || ''}</td>)}
                  <td><strong>{l.cerut}</strong></td>
                  <td>{l.croit || ''}</td>
                  <td>{Math.max(0, l.dat - l.gata) || ''}</td>
                  <td>{l.gata || ''}</td>
                  <td className="mic">{STADII_PLAN[l.stadiu]}</td>
                  <td className="obs" />
                  <td className="obs" />
                </tr>
              ))}
              <tr className="total-model">
                <td className="st" colSpan={3}>Total {model}</td>
                {coduri.map((m) => <td key={m}>{rs.reduce((t, { l }) => t + q(l, m), 0) || ''}</td>)}
                <td>{rs.reduce((t, { l }) => t + l.cerut, 0)}</td>
                <td>{rs.reduce((t, { l }) => t + l.croit, 0) || ''}</td>
                <td>{rs.reduce((t, { l }) => t + Math.max(0, l.dat - l.gata), 0) || ''}</td>
                <td>{rs.reduce((t, { l }) => t + l.gata, 0) || ''}</td>
                <td /><td className="obs" /><td className="obs" />
              </tr>
            </tbody>
          ))}
        </table>
      )}
      <div className="observatii-generale"><span>Observații</span></div>
    </main>
  );
}
