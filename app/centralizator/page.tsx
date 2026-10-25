import Link from 'next/link';
import { branduriActive, centralizator } from '../lib/centralizator';

export const dynamic = 'force-dynamic';

type Cautare = { tip?: string; brand?: string; cauta?: string; toate?: string };

/**
 * Centralizatorul: toate liniile PSF și PSC, pe mărimi, cu drumul fiecăreia —
 * cerut → planificat → croit → intrat. Filtrele stau în adresă, ca un link
 * trimis pe WhatsApp să arate exact ce vede cel care l-a trimis.
 */
export default async function Centralizator({ searchParams }: { searchParams: Promise<Cautare> }) {
  const f = await searchParams;
  const [randuri, branduri] = await Promise.all([
    centralizator({ ...f, toate: f.toate === '1' }),
    branduriActive(),
  ]);

  const suma = (k: 'cerut' | 'planificat' | 'croit' | 'intrat') => randuri.reduce((s, r) => s + r[k], 0);
  const comenzi = new Set(randuri.map((r) => r.comanda)).size;

  return (
    <main className="lat">
      <h1>Centralizator</h1>

      <form className="filtre">
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
        <Link href="/comenzi/noua" className="buton">+ Comandă nouă</Link>
      </form>

      <p className="sumar">
        {comenzi} comenzi · {randuri.length} poziții · cerut {suma('cerut')} · planificat {suma('planificat')}
        {' · '}croit {suma('croit')} · intrat {suma('intrat')} buc
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
              <th className="nr">Intrat</th>
              <th className="nr">Lipsesc</th>
            </tr>
          </thead>
          <tbody>
            {randuri.map((r, i) => {
              const lipsesc = Math.max(0, r.cerut - r.intrat);
              const nouaComanda = i === 0 || randuri[i - 1].comanda !== r.comanda;
              return (
                <tr key={i} className={nouaComanda ? 'prima' : ''}>
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
                  <td className="nr">{r.intrat || '—'}</td>
                  <td className="nr">
                    {r.inchisa ? <span className="slab">închisă</span>
                      : lipsesc > 0 ? <strong>{lipsesc}</strong>
                      : r.intrat > r.cerut ? <span className="slab">+{r.intrat - r.cerut}</span> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
