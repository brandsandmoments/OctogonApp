import { notFound } from 'next/navigation';
import { cost, fisa, pretPeCuloare } from '../../../../lib/fisa';
import { cere } from '../../../../lib/sesiune';
import Tipareste from '../../../../Tipareste';
import './tipar.css';

export const dynamic = 'force-dynamic';

const lei = (n: number) => n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Fișa de produs pe o pagină A4, pentru tipar sau PDF („Salvează ca PDF" din
 * fereastra de tipărire): pozele pe culori, dimensiunile, materiile prime,
 * accesoriile și costul pe bucată.
 */
export default async function FisaTipar({ params }: { params: Promise<{ id: string }> }) {
  await cere(['dezvoltare', 'comenzi']);
  const f = await fisa((await params).id);
  if (!f) notFound();
  const d = f.dezvoltare;
  const prima = d.culori[0] ?? '';

  return (
    <main className="fisa-tipar">
      <Tipareste />
      <h1>{`${d.categorie ? `${d.categorie} ` : ''}${d.model}`.toUpperCase()}</h1>
      <p className="slab">{d.brand} · mărimi {f.marimi.join(' ')}</p>
      <div className="poze-tipar">
        {d.culori.map((c) => {
          const p = f.poze.find((x) => x.culoare === c);
          return (
            <figure key={c}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p ? <img src={`/dezvoltare/poza/${p.id}`} alt={c} /> : <div className="fara-poza" />}
              <figcaption>{c.toUpperCase()}</figcaption>
            </figure>
          );
        })}
      </div>

      {f.masuri.length > 0 && (
        <table>
          <thead><tr><th>Dimensiuni</th>{f.marimi.map((m) => <th key={m}>{m}</th>)}</tr></thead>
          <tbody>
            {f.masuri.map((m) => (
              <tr key={m.id}><td>{m.nume}</td>{f.marimi.map((mr) => <td key={mr}>{m.valori[mr] ?? ''}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}

      {(['materie_prima', 'accesoriu'] as const).map((tip) => {
        const lista = f.componente.filter((c) => c.tip === tip);
        if (!lista.length) return null;
        return (
          <table key={tip}>
            <thead>
              <tr><th>{tip === 'materie_prima' ? 'Materii prime' : 'Accesorii'}</th><th>Material · cod</th><th>Furnizor</th>
                  <th className="nr">Consum / buc</th><th className="nr">Preț</th><th className="nr">Preț / buc</th></tr>
            </thead>
            <tbody>
              {lista.map((c) => {
                const p = pretPeCuloare(c, prima);
                return (
                  <tr key={c.id}>
                    <td>{c.nume} ({c.unitate})</td>
                    <td>{c.material ? `${c.material}${c.cod ? ` · ${c.cod}` : ''}`
                      : c.culori.map((x) => `${x.culoare}: ${x.material ?? x.denumire ?? ''}${x.cod ? ` · ${x.cod}` : ''}`).join('; ') || c.cod}</td>
                    <td>{c.furnizor}</td>
                    <td className="nr">{Number(c.consum)}</td>
                    <td className="nr">{p === null ? '—' : lei(p)}</td>
                    <td className="nr">{p === null ? '—' : lei(Number(c.consum) * p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      })}

      <table>
        <thead><tr><th>Cost pe bucată</th><th className="nr">Materii prime</th><th className="nr">Accesorii</th><th className="nr">Manoperă</th><th className="nr">Total</th></tr></thead>
        <tbody>
          {(d.culori.length ? d.culori : ['—']).map((c) => {
            const x = cost(f, c);
            return (
              <tr key={c}><td>{c}</td><td className="nr">{lei(x.materie)}</td><td className="nr">{lei(x.accesorii)}</td>
                <td className="nr">{lei(x.manopera)}</td><td className="nr"><strong>{lei(x.total)} lei</strong></td></tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
