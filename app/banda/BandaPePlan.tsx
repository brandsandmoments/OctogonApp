import Link from 'next/link';
import { Fragment } from 'react';
import { Stadiu, Termen } from '../Insigne';
import { potriveste } from '../lib/format';
import { adaugaZile } from '../lib/perioade';
import { deAlimentat, transe, type LotDeAlimentat, type Transa } from '../lib/banda';
import { STADII_LINIE } from '../lib/centralizator';
import { comenziInPlan, oameniPeTranse, type ComandaInPlan } from '../lib/productie';
import RandCascada from '../productie/RandCascada';

const zi = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const numeSaptamana = (l: string) => {
  const v = adaugaZile(l, 4);
  return l.slice(5, 7) === v.slice(5, 7) ? `${Number(l.slice(8))} – ${zi(v)}` : `${zi(l)} – ${zi(v)}`;
};
const scurt = (d: string | null) => (d ? d.slice(5, 10).split('-').reverse().join('.') : '—');

/**
 * Banda, într-un singur tabel, în ordinea planului: săptămână cu săptămână, apoi ce
 * nu e planificat. Un rând pe PSF sau PSC: cât s-a croit, cât a fost dat pe bandă,
 * cât mai e de dat, cât a ajuns în depozit. La clic, rândul se desface: loturile
 * croite de dat pe bandă (cu „Dă pe bandă") și tranșele de pe bandă, cu oamenii
 * alocați. Aici lucrează managerul și șeful de producție.
 */
export default async function BandaPePlan({ m, cauta }: { m: boolean; cauta?: string }) {
  const [comenzi, loturi, peBanda, oameni] = await Promise.all([comenziInPlan([]), deAlimentat(), transe(false), oameniPeTranse()]);
  const loturiPe = grupa(loturi, (l) => l.comanda);
  const transePe = grupa(peBanda, (t) => t.comanda);
  // Pe bandă intră ce s-a croit și nu s-a dat tot, sau ce are tranșe încă pe bandă.
  const lista = comenzi
    .filter((c) => (loturiPe.get(c.numar)?.length ?? 0) > 0 || (transePe.get(c.numar)?.length ?? 0) > 0)
    .filter((c) => potriveste(cauta, c.numar, c.model, ...c.linii.map((l) => l.produs)))
    .sort((a, b) => (a.saptamana ?? '9999').localeCompare(b.saptamana ?? '9999') || a.prioritate - b.prioritate
      || a.data_ceruta.localeCompare(b.data_ceruta) || a.numar.localeCompare(b.numar));
  const grupe: { cheie: string; nume: string; randuri: ComandaInPlan[] }[] = [];
  for (const c of lista) {
    const cheie = c.saptamana ?? 'neplanificat';
    let g = grupe.find((x) => x.cheie === cheie);
    if (!g) grupe.push(g = { cheie, nume: c.saptamana ? `Planificate pe ${numeSaptamana(c.saptamana)}` : 'Neplanificate', randuri: [] });
    g.randuri.push(c);
  }
  const deDat = (c: ComandaInPlan) => (loturiPe.get(c.numar) ?? []).reduce((s, l) => s + l.rest, 0);
  const totalDeDat = lista.reduce((s, c) => s + deDat(c), 0);
  const totalTranse = lista.reduce((s, c) => s + (transePe.get(c.numar)?.length ?? 0), 0);
  const faraOameni = peBanda.filter((t) => !oameni.get(t.id) && ['alimentat', 'în producție'].includes(t.etapa)).length;
  const COLOANE = 10;

  return (
    <>
      <p className="sumar">
        {lista.length} comenzi · <strong>{totalDeDat} buc de dat pe bandă</strong> · {totalTranse} tranșe pe bandă
        {faraOameni > 0 && <> · <span className="insigna galben">{faraOameni} tranșe fără oameni</span></>}
      </p>
      {lista.length === 0 ? <p className="slab">Nimic croit care să aștepte banda și nimic pe bandă.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead>
              <tr>
                <th>Comandă</th><th>Model</th><th>Termen</th><th className="nr">Croit</th><th className="nr">Alimentat</th>
                <th className="nr">Rămas de alimentat</th><th className="nr">În depozit</th><th>Stadiu</th><th>Pe bandă</th><th />
              </tr>
            </thead>
            <tbody>
              {grupe.map((g) => (
                <Fragment key={g.cheie}>
                  <tr className={`grupa-faza ${g.cheie === 'neplanificat' ? '' : 'planificat'}`}>
                    <td colSpan={COLOANE}>
                      {g.cheie === 'neplanificat' ? g.nume : <Link href={`/productie?sapt=${g.cheie}`}>{g.nume}</Link>}
                      {' · '}{g.randuri.length} {g.randuri.length === 1 ? 'comandă' : 'comenzi'} · {g.randuri.reduce((s, c) => s + deDat(c), 0)} buc de dat pe bandă
                    </td>
                  </tr>
                  {g.randuri.map((c) => {
                    const lt = loturiPe.get(c.numar) ?? [];
                    const tr = transePe.get(c.numar) ?? [];
                    const deAlocat = tr.filter((t) => !oameni.get(t.id) && ['alimentat', 'în producție'].includes(t.etapa)).length;
                    return (
                      <RandCascada key={c.comanda_id} coloane={COLOANE}
                        detalii={<Detalii c={c} loturi={lt} transe={tr} oameni={oameni} m={m} />}
                        celule={<>
                          <td className="cascada">
                            <Link href={`/necesar/${encodeURIComponent(c.numar)}`}>{c.numar}</Link>{' '}
                            <span className="slab">{c.tip} · {c.brand} · P{c.prioritate}</span>
                          </td>
                          <td>{c.model}</td>
                          <td><Termen data={c.data_ceruta} gata={c.stadiu === 'gata'} /></td>
                          <td className="nr">{c.croit || '—'}</td>
                          <td className="nr">{c.banda || '—'}</td>
                          <td className="nr">{deDat(c) ? <strong>{deDat(c)}</strong> : '—'}</td>
                          <td className="nr">{c.intrat || '—'}</td>
                          <td><Stadiu cheie={c.stadiu} nume={STADII_LINIE[c.stadiu]} /></td>
                          <td>
                            {tr.length > 0 ? `${tr.length} ${tr.length === 1 ? 'tranșă' : 'tranșe'}` : <span className="slab">—</span>}
                            {deAlocat > 0 && <> <span className="insigna galben">{deAlocat} fără oameni</span></>}
                          </td>
                          <td>
                            {m && lt.length > 0 && (
                              <Link href={`/banda/alimenteaza?lot=${lt[0].lot_id}`} className="buton">
                                Dă pe bandă{lt.length > 1 && ` (${lt.length} loturi)`}
                              </Link>
                            )}
                          </td>
                        </>} />
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Comanda desfăcută: întâi ce e de dat pe bandă (pe loturi croite), apoi tranșele de pe bandă cu oamenii lor. */
function Detalii({ c, loturi, transe, oameni, m }: {
  c: ComandaInPlan; loturi: LotDeAlimentat[]; transe: Transa[]; oameni: Map<string, number>; m: boolean;
}) {
  const cod = (x: string) => x.slice(c.numar.length + 1);
  return (
    <div className="detalii-banda">
      <h4>De dat pe bandă</h4>
      {loturi.length === 0 ? <p className="slab">Tot ce s-a croit a fost dat pe bandă.</p> : (
        <table className="marimi-comanda">
          <thead><tr><th>Lot croit</th><th>Produs</th><th>Pe mărimi, de dat</th><th>Croit</th><th>Alimentat</th><th>Rămas</th><th /></tr></thead>
          <tbody>
            {loturi.map((l) => (
              <tr key={l.lot_id}>
                <td className="ce"><Link href={`/croit/${l.lot_id}`}>{cod(l.cod)}</Link> <span className="slab">croit {scurt(l.croit_la)}</span></td>
                <td className="ce">{l.produs}</td>
                <td className="ce">{l.marimi.map((x) => `${x.marime} ${x.rest}`).join(' · ')}</td>
                <td>{l.croit}</td>
                <td>{l.alimentat || '—'}</td>
                <td className="total">{l.rest}</td>
                <td>{m && <Link href={`/banda/alimenteaza?lot=${l.lot_id}`} className="buton">Dă pe bandă</Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h4>Pe bandă</h4>
      {transe.length === 0 ? <p className="slab">Nicio tranșă pe bandă.</p> : (
        <table className="marimi-comanda">
          <thead><tr><th>Tranșă</th><th>Produs</th><th>Buc</th><th>Etapă</th><th>Estimat în depozit</th><th>Marjă</th><th>Cine lucrează</th></tr></thead>
          <tbody>
            {transe.map((t) => {
              const n = oameni.get(t.id) ?? 0;
              return (
                <tr key={t.id}>
                  <td className="ce"><Link href={`/banda/${t.id}`}>{cod(t.cod)}</Link> <span className="slab">dat {scurt(t.alimentat_la)}</span></td>
                  <td className="ce">{t.produs}</td>
                  <td>{t.bucati}</td>
                  <td className="ce">{t.etapa}</td>
                  <td>{scurt(t.eta)}</td>
                  <td className={t.marja_zile !== null && t.marja_zile < 0 ? 'lipsa' : ''}>
                    {t.marja_zile === null ? '—' : `${t.marja_zile > 0 ? '+' : ''}${t.marja_zile} zile`}
                  </td>
                  <td className="ce">
                    {n > 0 ? <Link href={`/banda/${t.id}`} className="insigna verde">{n} {n === 1 ? 'om' : 'oameni'}</Link>
                      : ['alimentat', 'în producție'].includes(t.etapa) ? <Link href={`/banda/${t.id}`} className="insigna galben">alocă oamenii</Link>
                      : <span className="slab">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function grupa<T>(lista: T[], cheie: (x: T) => string): Map<string, T[]> {
  const pe = new Map<string, T[]>();
  for (const x of lista) pe.set(cheie(x), [...(pe.get(cheie(x)) ?? []), x]);
  return pe;
}
