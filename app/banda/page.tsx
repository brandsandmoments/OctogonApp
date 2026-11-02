import { Termen } from '../Insigne';
import Link from 'next/link';
import { Fragment } from 'react';
import Cauta from '../Cauta';
import Pliere from '../Pliere';
import { potriveste } from '../lib/format';
import { cere, poateModifica } from '../lib/sesiune';
import { transe } from '../lib/banda';
import { modeleComenzi } from '../lib/modele';
import { oameniPeTranse } from '../lib/productie';
import FileProductie from '../productie/FileProductie';
import BandaPePlan from './BandaPePlan';
import '../productie/productie.css';
import { grupareDinAdresa, grupeaza, type TipPerioada } from '../lib/perioade';

export const dynamic = 'force-dynamic';

/**
 * Banda: ce s-a croit și așteaptă banda și ce e pe bandă acum, într-un singur tabel
 * în ordinea planului (BandaPePlan); separat, ce a ajuns la depozit, grupat pe
 * săptămâni, luni, trimestre sau ani după predare.
 */
export default async function Banda({ searchParams }: { searchParams: Promise<{ vedere?: string; grupare?: string; cauta?: string }> }) {
  await cere('banda');
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('banda');
  const { vedere, grupare, cauta } = await searchParams;
  const predate = vedere === 'predate';
  // Terminatele, pe săptămâni de la început; se schimbă pe luni sau ani dintr-un clic.
  const g = grupareDinAdresa(grupare, 'saptamana');
  const PE: [string, string][] = [['saptamana', 'Pe săptămâni'], ['luna', 'Pe luni'], ['an', 'Pe ani'], ['fara', 'Toate, negrupate']];
  const adresaGrupare = (x: string) => `/banda?vedere=predate&grupare=${x}${cauta ? `&cauta=${encodeURIComponent(cauta)}` : ''}`;
  return (
    <main className="lat">
      <h1>Producție</h1>
      <FileProductie activ={predate ? 'predate' : 'banda'} />
      <p className="slab">
        {predate ? 'Tranșele ajunse la depozit.'
          : 'În ordinea planului, săptămână cu săptămână. Clic pe o comandă: loturile croite de dat pe bandă și tranșele de pe bandă, cu oamenii alocați.'}
      </p>
      <Cauta valoare={cauta} pastreaza={{ vedere, grupare }} placeholder="caută: comandă, model, produs" />
      {predate && (
        <div className="filtre">
          {PE.map(([k, nume]) => (
            <Link key={k} href={adresaGrupare(k)} className={`buton ${(g || 'fara') === k ? 'activ-buton' : ''}`}>{nume}</Link>
          ))}
          {g && <Pliere semn={JSON.stringify([g, cauta])} />}
        </div>
      )}
      {predate ? <Transe predate g={g} cauta={cauta} /> : <BandaPePlan m={m} cauta={cauta} />}
    </main>
  );
}

async function Transe({ predate, g, cauta }: { predate: boolean; g: TipPerioada | ''; cauta?: string }) {
  const [toate, modele, oameni] = await Promise.all([transe(predate), modeleComenzi(), oameniPeTranse()]);
  const lista = toate.filter((t) => potriveste(cauta, t.cod, t.comanda, t.produs, t.responsabil));
  const grupe = g ? grupeaza(lista, (t) => (predate ? t.predat_la : t.alimentat_la), g) : [{ perioada: null, randuri: lista }];
  return (
    <>
      <p className="sumar">{lista.length} tranșe · {lista.reduce((s, t) => s + t.bucati, 0)} buc</p>
      {lista.length === 0 ? <p className="slab">{predate ? 'Nimic predat încă.' : 'Nimic pe bandă.'}</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Tranșă</th><th>Model</th><th>Termen</th><th>Produs</th><th className="nr">Buc</th><th>Etapă</th>
                       <th>{predate ? 'Predat' : 'Estimat în depozit'}</th>{!predate && <th className="nr">Marjă</th>}{!predate && <th>Cine lucrează</th>}</tr></thead>
            <tbody>
              {grupe.map((gr) => (
                <Fragment key={gr.perioada?.de_la ?? 'toate'}>
                {gr.perioada && (
                  <tr className="grupa-model">
                    <td colSpan={4}><strong>{gr.perioada.nume}</strong> <span className="slab">{gr.randuri.length} tranșe · {predate ? 'predate' : 'date pe bandă'}</span></td>
                    <td className="nr"><strong>{gr.randuri.reduce((s, t) => s + t.bucati, 0)}</strong></td>
                    <td colSpan={predate ? 2 : 4} />
                  </tr>
                )}
                {gr.randuri.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/banda/${t.id}`}>{t.cod}</Link> <span className="slab">P{t.prioritate}</span></td>
                  <td>{modele.get(t.comanda)}</td>
                  <td><Termen data={t.data_ceruta} /></td>
                  <td>{t.produs}{t.responsabil && <span className="slab"> · {t.responsabil}</span>}</td>
                  <td className="nr">{t.bucati}</td>
                  <td>{t.etapa}</td>
                  <td className="slab">{predate ? t.predat_la : t.eta ?? '—'}</td>
                  {!predate && (
                    <td className={`nr ${t.marja_zile !== null && t.marja_zile < 0 ? 'lipsa' : ''}`}>
                      {t.marja_zile === null ? '—' : `${t.marja_zile > 0 ? '+' : ''}${t.marja_zile} zile`}
                    </td>
                  )}
                  {!predate && (
                    <td>
                      {(oameni.get(t.id) ?? 0) > 0
                        ? <Link href={`/banda/${t.id}`} className="insigna verde">{oameni.get(t.id)} {oameni.get(t.id) === 1 ? 'om' : 'oameni'}</Link>
                        : ['alimentat', 'în producție'].includes(t.etapa)
                          ? <Link href={`/banda/${t.id}`} className="insigna galben">alocă oamenii</Link>
                          : <span className="slab">—</span>}
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
