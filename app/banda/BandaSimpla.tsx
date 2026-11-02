import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Fragment } from 'react';
import { Termen } from '../Insigne';
import Pliere from '../Pliere';
import { durata, numarDinFormular, potriveste } from '../lib/format';
import { cere } from '../lib/sesiune';
import { daInLucru, deDatInLucru, iesitGata, transeSimple, type LotDeDat } from '../lib/banda';
import { oameniCroit } from '../lib/croitTaiere';
import AlegeOameni from '../croit/taiere/[id]/AlegeOameni';

const scurt = (d: string | null) => (d ? d.slice(5, 10).split('-').reverse().join('.') : '—');
/** Culoarea din numele produsului, fără tip și fără model: „Palton Eloria Maro" → „Maro". */
const culoare = (produs: string, model: string) => {
  const m = new Set(model.toLowerCase().split(/\s+/));
  return produs.split(/\s+/).slice(1).filter((w) => !m.has(w.toLowerCase())).join(' ') || produs;
};

/**
 * Banda, simplu: întâi ce e de dat în lucru — pe fiecare PSF/PSC, culorile croite cu
 * mărimile rămase (sau „tot") și cine lucrează, apoi „Dă în lucru" —, dedesubt ce e
 * în lucru acum, cu „A ieșit gata" pe fiecare tranșă.
 */
export default async function BandaSimpla({ m, cauta, parte }: { m: boolean; cauta?: string; parte: 'de_dat' | 'in_lucru' }) {
  const [loturi, inLucru, om] = await Promise.all([deDatInLucru(), transeSimple(false), oameniCroit()]);
  const lista = loturi.filter((l) => potriveste(cauta, l.cod, l.comanda, l.model, l.produs));
  const lucru = inLucru.filter((t) => potriveste(cauta, t.cod, t.comanda, t.model, t.produs, t.oameni));
  const pe = new Map<string, LotDeDat[]>();
  for (const l of lista) pe.set(l.comanda, [...(pe.get(l.comanda) ?? []), l]);

  async function da(date: FormData) {
    'use server';
    await cere('banda', 'modifica');
    const ale = await deDatInLucru();
    const ids = new Set(date.getAll('lot').map(String));
    const e = await daInLucru(ale.filter((l) => ids.has(l.lot_id)).map((l) => ({
      lotId: l.lot_id,
      cantitati: new Map(l.marimi.map((x) => {
        const scris = String(date.get(`q:${l.lot_id}:${x.marime_id}`) ?? '').trim();
        return [x.marime_id, scris ? numarDinFormular(scris) ?? -1 : date.get(`tot:${l.lot_id}`) ? x.rest : 0] as [string, number];
      })),
    })), date.getAll('om').map(String));
    redirect(`/banda${e ? `?eroare=${encodeURIComponent(e)}` : ''}`);
  }
  async function gata(date: FormData) {
    'use server';
    await cere('banda', 'modifica');
    const t = await iesitGata(String(date.get('id')));
    redirect(`/banda?vedere=in_lucru${t ? `&ok=${encodeURIComponent(`${t.cod} a ieșit gata în ${durata(t.minute)} de la intrarea în lucru.`)}` : ''}`);
  }

  const q = cauta ? `&cauta=${encodeURIComponent(cauta)}` : '';
  return (
    <>
      <div className="filtre">
        <Link href={`/banda?vedere=de_dat${q}`} className={`buton ${parte === 'de_dat' ? 'activ-buton' : ''}`}>
          De dat în lucru · {lista.reduce((s, l) => s + l.rest, 0)} buc
        </Link>
        <Link href={`/banda?vedere=in_lucru${q}`} className={`buton ${parte === 'in_lucru' ? 'activ-buton' : ''}`}>
          Date în lucru · {lucru.reduce((s, t) => s + t.bucati, 0)} buc
        </Link>
      </div>
      {parte === 'de_dat' && <>
      <h2>De dat în lucru <span className="slab">· {lista.reduce((s, l) => s + l.rest, 0)} buc croite în {pe.size} comenzi</span></h2>
      <p className="slab">Deschide comanda, scrie ce intră acum (sau bifează „tot"), alege cine lucrează și „Dă în lucru".</p>
      <p className="filtre"><Pliere semn={`banda-${cauta ?? ''}`} /></p>
      {pe.size === 0 ? <p className="slab">Nimic croit care să aștepte.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Comandă · culoare</th><th>Termen</th><th>Ce intră acum, pe mărimi</th><th className="nr">Croit, de dat</th></tr></thead>
            <tbody>
              {[...pe].map(([comanda, ls]) => {
                const formular = `b-${comanda}`;
                return (
                  <Fragment key={comanda}>
                    <tr className="grupa-model">
                      <td colSpan={3}>
                        <strong>{comanda}</strong> <span className="slab">{ls[0].tip} · {ls[0].brand} · {ls[0].model}</span>
                        {ls[0].saptamana && <> <span className="insigna albastru">săpt. {scurt(ls[0].saptamana)}</span></>}
                        <form id={formular} action={da}>{ls.map((l) => <input key={l.lot_id} type="hidden" name="lot" value={l.lot_id} />)}</form>
                      </td>
                      <td className="nr"><strong>{ls.reduce((s, l) => s + l.rest, 0)}</strong></td>
                    </tr>
                    {ls.map((l) => (
                      <tr key={l.lot_id}>
                        <td><strong>{culoare(l.produs, l.model)}</strong> <span className="slab">{l.cod.slice(comanda.length + 1)}</span></td>
                        <td><Termen data={l.data_ceruta} /></td>
                        <td>
                          <span className="marimi-croit">
                            {l.marimi.map((x) => (
                              <label key={x.marime_id}>
                                <span className="slab">{x.marime} · {x.rest}</span>
                                <input name={`q:${l.lot_id}:${x.marime_id}`} form={formular} inputMode="numeric" className="bucati"
                                       placeholder="0" disabled={!m} aria-label={`${l.produs} ${x.marime}, din ${x.rest}`} />
                              </label>
                            ))}
                            <label className="bifa-tot">
                              <span className="slab">tot</span>
                              <input type="checkbox" name={`tot:${l.lot_id}`} value="1" form={formular} disabled={!m} aria-label={`Tot ${l.produs}`} />
                            </label>
                          </span>
                        </td>
                        <td className="nr">{l.rest}</td>
                      </tr>
                    ))}
                    <tr className="cine-croieste">
                      <td colSpan={4}>
                        <span className="cine-operatii">
                          <label>
                            <span>Cine lucrează</span>
                            <AlegeOameni nume="om" form={formular} croit={om.altii} altii={om.oameni} etichete={['Producție', 'Croit']} ales="" dezactivat={!m} obligatoriu={false} />
                          </label>
                        </span>
                        <button form={formular} className="principal" disabled={!m}>Dă în lucru</button>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      </>}

      {parte === 'in_lucru' && <>
      <h2>Date în lucru <span className="slab">· {lucru.reduce((s, t) => s + t.bucati, 0)} buc în {lucru.length} tranșe</span></h2>
      {lucru.length === 0 ? <p className="slab">Nimic în lucru.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Comandă · culoare</th><th>Mărimi</th><th className="nr">Buc</th><th>Intrat în lucru</th><th>În lucru de</th><th>Termen</th><th>Cine lucrează</th><th /></tr></thead>
            <tbody>
              {lucru.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/banda/${t.id}`}>{t.comanda}</Link> <strong>{culoare(t.produs, t.model)}</strong> <span className="slab">{t.model}</span></td>
                  <td className="slab">{t.marimi}</td>
                  <td className="nr">{t.bucati}</td>
                  <td className="slab">{t.intrat_ora}</td>
                  <td><strong>{durata(t.minute)}</strong></td>
                  <td><Termen data={t.data_ceruta} /></td>
                  <td>{t.oameni ?? <Link href={`/banda/${t.id}`} className="insigna galben">alocă oamenii</Link>}</td>
                  <td>
                    {m && (
                      <form action={gata}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="secundar">A ieșit gata</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>}
    </>
  );
}
