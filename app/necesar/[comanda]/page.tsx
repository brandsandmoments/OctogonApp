import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cantitate } from '../../lib/format';
import { necesarComanda, type Gol, type RandNecesar } from '../../lib/necesar';

export const dynamic = 'force-dynamic';

const PROBLEME: Record<Gol['problema'], string> = {
  fara_model: 'produsul nu e legat de un model',
  fara_reteta: 'modelul nu are rețetă',
  material_nealocat: 'material nealocat',
};

function Tabel({ titlu, randuri }: { titlu: string; randuri: RandNecesar[] }) {
  if (randuri.length === 0) return null;
  return (
    <>
      <h2>{titlu}</h2>
      <table>
        <thead>
          <tr>
            <th>Material</th>
            <th>Pentru</th>
            <th className="nr">Necesar</th>
            <th className="nr">Cu pierderi</th>
            <th className="nr">Disponibil</th>
          </tr>
        </thead>
        <tbody>
          {randuri.map((r) => (
            <tr key={r.material_id}>
              <td>
                {r.denumire}
                <br />
                <span className="slab">{r.cod}{r.culoare && ` · ${r.culoare}`}</span>
              </td>
              <td className="slab">{r.produse.join(', ')}</td>
              <td className="nr"><strong>{cantitate(r.necesar)}</strong> {r.unitate}</td>
              <td className="nr">{cantitate(r.cu_pierderi)}</td>
              {/* Disponibilul e al întregului depozit, nu al comenzii: alte comenzi îl pot cere și ele. */}
              <td className={`nr ${Number(r.disponibil) < Number(r.cu_pierderi) ? 'lipsa' : ''}`}>
                {cantitate(r.disponibil)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default async function NecesarPagina({ params }: { params: Promise<{ comanda: string }> }) {
  const { comanda } = await params;
  const n = await necesarComanda(decodeURIComponent(comanda));
  if (!n) notFound();
  const { antet, randuri, goluri } = n;

  return (
    <main>
      <h1>Necesar {antet.numar}</h1>
      <p className="sumar">
        {antet.tip} · {antet.brand} · lansare {antet.data_lansare} · {antet.stare} · {antet.bucati} buc
        {' · '}<Link href={`/etichete/${encodeURIComponent(antet.numar)}`}>etichete</Link>
      </p>

      {goluri.length > 0 && (
        <section className="goluri">
          <h2>Necesarul nu e complet</h2>
          <p className="slab">Rândurile de mai jos nu intră în totaluri până nu se completează rețeta.</p>
          <ul>
            {goluri.map((g, i) => (
              <li key={i}>
                <strong>{g.produs}</strong> <span className="slab">{g.cod_sku} · {g.bucati} buc</span>
                {' — '}
                {g.componenta ? `${g.componenta}: ` : ''}
                <span className="lipsa">{PROBLEME[g.problema]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Tabel titlu="Materie primă" randuri={randuri.filter((r) => r.tip === 'materie_prima')} />
      <Tabel titlu="Accesorii" randuri={randuri.filter((r) => r.tip === 'accesoriu')} />

      {randuri.length === 0 && goluri.length === 0 && <p>Comanda nu are cantități.</p>}
    </main>
  );
}
