import { redirect } from 'next/navigation';
import { adaugaMaterial, culori, materiale, UNITATI } from '../lib/retete';
import '../formulare.css';

export const dynamic = 'force-dynamic';

const TIP = { materie_prima: 'Materie primă', accesoriu: 'Accesoriu' } as const;

async function adauga(date: FormData) {
  'use server';
  const s = (k: string) => String(date.get(k) ?? '');
  const eroare = await adaugaMaterial({
    tip: s('tip'), cod: s('cod'), denumire: s('denumire'),
    culoareId: s('culoare'), unitate: s('unitate'), furnizor: s('furnizor'),
  });
  redirect(eroare ? `/materiale?eroare=${encodeURIComponent(eroare)}` : '/materiale');
}

/** Nomenclatorul de materiale: stofe, căptușeli, fermoare, nasturi, etichete. */
export default async function Materiale({ searchParams }: { searchParams: Promise<{ eroare?: string }> }) {
  const [{ eroare }, lista, cul] = await Promise.all([searchParams, materiale(), culori()]);

  return (
    <main className="formular">
      <h1>Materiale</h1>
      <p className="sumar">
        {lista.filter((m) => m.tip === 'materie_prima').length} materii prime ·{' '}
        {lista.filter((m) => m.tip === 'accesoriu').length} accesorii
      </p>

      <form action={adauga} className="antet-comanda">
        <label>
          <span>Tip</span>
          <select name="tip" defaultValue="materie_prima">
            <option value="materie_prima">Materie primă</option>
            <option value="accesoriu">Accesoriu</option>
          </select>
        </label>
        <label><span>Cod</span><input name="cod" placeholder="JRS-280-NEG" required /></label>
        <label><span>Denumire</span><input name="denumire" placeholder="Jerseu bumbac 280g" required /></label>
        <label>
          <span>Culoare</span>
          <select name="culoare" defaultValue="">
            <option value="">—</option>
            {cul.map((c) => <option key={c.id} value={c.id}>{c.nume}</option>)}
          </select>
        </label>
        <label>
          <span>Unitate</span>
          <select name="unitate" defaultValue="m">
            {UNITATI.map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
        <label><span>Furnizor</span><input name="furnizor" /></label>
        <div className="actiuni"><button className="principal">Adaugă</button></div>
      </form>
      {eroare && <p className="eroare">{eroare}</p>}

      <table>
        <thead>
          <tr><th>Tip</th><th>Cod</th><th>Denumire</th><th>Culoare</th><th>U.M.</th><th>Furnizor</th></tr>
        </thead>
        <tbody>
          {lista.map((m) => (
            <tr key={m.id}>
              <td className="slab">{TIP[m.tip]}</td>
              <td>{m.cod}</td>
              <td>{m.denumire}</td>
              <td>{m.culoare ?? '—'}</td>
              <td>{m.unitate}</td>
              <td className="slab">{m.furnizor ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
