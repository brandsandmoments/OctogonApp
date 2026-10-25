import Link from 'next/link';
import { redirect } from 'next/navigation';
import { nomenclatoareComanda } from '../lib/comenzi';
import { adaugaModel, modele } from '../lib/retete';
import '../formulare.css';

export const dynamic = 'force-dynamic';

async function adauga(date: FormData) {
  'use server';
  const s = (k: string) => String(date.get(k) ?? '');
  const eroare = await adaugaModel({ brandId: s('brand'), cod: s('cod'), denumire: s('denumire') });
  redirect(eroare ? `/modele?eroare=${encodeURIComponent(eroare)}` : '/modele');
}

/**
 * Modelele și starea rețetei lor. „Nealocate" numără perechile produs ×
 * componentă fără material: cât timp nu e zero, necesarul acelor produse e incomplet.
 */
export default async function Modele({ searchParams }: { searchParams: Promise<{ eroare?: string }> }) {
  const [{ eroare }, lista, { branduri }] = await Promise.all([searchParams, modele(), nomenclatoareComanda()]);

  return (
    <main className="formular">
      <h1>Modele și rețete</h1>

      <form action={adauga} className="antet-comanda">
        <label>
          <span>Brand</span>
          <select name="brand" defaultValue="" required>
            <option value="">—</option>
            {branduri.map((b) => <option key={b.id} value={b.id}>{b.nume}</option>)}
          </select>
        </label>
        <label><span>Cod</span><input name="cod" placeholder="echo" required /></label>
        <label><span>Denumire</span><input name="denumire" placeholder="Trening Echo" required /></label>
        <div className="actiuni"><button className="principal">Adaugă model</button></div>
      </form>
      {eroare && <p className="eroare">{eroare}</p>}

      <table>
        <thead>
          <tr>
            <th>Model</th><th>Brand</th>
            <th className="nr">Culori</th><th className="nr">Componente</th><th className="nr">Nealocate</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((m) => (
            <tr key={m.id}>
              <td><Link href={`/modele/${m.id}`}>{m.denumire}</Link> <span className="slab">{m.cod}</span></td>
              <td>{m.brand}</td>
              <td className="nr">{m.produse}</td>
              <td className="nr">{m.componente || <span className="lipsa">fără rețetă</span>}</td>
              <td className="nr">{m.nealocate ? <span className="lipsa">{m.nealocate}</span> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
