import Link from 'next/link';
import { deplanificat, planificariActive } from '../lib/planificare';
import { STADII } from '../lib/stadii';

export const dynamic = 'force-dynamic';

/**
 * Planificarea: sus ce e deja planificat și încă lucrează, jos ce mai e de
 * planificat din comenzile deschise — urgența întâi, apoi termenul.
 */
export default async function Planificare({ searchParams }: { searchParams: Promise<{ cauta?: string }> }) {
  const { cauta } = await searchParams;
  const [active, deplan] = await Promise.all([planificariActive(), deplanificat(cauta)]);

  return (
    <main className="lat">
      <h1>Planificare</h1>
      <p className="sumar">
        {active.length} planificări active · {deplan.length} poziții de planificat ·{' '}
        {deplan.reduce((s, l) => s + l.rest, 0)} buc neplanificate · <Link href="/croit">croit</Link>
      </p>

      <h2>Planificări active</h2>
      {active.length === 0 ? <p className="slab">Nicio planificare activă.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead>
              <tr><th>Planificare</th><th>Termen</th><th>Produs</th><th>Stadiu</th>
                  <th className="nr">Planif.</th><th className="nr">Croit</th><th>Materiale</th></tr>
            </thead>
            <tbody>
              {active.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/planificare/${p.id}`}>{p.cod}</Link> <span className="slab">P{p.prioritate}</span></td>
                  <td className="slab">{p.data_ceruta}</td>
                  <td>{p.produs}</td>
                  <td>{STADII[p.stadiu] ?? p.stadiu}{p.loturi_deschise > 0 && <span className="slab"> · lot la croit</span>}</td>
                  <td className="nr">{p.planificat}</td>
                  <td className="nr">{p.croit || '—'}</td>
                  <td>{p.stofa_lipsa ? <span className="lipsa">stofă lipsă</span>
                    : p.alte_lipsa > 0 ? <span className="slab">stofă ok · lipsesc {p.alte_lipsa}</span>
                    : <span className="slab">acoperite</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>De planificat</h2>
      <form className="filtre">
        <input name="cauta" defaultValue={cauta ?? ''} placeholder="comandă sau produs" aria-label="Caută" />
        <button>Caută</button>
      </form>
      <div className="tabel-derulant">
        <table className="centralizator">
          <thead>
            <tr><th>Comandă</th><th>Termen</th><th>Produs</th>
                <th className="nr">Cerut</th><th className="nr">Planif.</th><th className="nr">Rest</th><th /></tr>
          </thead>
          <tbody>
            {deplan.map((l) => (
              <tr key={l.linie_id}>
                <td>{l.comanda} <span className="slab">{l.tip} · P{l.prioritate}</span></td>
                <td className="slab">{l.data_ceruta}</td>
                <td>{l.produs} <span className="slab">{l.cod_sku}</span></td>
                <td className="nr">{l.cerut}</td>
                <td className="nr">{l.planificat || '—'}</td>
                <td className="nr"><strong>{l.rest}</strong></td>
                <td>{l.are_reteta
                  ? <Link href={`/planificare/nou?linie=${l.linie_id}`}>Planifică</Link>
                  : <span className="lipsa">fără rețetă</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
