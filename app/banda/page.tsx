import Link from 'next/link';
import { cere, poateModifica } from '../lib/sesiune';
import { deAlimentat, transe } from '../lib/banda';

export const dynamic = 'force-dynamic';

const VEDERI: [string, string][] = [
  ['de_alimentat', 'De alimentat'],
  ['pe_banda', 'Pe bandă'],
  ['predate', 'Predate la depozit'],
];

/**
 * Alimentarea benzii: ce s-a croit și așteaptă banda, ce e pe bandă acum (cu data
 * estimată în depozit și marja față de termen) și ce a ajuns la depozit.
 */
export default async function Banda({ searchParams }: { searchParams: Promise<{ vedere?: string }> }) {
  await cere('banda');
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('banda');
  const { vedere = 'de_alimentat' } = await searchParams;
  return (
    <main className="lat">
      <h1>Bandă</h1>
      <nav className="file">
        {VEDERI.map(([v, nume]) => (
          <Link key={v} href={`/banda?vedere=${v}`} className={v === vedere ? 'activ' : ''}>{nume}</Link>
        ))}
      </nav>
      {vedere === 'de_alimentat' ? <DeAlimentat m={m} /> : <Transe predate={vedere === 'predate'} />}
    </main>
  );
}

async function DeAlimentat({ m }: { m: boolean }) {
  const lista = await deAlimentat();
  return (
    <>
      <p className="sumar">{lista.length} loturi croite · {lista.reduce((s, l) => s + l.rest, 0)} buc de dat pe bandă</p>
      {lista.length === 0 ? <p className="slab">Nimic croit care să aștepte banda.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Lot croit</th><th>Termen</th><th>Produs</th><th>Pe mărimi</th>
                       <th className="nr">Croit</th><th className="nr">Pe bandă</th><th className="nr">Rest</th><th /></tr></thead>
            <tbody>
              {lista.map((l) => (
                <tr key={l.lot_id}>
                  <td><Link href={`/croit/${l.lot_id}`}>{l.cod}</Link> <span className="slab">P{l.prioritate}</span></td>
                  <td className="slab">{l.data_ceruta}</td>
                  <td>{l.produs}</td>
                  <td>{l.marimi.map((m) => `${m.marime} ${m.rest}`).join(' · ')}</td>
                  <td className="nr">{l.croit}</td>
                  <td className="nr">{l.alimentat || '—'}</td>
                  <td className="nr"><strong>{l.rest}</strong></td>
                  <td>{m && <Link href={`/banda/alimenteaza?lot=${l.lot_id}`}>Dă pe bandă</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Transe({ predate }: { predate: boolean }) {
  const lista = await transe(predate);
  return (
    <>
      <p className="sumar">{lista.length} tranșe · {lista.reduce((s, t) => s + t.bucati, 0)} buc</p>
      {lista.length === 0 ? <p className="slab">{predate ? 'Nimic predat încă.' : 'Nimic pe bandă.'}</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Tranșă</th><th>Termen</th><th>Produs</th><th className="nr">Buc</th><th>Etapă</th>
                       <th>{predate ? 'Predat' : 'Estimat în depozit'}</th>{!predate && <th className="nr">Marjă</th>}</tr></thead>
            <tbody>
              {lista.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/banda/${t.id}`}>{t.cod}</Link> <span className="slab">P{t.prioritate}</span></td>
                  <td className="slab">{t.data_ceruta}</td>
                  <td>{t.produs}{t.responsabil && <span className="slab"> · {t.responsabil}</span>}</td>
                  <td className="nr">{t.bucati}</td>
                  <td>{t.etapa}</td>
                  <td className="slab">{predate ? t.predat_la : t.eta ?? '—'}</td>
                  {!predate && (
                    <td className={`nr ${t.marja_zile !== null && t.marja_zile < 0 ? 'lipsa' : ''}`}>
                      {t.marja_zile === null ? '—' : `${t.marja_zile > 0 ? '+' : ''}${t.marja_zile} zile`}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
