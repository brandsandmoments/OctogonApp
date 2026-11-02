import { Termen } from '../Insigne';
import Link from 'next/link';
import { Fragment } from 'react';
import Grupare from '../Grupare';
import Pliere from '../Pliere';
import { grupareDinAdresa, grupeaza, perioada } from '../lib/perioade';
import { modeleComenzi } from '../lib/modele';
import { cere, poateModifica } from '../lib/sesiune';
import { branduriActive, centralizatorPeStadii, STADII_LINIE, type StadiuLinie } from '../lib/centralizator';
import RandCascada from '../productie/RandCascada';
import MarimiComanda from '../productie/MarimiComanda';
import '../productie/productie.css';

export const dynamic = 'force-dynamic';

type Cautare = { tip?: string; brand?: string; cauta?: string; toate?: string; stadiu?: string; grupare?: string };

/**
 * Centralizatorul: toate liniile PSF și PSC, pe mărimi, cu drumul fiecăreia —
 * cerut → planificat → croit → bandă → intrat. Filtrele stau în adresă, ca un link
 * trimis pe WhatsApp să arate exact ce vede cel care l-a trimis.
 *
 * Filele sunt stadiile: rămas de croit, croit, în lucru, în depozit. Rămasele se grupează pe
 * model, pentru că la croit mai multe PSF și PSC pe același model se pot tăia
 * împreună.
 */
export default async function Centralizator({ searchParams }: { searchParams: Promise<Cautare> }) {
  await cere('centralizator');
  const comandaNoua = await poateModifica('comenzi');
  const f = await searchParams;
  const peModel = f.stadiu === 'necroita';
  const [{ randuri, numarate, toate: toateLiniile }, branduri, modele] = await Promise.all([
    centralizatorPeStadii({ ...f, toate: f.toate === '1', peModel }),
    branduriActive(),
    modeleComenzi(),
  ]);
  // Pe perioade, după lansarea comenzii; necroitele rămân grupate pe model.
  const g = peModel ? '' : grupareDinAdresa(f.grupare, 'saptamana');
  // Un rând pe comandă (și model): mărimile și culorile se văd la clic, în cascadă.
  type Rand = (typeof randuri)[number];
  const peComenzi: { cheie: string; r: Rand; randuri: Rand[] }[] = [];
  for (const r of randuri) {
    const cheie = `${r.comanda}|${peModel ? r.model ?? r.produs : ''}`;
    const x = peComenzi.find((y) => y.cheie === cheie);
    if (x) x.randuri.push(r); else peComenzi.push({ cheie, r, randuri: [r] });
  }
  const ordonate = g ? grupeaza(peComenzi, (x) => x.r.data_lansare, g).flatMap((x) => x.randuri) : peComenzi;
  const perioadaRand = (x: { r: Rand }) => (g ? perioada(g, x.r.data_lansare).nume : '');
  const suma2 = (lista: Rand[], k: 'cerut' | 'planificat' | 'croit' | 'banda' | 'intrat') => lista.reduce((t, r) => t + r[k], 0);
  const lipsa = (lista: Rand[]) => lista.reduce((t, r) => t + (r.inchisa ? 0 : Math.max(0, r.cerut - r.intrat)), 0);
  // Pe culori (produse) și mărimi, pentru cascadă.
  const peCulori = (lista: Rand[]) => {
    const pe = new Map<string, { produs: string; cod_sku: string; marimi: { marime: string; cerut: number; planificat: number; croit: number; banda: number; intrat: number; lipsesc: number }[] }>();
    for (const r of lista) {
      const l = pe.get(r.linie_id) ?? { produs: r.produs, cod_sku: r.cod_sku, marimi: [] };
      l.marimi.push({ marime: r.marime, cerut: r.cerut, planificat: r.planificat, croit: r.croit, banda: r.banda, intrat: r.intrat,
                      lipsesc: r.inchisa ? 0 : Math.max(0, r.cerut - r.intrat) });
      pe.set(r.linie_id, l);
    }
    return [...pe.values()];
  };
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
              <th>Model</th>
              <th>Lansare</th>
              <th>Cerut la</th>
              <th>Culori</th>
              <th className="nr">Cerut</th>
              <th className="nr">Planif.</th>
              <th className="nr">Croit</th>
              <th className="nr">Bandă</th>
              <th className="nr">În depozit</th>
              <th className="nr">Lipsesc</th>
            </tr>
          </thead>
          <tbody>
            {ordonate.map((x, i) => {
              const r = x.r;
              const nouaPerioada = g && (i === 0 || perioadaRand(ordonate[i - 1]) !== perioadaRand(x));
              const dinPerioada = nouaPerioada ? ordonate.filter((y) => perioadaRand(y) === perioadaRand(x)).flatMap((y) => y.randuri) : [];
              const model = r.model ?? r.produs;
              const nouModel = peModel && (i === 0 || (ordonate[i - 1].r.model ?? ordonate[i - 1].r.produs) !== model);
              const deModel = nouModel ? randuri.filter((y) => (y.model ?? y.produs) === model) : [];
              const culori = peCulori(x.randuri);
              const termen = x.randuri.map((y) => y.data_ceruta).sort()[0];
              const gata = x.randuri.every((y) => y.inchisa || y.intrat >= y.cerut);
              const lipsesc = lipsa(x.randuri);
              return (
                <Fragment key={x.cheie}>
                {nouaPerioada && (
                  <tr className="grupa-model">
                    <td colSpan={5}>
                      <strong>{perioadaRand(x)}</strong>{' '}
                      <span className="slab">{new Set(dinPerioada.map((y) => y.comanda)).size} comenzi lansate</span>
                    </td>
                    <td className="nr"><strong>{suma2(dinPerioada, 'cerut')}</strong></td>
                    <td className="nr">{suma2(dinPerioada, 'planificat') || '—'}</td>
                    <td className="nr">{suma2(dinPerioada, 'croit') || '—'}</td>
                    <td className="nr">{suma2(dinPerioada, 'banda') || '—'}</td>
                    <td className="nr">{suma2(dinPerioada, 'intrat') || '—'}</td>
                    <td className="nr">{lipsa(dinPerioada) || '—'}</td>
                  </tr>
                )}
                {nouModel && (
                  <tr className="grupa-model">
                    <td colSpan={5}>
                      <strong>{model}</strong>{' '}
                      <span className="slab">{new Set(deModel.map((y) => y.comanda)).size} comenzi · {new Set(deModel.map((y) => y.produs)).size} produse</span>
                    </td>
                    <td className="nr"><strong>{suma2(deModel, 'cerut')}</strong></td>
                    <td className="nr">{suma2(deModel, 'planificat') || '—'}</td>
                    <td colSpan={4} />
                  </tr>
                )}
                <RandCascada coloane={11}
                  detalii={<MarimiComanda linii={culori} masuri={[['cerut', 'Cerut'], ['planificat', 'Planificat'], ['croit', 'Croit'],
                    ['banda', 'Pe bandă'], ['intrat', 'În depozit'], ['lipsesc', 'Lipsesc']]} />}
                  celule={<>
                    <td className="cascada">
                      <Link href={`/necesar/${encodeURIComponent(r.comanda)}`}>{r.comanda}</Link>{' '}
                      <span className="slab">{r.tip} · {r.brand} · P{r.prioritate}{r.stare === 'ciorna' && ' · ciornă'}{r.stare === 'de_aprobat' && ' · de aprobat'}</span>
                    </td>
                    <td>{peModel ? model : modele.get(r.comanda)}</td>
                    <td className="slab">{r.data_lansare}</td>
                    <td><Termen data={termen} gata={gata} /></td>
                    <td>{culori.length === 1 ? culori[0].produs : `${culori.length} culori`} <span className="slab">· {x.randuri.length} mărimi</span></td>
                    <td className="nr">{suma2(x.randuri, 'cerut')}</td>
                    <td className="nr">{suma2(x.randuri, 'planificat') || '—'}</td>
                    <td className="nr">{suma2(x.randuri, 'croit') || '—'}</td>
                    <td className="nr">{suma2(x.randuri, 'banda') || '—'}</td>
                    <td className="nr">{suma2(x.randuri, 'intrat') || '—'}</td>
                    <td className="nr">{gata ? <span className="slab">gata</span> : lipsesc > 0 ? <strong>{lipsesc}</strong> : '—'}</td>
                  </>} />
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
