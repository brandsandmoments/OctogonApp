import Link from 'next/link';
import { Fragment } from 'react';
import Tipareste from '../../Tipareste';
import { cantitate } from '../../lib/format';
import { cere } from '../../lib/sesiune';
import { listaCumparaturi, type DeCumparat } from '../../lib/stoc';
import '../../necesar/[comanda]/necesar.css';

export const dynamic = 'force-dynamic';

const lei = (n: number) => n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Lista de cumpărături: ce lipsește din stoc pentru planificările active și
 * comenzile deschise, pe furnizori — materii prime și accesorii. Fără furnizor,
 * materialele se grupează pe tip, cu produsele care le cer, ca să se caute unul.
 * Se tipărește pe A4.
 */
export default async function Cumparaturi() {
  await cere(['materiale', 'necesar', 'planificare']);
  const lista = await listaCumparaturi();
  const peFurnizor = new Map<string, DeCumparat[]>();
  for (const r of lista) {
    const k = r.furnizor?.trim() || '';
    peFurnizor.set(k, [...(peFurnizor.get(k) ?? []), r]);
  }
  const furnizori = [...peFurnizor.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));

  return (
    <main className="necesar lat">
      <p className="nu-tipari"><Link href="/stoc">← Stoc</Link> · <Tipareste /></p>
      <h1>Lista de cumpărături</h1>
      <p className="sumar">
        {lista.length} materiale · {furnizori.filter(Boolean).length} furnizori
        {peFurnizor.has('') && ` · ${peFurnizor.get('')!.length} fără furnizor`} · pentru planificările active și comenzile deschise
      </p>
      {lista.length === 0 && <p>Stocul acoperă tot ce e planificat și cerut.</p>}
      {furnizori.map((f) => {
        const r = peFurnizor.get(f)!;
        const total = r.reduce((s, x) => s + Number(x.de_aprovizionat) * Number(x.pret ?? 0), 0);
        return (
          <section key={f || 'fara'} className="variatie">
            <h2>{f || 'Fără furnizor — de căutat'} {total > 0 && <span className="slab">· aprox. {lei(total)} lei</span>}</h2>
            <table>
              <thead>
                <tr><th>Material</th>{!f && <th>Pentru produsele</th>}<th className="nr">De cumpărat</th>
                    <th className="nr">În stoc</th><th className="nr">Preț</th></tr>
              </thead>
              <tbody>
                {(['materie_prima', 'accesoriu'] as const).map((tip) => {
                  const t = r.filter((x) => x.tip === tip);
                  if (!t.length) return null;
                  return (
                    <Fragment key={tip}>
                      <tr className="tip-rand"><td colSpan={f ? 4 : 5}>{tip === 'materie_prima' ? 'Materie primă' : 'Accesorii'}</td></tr>
                      {t.map((x) => (
                        <tr key={x.id}>
                          <td><Link href={`/stoc/${x.id}`}>{x.denumire}</Link> <span className="slab">{x.cod}{x.familie ? ` · ${x.familie}` : ''}</span></td>
                          {!f && <td className="slab">{x.produse.join(', ') || '—'}</td>}
                          <td className="nr"><strong>{cantitate(x.de_aprovizionat)}</strong> {x.unitate}</td>
                          <td className="nr">{cantitate(x.stoc)}</td>
                          <td className="nr">{x.pret ? lei(Number(x.pret)) : '—'}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </main>
  );
}
