import Link from 'next/link';
import { Fragment } from 'react';
import Grupare from '../Grupare';
import Pliere from '../Pliere';
import { grupareDinAdresa, grupeaza, perioada } from '../lib/perioade';
import { cere, poateModifica } from '../lib/sesiune';
import { branduriActive, centralizatorPeStadii, STADII_LINIE, type StadiuLinie } from '../lib/centralizator';

export const dynamic = 'force-dynamic';

type Cautare = { tip?: string; brand?: string; cauta?: string; toate?: string; stadiu?: string; grupare?: string };

/**
 * Centralizatorul: toate liniile PSF și PSC, pe mărimi, cu drumul fiecăreia —
 * cerut → planificat → croit → bandă → intrat. Filtrele stau în adresă, ca un link
 * trimis pe WhatsApp să arate exact ce vede cel care l-a trimis.
 *
 * Filele sunt stadiile: necroite, croite, în lucru, gata. Necroitele se grupează pe
 * model, pentru că la croit mai multe PSF și PSC pe același model se pot tăia
 * împreună.
 */
export default async function Centralizator({ searchParams }: { searchParams: Promise<Cautare> }) {
  await cere('centralizator');
  const comandaNoua = await poateModifica('comenzi');
  const f = await searchParams;
  const peModel = f.stadiu === 'necroita';
  const [{ randuri, numarate, toate: toateLiniile }, branduri] = await Promise.all([
    centralizatorPeStadii({ ...f, toate: f.toate === '1', peModel }),
    branduriActive(),
  ]);
  // Pe perioade, după lansarea comenzii; necroitele rămân grupate pe model.
  const g = peModel ? '' : grupareDinAdresa(f.grupare, 'saptamana');
  const ordonate = g ? grupeaza(randuri, (r) => r.data_lansare, g).flatMap((x) => x.randuri) : randuri;
  const perioadaRand = (r: (typeof randuri)[number]) => (g ? perioada(g, r.data_lansare).nume : '');
  const adresa = (stadiu?: string) => {
    const q = new URLSearchParams(Object.entries({ ...f, stadiu }).filter(([, v]) => v) as [string, string][]);
    return `/centralizator${q.size ? `?${q}` : ''}`;
  };

  const suma = (k: 'cerut' | 'planificat' | 'croit' | 'banda' | 'intrat') => randuri.reduce((s, r) => s + r[k], 0);
  const comenzi = new Set(randuri.map((r) => r.comanda)).size;

  return (
    <main className="lat">
      <h1>Centralizator</h1>

      <nav className="file">
        <Link href={adresa()} className={!f.stadiu ? 'activ' : ''}>Toate · {toateLiniile}</Link>
        {(Object.keys(STADII_LINIE) as StadiuLinie[]).map((k) => (
          <Link key={k} href={adresa(k)} className={f.stadiu === k ? 'activ' : ''}>
            {STADII_LINIE[k]} · {numarate[k]}
          </Link>
        ))}
      </nav>

      {peModel
        ? <p className="filtre"><Pliere semn={JSON.stringify(f)} /></p>
        : <Grupare ales={g} pastreaza={{ tip: f.tip, brand: f.brand, cauta: f.cauta, toate: f.toate, stadiu: f.stadiu }} />}

      <form className="filtre">
        {f.stadiu && <input type="hidden" name="stadiu" value={f.stadiu} />}
        {f.grupare && <input type="hidden" name="grupare" value={f.grupare} />}
        <select name="tip" defaultValue={f.tip ?? ''} aria-label="Tip">
          <option value="">PSF + PSC</option>
          <option value="PSF">PSF</option>
          <option value="PSC">PSC</option>
        </select>
        <select name="brand" defaultValue={f.brand ?? ''} aria-label="Brand">
          <option value="">Toate brandurile</option>
          {branduri.map((b) => <option key={b}>{b}</option>)}
        </select>
        <input name="cauta" defaultValue={f.cauta ?? ''} placeholder="comandă, produs sau SKU" aria-label="Caută" />
        <label className="bifa">
          <input type="checkbox" name="toate" value="1" defaultChecked={f.toate === '1'} /> și închise
        </label>
        <button>Filtrează</button>
        {comandaNoua && <Link href="/comenzi/noua" className="buton">+ Comandă nouă</Link>}
      </form>

      <p className="sumar">
        {comenzi} comenzi · {randuri.length} poziții · cerut {suma('cerut')} · planificat {suma('planificat')}
        {' · '}croit {suma('croit')} · pe bandă {suma('banda')} · în depozit {suma('intrat')} buc
      </p>

      <div className="tabel-derulant">
        <table className="centralizator">
          <thead>
            <tr>
              <th>Comandă</th>
              <th>Lansare</th>
              <th>Cerut la</th>
              <th>Produs</th>
              <th>Mărime</th>
              <th className="nr">Cerut</th>
              <th className="nr">Planif.</th>
              <th className="nr">Croit</th>
              <th className="nr">Bandă</th>
              <th className="nr">În depozit</th>
              <th className="nr">Lipsesc</th>
            </tr>
          </thead>
          <tbody>
            {ordonate.map((r, i) => {
              const lipsesc = Math.max(0, r.cerut - r.intrat);
              const nouaComanda = i === 0 || ordonate[i - 1].comanda !== r.comanda || ordonate[i - 1].linie_id !== r.linie_id && peModel;
              const nouaPerioada = g && (i === 0 || perioadaRand(ordonate[i - 1]) !== perioadaRand(r));
              const dinPerioada = nouaPerioada ? ordonate.filter((x) => perioadaRand(x) === perioadaRand(r)) : [];
              const model = r.model ?? r.produs;
              const nouModel = peModel && (i === 0 || (ordonate[i - 1].model ?? ordonate[i - 1].produs) !== model);
              const deModel = nouModel ? randuri.filter((x) => (x.model ?? x.produs) === model) : [];
              return (
                <Fragment key={i}>
                {nouaPerioada && (
                  <tr className="grupa-model">
                    <td colSpan={5}>
                      <strong>{perioadaRand(r)}</strong>{' '}
                      <span className="slab">{new Set(dinPerioada.map((x) => x.comanda)).size} comenzi lansate</span>
                    </td>
                    <td className="nr"><strong>{dinPerioada.reduce((a, x) => a + x.cerut, 0)}</strong></td>
                    <td className="nr">{dinPerioada.reduce((a, x) => a + x.planificat, 0) || '—'}</td>
                    <td className="nr">{dinPerioada.reduce((a, x) => a + x.croit, 0) || '—'}</td>
                    <td className="nr">{dinPerioada.reduce((a, x) => a + x.banda, 0) || '—'}</td>
                    <td className="nr">{dinPerioada.reduce((a, x) => a + x.intrat, 0) || '—'}</td>
                    <td />
                  </tr>
                )}
                {nouModel && (
                  <tr className="grupa-model">
                    <td colSpan={5}>
                      <strong>{model}</strong>{' '}
                      <span className="slab">{new Set(deModel.map((x) => x.comanda)).size} comenzi · {new Set(deModel.map((x) => x.produs)).size} produse</span>
                    </td>
                    <td className="nr"><strong>{deModel.reduce((a, x) => a + x.cerut, 0)}</strong></td>
                    <td className="nr">{deModel.reduce((a, x) => a + x.planificat, 0) || '—'}</td>
                    <td colSpan={4} />
                  </tr>
                )}
                <tr className={nouaComanda ? 'prima' : ''}>
                  <td>
                    {nouaComanda && (
                      <>
                        <Link href={`/necesar/${encodeURIComponent(r.comanda)}`}>{r.comanda}</Link>{' '}
                        <span className="slab">{r.tip} · {r.brand} · P{r.prioritate}{r.stare === 'ciorna' && ' · ciornă'}</span>
                      </>
                    )}
                  </td>
                  <td className="slab">{nouaComanda && r.data_lansare}</td>
                  <td className="slab">{r.data_ceruta}</td>
                  <td>
                    {r.produs} <span className="slab">{r.cod_sku}</span>
                  </td>
                  <td>
                    {r.marime}
                    {r.marime_numerica && <span className="slab"> · {r.marime_numerica}</span>}
                  </td>
                  <td className="nr">{r.cerut}</td>
                  <td className={`nr ${r.planificat < r.cerut ? 'slab' : ''}`}>{r.planificat || '—'}</td>
                  <td className={`nr ${r.croit < r.planificat ? 'slab' : ''}`}>{r.croit || '—'}</td>
                  <td className={`nr ${r.banda < r.croit ? 'slab' : ''}`}>{r.banda || '—'}</td>
                  <td className="nr">{r.intrat || '—'}</td>
                  <td className="nr">
                    {r.inchisa ? <span className="slab">închisă</span>
                      : lipsesc > 0 ? <strong>{lipsesc}</strong>
                      : r.intrat > r.cerut ? <span className="slab">+{r.intrat - r.cerut}</span> : '—'}
                  </td>
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
