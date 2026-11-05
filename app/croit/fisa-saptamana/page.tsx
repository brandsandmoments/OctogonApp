import Link from 'next/link';
import { ramasDeCroit, saptamanaDeCroit, type RamasDeCroit } from '../../lib/croitTaiere';
import { azi } from '../../lib/format';
import { luni, numeSaptamanaLucru } from '../../lib/perioade';
import { cere, interogare } from '../../lib/sesiune';
import Printeaza from '../fisa/Printeaza';
import './fisa-saptamana.css';

export const dynamic = 'force-dynamic';

const data = (d: string) => d.split('-').reverse().join('.');
/** Pe hârtie, 2XL se scrie XXL, ca pe foile de croit obișnuite. */
const eticheta = (m: string) => (m === '2XL' ? 'XXL' : m);
/** Culoarea din numele produsului: fără felul hainei și fără model („Rochie Valerie Negru" → „Negru"). */
const culoare = (produs: string, model: string) => {
  const m = new Set(model.toLowerCase().split(/\s+/));
  return produs.split(/\s+/).slice(1).filter((w) => !m.has(w.toLowerCase())).join(' ') || produs;
};

/**
 * Ce e de croit într-o săptămână (aceeași împărțire ca în Producție → Plan pe săptămâni), de printat
 * pe A4 culcat: pe modele, un rând pe culoare (cu comanda), mărimile XXS–XXL, totalul și o coloană
 * lată de observații, de scris de mână la croit.
 */
export default async function FisaSaptamana({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await cere('croit');
  const { s } = await searchParams;
  const curenta = luni(azi());
  const sapt = s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? luni(s) : curenta;
  const [toate, marimi] = await Promise.all([
    ramasDeCroit(),
    interogare<{ cod: string }>(`SELECT cod FROM marime ORDER BY ordine`),
  ]);
  const lista = toate.filter((r) => r.disponibil > 0 && saptamanaDeCroit(r, curenta).saptamana === sapt);
  const peModel = new Map<string, RamasDeCroit[]>();
  for (const r of lista) peModel.set(r.model_cheie, [...(peModel.get(r.model_cheie) ?? []), r]);
  const modele = [...peModel.values()]
    .map((v) => [...v].sort((a, b) => a.produs.localeCompare(b.produs, 'ro') || a.cod.localeCompare(b.cod)))
    .sort((a, b) => a[0].model.localeCompare(b[0].model, 'ro'));
  const coduri = marimi.map((m) => m.cod);
  const q = (r: RamasDeCroit, m: string) => r.marimi.find((x) => x.marime === m)?.disponibil ?? 0;
  const total = lista.reduce((t, r) => t + r.disponibil, 0);

  return (
    <main className="fisa-saptamana">
      <div className="nu-print bara-fisa">
        <Link href="/croit?vedere=ramas">← Rămas de croit</Link>
        <Printeaza />
      </div>
      <header>
        <h1>De croit · {numeSaptamanaLucru(sapt)}{sapt === curenta && ' (săptămâna asta)'}</h1>
        <p>{modele.length} modele · {lista.length} comenzi · <strong>{total} buc</strong> · printat {data(azi())}</p>
      </header>
      {modele.length === 0 ? <p>Nimic de croit în săptămâna asta.</p> : (
        <table>
          <colgroup>
            <col className="c-model" /><col className="c-culoare" /><col className="c-comanda" />
            {coduri.map((m) => <col key={m} className="c-marime" />)}
            <col className="c-total" /><col className="c-obs" />
          </colgroup>
          <thead>
            <tr><th>Model</th><th>Culoare</th><th>Comandă</th>{coduri.map((m) => <th key={m}>{eticheta(m)}</th>)}<th>Total</th><th>Observații</th></tr>
          </thead>
          {modele.map((randuri) => (
            <tbody key={randuri[0].model_cheie} className="model">
              {randuri.map((r, i) => (
                <tr key={r.planificare_id}>
                  {i === 0 && <td rowSpan={randuri.length + 1} className="model-nume">{randuri[0].model}</td>}
                  <td className="st"><strong>{culoare(r.produs, r.model)}</strong></td>
                  <td className="st mic">{r.comanda}{saptamanaDeCroit(r, curenta).intarziata && ' · întârz.'}</td>
                  {coduri.map((m) => <td key={m}>{q(r, m) || ''}</td>)}
                  <td><strong>{r.disponibil}</strong></td>
                  <td className="obs" />
                </tr>
              ))}
              <tr className="total-model">
                <td className="st" colSpan={2}>Total {randuri[0].model}</td>
                {coduri.map((m) => <td key={m}>{randuri.reduce((t, r) => t + q(r, m), 0) || ''}</td>)}
                <td>{randuri.reduce((t, r) => t + r.disponibil, 0)}</td>
                <td className="obs" />
              </tr>
            </tbody>
          ))}
        </table>
      )}
      <div className="observatii-generale"><span>Observații</span></div>
    </main>
  );
}
