import Link from 'next/link';
import { loturi, ramasDeCroit, type Vedere } from '../lib/croit';

export const dynamic = 'force-dynamic';

const VEDERI: [string, string][] = [
  ['toate', 'Toate'],
  ['croite', 'Croite'],
  ['ramas', 'Rămas de croit'],
];

/**
 * Ce vede croitul, în trei vederi:
 *   toate · croite · rămas de croit
 * „Rămas de croit" e tot ce încă n-a fost croit, pe mărimi: loturile lansate și
 * necroite, plus diferențele loturilor croite incomplet.
 */
export default async function Croit({ searchParams }: { searchParams: Promise<{ vedere?: string }> }) {
  const { vedere = 'toate' } = await searchParams;

  return (
    <main className="lat">
      <h1>Croit</h1>
      <nav className="file">
        {VEDERI.map(([v, nume]) => (
          <Link key={v} href={`/croit?vedere=${v}`} className={v === vedere ? 'activ' : ''}>{nume}</Link>
        ))}
      </nav>
      {vedere === 'ramas' ? <Ramas /> : <Loturi vedere={vedere as Vedere} />}
    </main>
  );
}

async function Loturi({ vedere }: { vedere: Vedere }) {
  const lista = await loturi(vedere === 'croite' ? 'croite' : 'toate');
  const deCroit = lista.filter((l) => !l.croit_la);
  return (
    <>
      <p className="sumar">
        {lista.length} loturi · {deCroit.length} de croit ({deCroit.reduce((s, l) => s + l.cerut, 0)} buc) ·{' '}
        {lista.length - deCroit.length} croite
      </p>
      {lista.length === 0 ? <p className="slab">Niciun lot.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead>
              <tr><th>Lot</th><th>Termen</th><th>Produs</th><th>Stofă</th>
                  <th className="nr">Cerut</th><th className="nr">Croit</th><th>Etape</th><th>Stare</th></tr>
            </thead>
            <tbody>
              {lista.map((l) => (
                <tr key={l.id}>
                  <td><Link href={`/croit/${l.id}`}>{l.cod}</Link> <span className="slab">P{l.prioritate}</span></td>
                  <td className="slab">{l.data_ceruta}</td>
                  <td>{l.produs}</td>
                  <td className="slab">{l.stofa ?? '—'}</td>
                  <td className="nr">{l.cerut}</td>
                  <td className={`nr ${l.croit !== null && l.croit < l.cerut ? 'lipsa' : ''}`}>{l.croit ?? '—'}</td>
                  <td className="slab">{l.etape}/{l.etape_total}</td>
                  <td>{l.croit_la ? <span className="slab">croit {l.croit_la}</span> : <strong>de croit</strong>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Ramas() {
  const lista = await ramasDeCroit();
  return (
    <>
      <p className="sumar">
        {lista.reduce((s, r) => s + r.rest, 0)} buc rămase de croit ·{' '}
        {lista.filter((r) => r.lot_deschis).length} loturi lansate și necroite ·{' '}
        {lista.filter((r) => !r.lot_deschis).length} diferențe din loturi croite
      </p>
      {lista.length === 0 ? <p className="slab">Nu a rămas nimic de croit.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>De croit</th><th>Termen</th><th>Produs</th><th>Pe mărimi</th><th className="nr">Rest</th><th /></tr></thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.planificare_id}>
                  <td>
                    {/* Lotul lansat se deschide direct: acolo se înregistrează croitul. */}
                    <Link href={r.lot_deschis ? `/croit/${r.lot_deschis}` : `/planificare/${r.planificare_id}`}>{r.cod}</Link>{' '}
                    <span className="slab">P{r.prioritate}</span>
                  </td>
                  <td className="slab">{r.data_ceruta}</td>
                  <td>{r.produs}</td>
                  <td>{r.marimi.map((m) => `${m.marime} ${m.rest}`).join(' · ')}</td>
                  <td className="nr"><strong>{r.rest}</strong></td>
                  <td>{r.lot_deschis ? <strong>lot lansat</strong> : <span className="slab">diferență din lot croit</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
