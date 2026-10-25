import Link from 'next/link';
import { redirect } from 'next/navigation';
import { deschideInventar, inventare } from '../lib/stoc';
import '../formulare.css';

export const dynamic = 'force-dynamic';

async function deschide(date: FormData) {
  'use server';
  const id = await deschideInventar(String(date.get('descriere') ?? ''));
  redirect(`/inventar/${id}`);
}

/** Inventarele: deschise (se numără) și închise (diferențele au intrat în fișa de magazie). */
export default async function Inventare() {
  const lista = await inventare();
  return (
    <main className="formular">
      <p className="slab"><Link href="/stoc">← Stoc</Link></p>
      <h1>Inventar</h1>

      <form action={deschide} className="antet-comanda">
        <label className="lat">
          <span>Inventar nou</span>
          <input name="descriere" placeholder="ex: inventar complet octombrie, doar stofele" />
        </label>
        <div className="actiuni"><button className="principal">Deschide inventar</button></div>
      </form>

      <table>
        <thead><tr><th>Data</th><th>Descriere</th><th>Stare</th><th className="nr">Numărate</th><th className="nr">Diferențe</th></tr></thead>
        <tbody>
          {lista.map((i) => (
            <tr key={i.id}>
              <td><Link href={`/inventar/${i.id}`}>{i.data}</Link></td>
              <td>{i.descriere ?? <span className="slab">—</span>}</td>
              <td>{i.inchis ? 'închis' : <strong>deschis</strong>}</td>
              <td className="nr">{i.linii}</td>
              <td className="nr">{i.inchis ? i.diferente : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
