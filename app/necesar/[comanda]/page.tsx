import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cantitate } from '../../lib/format';
import { necesarComanda, type Gol, type RandNecesar, type Variatie } from '../../lib/necesar';
import { cere, poateModifica } from '../../lib/sesiune';
import Tipareste from '../../Tipareste';
import './necesar.css';

export const dynamic = 'force-dynamic';

const PROBLEME: Record<Gol['problema'], string> = {
  fara_model: 'produsul nu e legat de un model',
  fara_reteta: 'modelul nu are rețetă',
  material_nealocat: 'material nealocat',
};

/** O variație (model × culoare): materia primă și accesoriile ei, cu consumul pe bucată și necesarul. */
function PeVariatie({ v }: { v: Variatie }) {
  return (
    <section className="variatie">
      <h2>{v.produs} <span className="slab">{v.cod_sku} · {v.bucati} buc</span></h2>
      <table>
        <thead>
          <tr><th>Componentă</th><th>Material</th><th className="nr">Consum / buc</th><th className="nr">Necesar</th><th className="nr">Disponibil</th></tr>
        </thead>
        <tbody>
          {(['materie_prima', 'accesoriu'] as const).map((tip) => {
            const r = v.randuri.filter((x) => x.tip === tip);
            if (r.length === 0) return null;
            return [
              <tr key={tip} className="tip-rand"><td colSpan={5}>{tip === 'materie_prima' ? 'Materie primă' : 'Accesorii'}</td></tr>,
              ...r.map((x) => (
                <tr key={`${tip}${x.componenta}`}>
                  <td>{x.componenta}</td>
                  <td>{x.denumire} <span className="slab">{x.cod}</span></td>
                  <td className="nr">{cantitate(x.consum)} {x.unitate}</td>
                  <td className="nr"><strong>{cantitate(x.necesar)}</strong> {x.unitate}</td>
                  <td className={`nr ${Number(x.disponibil) < Number(x.necesar) ? 'lipsa' : ''}`}>{cantitate(x.disponibil)}</td>
                </tr>
              )),
            ];
          })}
        </tbody>
      </table>
    </section>
  );
}

function Total({ titlu, randuri }: { titlu: string; randuri: RandNecesar[] }) {
  if (randuri.length === 0) return null;
  return (
    <>
      <h3>{titlu}</h3>
      <table>
        <thead><tr><th>Material</th><th>Pentru</th><th className="nr">Necesar</th><th className="nr">Disponibil</th></tr></thead>
        <tbody>
          {randuri.map((r) => (
            <tr key={r.material_id}>
              <td>{r.denumire} <span className="slab">{r.cod}</span></td>
              <td className="slab">{r.produse.join(', ')}</td>
              <td className="nr"><strong>{cantitate(r.necesar)}</strong> {r.unitate}</td>
              {/* Disponibilul e al întregului depozit, nu al comenzii: alte comenzi îl pot cere și ele. */}
              <td className={`nr ${Number(r.disponibil) < Number(r.necesar) ? 'lipsa' : ''}`}>{cantitate(r.disponibil)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * Necesarul unei comenzi, pe fiecare variație (culoare): materia primă și
 * accesoriile ei, cu consumul pe bucată și necesarul; apoi totalul pe material,
 * pentru aprovizionare. Se tipărește pe A4.
 */
export default async function NecesarPagina({ params }: { params: Promise<{ comanda: string }> }) {
  await cere(['necesar', 'comenzi', 'planificare']);
  const etichete = (await poateModifica('receptie')) || (await poateModifica('planificare'));
  const { comanda } = await params;
  const n = await necesarComanda(decodeURIComponent(comanda));
  if (!n) notFound();
  const { antet, randuri, variatii, goluri } = n;

  return (
    <main className="necesar">
      <p className="nu-tipari"><Tipareste /></p>
      <h1>Necesar {antet.numar}</h1>
      <p className="sumar">
        {antet.tip} · {antet.brand} · lansare {antet.data_lansare} · {antet.stare} · {antet.bucati} buc
        {etichete && <span className="nu-tipari">{' · '}<Link href={`/etichete/${encodeURIComponent(antet.numar)}`}>etichete</Link></span>}
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

      {variatii.map((v) => <PeVariatie key={v.produs_id} v={v} />)}

      {randuri.length > 0 && (
        <section className="total">
          <h2>Total pe comandă</h2>
          <Total titlu="Materie primă" randuri={randuri.filter((r) => r.tip === 'materie_prima')} />
          <Total titlu="Accesorii" randuri={randuri.filter((r) => r.tip === 'accesoriu')} />
        </section>
      )}

      {randuri.length === 0 && goluri.length === 0 && <p>Comanda nu are cantități.</p>}
    </main>
  );
}
