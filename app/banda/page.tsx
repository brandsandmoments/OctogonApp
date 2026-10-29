import Link from 'next/link';
import { Fragment } from 'react';
import Cauta from '../Cauta';
import Grupare from '../Grupare';
import { potriveste } from '../lib/format';
import { cere, poateModifica } from '../lib/sesiune';
import { deAlimentat, transe } from '../lib/banda';
import { grupareDinAdresa, grupeaza, type TipPerioada } from '../lib/perioade';

export const dynamic = 'force-dynamic';

const VEDERI: [string, string][] = [
  ['de_alimentat', 'De alimentat'],
  ['pe_banda', 'În lucru'],
  ['predate', 'Terminate'],
];

/**
 * Alimentarea benzii: ce s-a croit și așteaptă banda, ce e pe bandă acum (cu data
 * estimată în depozit și marja față de termen) și ce a ajuns la depozit. Se grupează
 * pe săptămâni, luni, trimestre sau ani: după croire, după alimentare, după predare.
 */
export default async function Banda({ searchParams }: { searchParams: Promise<{ vedere?: string; grupare?: string; cauta?: string }> }) {
  await cere('banda');
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('banda');
  const { vedere = 'de_alimentat', grupare, cauta } = await searchParams;
  const g = grupareDinAdresa(grupare, 'saptamana');
  return (
    <main className="lat">
      <h1>Bandă</h1>
      <nav className="file">
        {VEDERI.map(([v, nume]) => (
          <Link key={v} href={`/banda?vedere=${v}${grupare ? `&grupare=${grupare}` : ''}`} className={v === vedere ? 'activ' : ''}>{nume}</Link>
        ))}
      </nav>
      <Cauta valoare={cauta} pastreaza={{ vedere, grupare }} placeholder="caută: comandă, produs, lot" />
      <Grupare ales={g} pastreaza={{ vedere, cauta }} />
      {vedere === 'de_alimentat' ? <DeAlimentat m={m} g={g} cauta={cauta} /> : <Transe predate={vedere === 'predate'} g={g} cauta={cauta} />}
    </main>
  );
}

async function DeAlimentat({ m, g, cauta }: { m: boolean; g: TipPerioada | ''; cauta?: string }) {
  const lista = (await deAlimentat()).filter((l) => potriveste(cauta, l.cod, l.comanda, l.produs));
  const grupe = g ? grupeaza(lista, (l) => l.croit_la, g) : [{ perioada: null, randuri: lista }];
  return (
    <>
      <p className="sumar">{lista.length} loturi croite · {lista.reduce((s, l) => s + l.rest, 0)} buc de dat pe bandă</p>
      {lista.length === 0 ? <p className="slab">Nimic croit care să aștepte banda.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Lot croit</th><th>Termen</th><th>Produs</th><th>Pe mărimi</th>
                       <th className="nr">Croit</th><th className="nr">Pe bandă</th><th className="nr">Rest</th><th /></tr></thead>
            <tbody>
              {grupe.map((gr) => (
                <Fragment key={gr.perioada?.de_la ?? 'toate'}>
                {gr.perioada && (
                  <tr className="grupa-model">
                    <td colSpan={4}><strong>{gr.perioada.nume}</strong> <span className="slab">{gr.randuri.length} loturi · croite</span></td>
                    <td className="nr"><strong>{gr.randuri.reduce((s, l) => s + l.croit, 0)}</strong></td>
                    <td className="nr">{gr.randuri.reduce((s, l) => s + l.alimentat, 0) || '—'}</td>
                    <td className="nr"><strong>{gr.randuri.reduce((s, l) => s + l.rest, 0)}</strong></td>
                    <td />
                  </tr>
                )}
                {gr.randuri.map((l) => (
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
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Transe({ predate, g, cauta }: { predate: boolean; g: TipPerioada | ''; cauta?: string }) {
  const lista = (await transe(predate)).filter((t) => potriveste(cauta, t.cod, t.comanda, t.produs, t.responsabil));
  const grupe = g ? grupeaza(lista, (t) => (predate ? t.predat_la : t.alimentat_la), g) : [{ perioada: null, randuri: lista }];
  return (
    <>
      <p className="sumar">{lista.length} tranșe · {lista.reduce((s, t) => s + t.bucati, 0)} buc</p>
      {lista.length === 0 ? <p className="slab">{predate ? 'Nimic predat încă.' : 'Nimic pe bandă.'}</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Tranșă</th><th>Termen</th><th>Produs</th><th className="nr">Buc</th><th>Etapă</th>
                       <th>{predate ? 'Predat' : 'Estimat în depozit'}</th>{!predate && <th className="nr">Marjă</th>}</tr></thead>
            <tbody>
              {grupe.map((gr) => (
                <Fragment key={gr.perioada?.de_la ?? 'toate'}>
                {gr.perioada && (
                  <tr className="grupa-model">
                    <td colSpan={3}><strong>{gr.perioada.nume}</strong> <span className="slab">{gr.randuri.length} tranșe · {predate ? 'predate' : 'date pe bandă'}</span></td>
                    <td className="nr"><strong>{gr.randuri.reduce((s, t) => s + t.bucati, 0)}</strong></td>
                    <td colSpan={predate ? 2 : 3} />
                  </tr>
                )}
                {gr.randuri.map((t) => (
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
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
