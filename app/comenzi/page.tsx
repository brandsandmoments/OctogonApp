import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Fragment } from 'react';
import Cauta from '../Cauta';
import { Progres, Stadiu, Termen } from '../Insigne';
import Grupare from '../Grupare';
import { potriveste } from '../lib/format';
import { grupareDinAdresa, grupeaza } from '../lib/perioade';
import { centralizatorPeStadii, STADII_LINIE, type StadiuLinie } from '../lib/centralizator';
import { modeleComenzi } from '../lib/modele';
import { cere, poateModifica } from '../lib/sesiune';
import { schimbaTermen } from '../lib/comenzi';
import AduDinShopify from './AduDinShopify';

export const dynamic = 'force-dynamic';

const TIPURI = {
  PSF: 'Punere pe stoc din forecast',
  PSC: 'Punere pe stoc din comanda clientului',
} as const;

/**
 * Comenzile date de KAM, pe două file: PSF (din forecast) și PSC (pe produse care
 * au deja comenzi pe site). Câte o comandă pe rând, cu cât s-a cerut, cât s-a
 * croit, cât a intrat în depozit și în ce stadiu sunt liniile ei. Pozițiile pe
 * mărimi sunt în centralizator. Se grupează pe săptămâni, luni, trimestre sau ani,
 * după ziua lansării.
 */
export default async function Comenzi({ searchParams }: { searchParams: Promise<{ tip?: string; toate?: string; grupare?: string; cauta?: string; trimis?: string; eroare?: string; ok?: string }> }) {
  await cere('comenzi');
  const f = await searchParams;
  const tip: keyof typeof TIPURI = f.tip === 'PSC' ? 'PSC' : 'PSF';
  const [{ randuri }, poateDa, modele] = await Promise.all([
    centralizatorPeStadii({ tip, toate: f.toate === '1' }),
    poateModifica('comenzi'),
    modeleComenzi(),
  ]);

  type Comanda = {
    numar: string; brand: string; kam: string | null; lansare: string; prioritate: number; stare: string;
    cerutLa: string; cerut: number; croit: number; intrat: number; stadii: Map<string, StadiuLinie>; produse: Set<string>;
  };
  const comenzi = new Map<string, Comanda>();
  for (const r of randuri) {
    const c = comenzi.get(r.comanda) ?? {
      numar: r.comanda, brand: r.brand, kam: r.kam, lansare: r.data_lansare, prioritate: r.prioritate, stare: r.stare,
      cerutLa: r.data_ceruta, cerut: 0, croit: 0, intrat: 0, stadii: new Map(), produse: new Set<string>(),
    };
    c.produse.add(`${r.produs} ${r.cod_sku}`);
    c.cerut += r.cerut; c.croit += r.croit; c.intrat += r.intrat;
    if (r.data_ceruta < c.cerutLa) c.cerutLa = r.data_ceruta;
    c.stadii.set(r.linie_id, r.stadiu);
    comenzi.set(r.comanda, c);
  }
  const lista = [...comenzi.values()].filter((c) => potriveste(f.cauta, c.numar, c.brand, c.kam, ...c.produse)).sort((a, b) => b.lansare.localeCompare(a.lansare) || a.numar.localeCompare(b.numar));
  // Comenzile pornesc pe săptămâni de lansare, strânse.
  const g = grupareDinAdresa(f.grupare, 'saptamana');
  const grupe = g ? grupeaza(lista, (c) => c.lansare, g) : [{ perioada: null, randuri: lista }];
  const aici = `/comenzi?tip=${tip}${f.toate ? `&toate=${f.toate}` : ''}${f.grupare ? `&grupare=${f.grupare}` : ''}${f.cauta ? `&cauta=${encodeURIComponent(f.cauta)}` : ''}`;

  // Termenul scris greșit la lansare se corectează de aici (pe toate liniile comenzii).
  async function termen(date: FormData) {
    'use server';
    const cine = await cere('comenzi', 'modifica');
    const numar = String(date.get('numar'));
    const e = await schimbaTermen(numar, String(date.get('data') ?? ''), cine.nume);
    const la = String(date.get('inapoi') ?? '/comenzi');
    redirect(`${la}${la.includes('?') ? '&' : '?'}${e ? `eroare=${encodeURIComponent(e)}` : `ok=${encodeURIComponent(`${numar}: termenul a fost schimbat.`)}`}`);
  }

  return (
    <main className="lat">
      <h1>Comenzi</h1>
      <nav className="file">
        {(Object.keys(TIPURI) as (keyof typeof TIPURI)[]).map((t) => (
          <Link key={t} href={`/comenzi?tip=${t}${f.grupare ? `&grupare=${f.grupare}` : ''}`} className={t === tip ? 'activ' : ''}>{t}</Link>
        ))}
        <Link href="/mostre">Mostre</Link>
      </nav>
      <p className="sumar">
        {TIPURI[tip]} · {lista.length} comenzi{f.toate === '1' ? '' : ' deschise'} ·{' '}
        <Link href={`/comenzi?tip=${tip}${f.toate === '1' ? '' : '&toate=1'}${f.grupare ? `&grupare=${f.grupare}` : ''}`}>
          {f.toate === '1' ? 'doar deschise' : 'și închise'}
        </Link>
      </p>
      {f.eroare && <p className="eroare">{f.eroare}</p>}
      {f.ok && <p className="mesaj-ok">{f.ok}</p>}
      {f.trimis && <p className="mesaj-ok">{f.trimis} a fost trimis spre aprobare: un responsabil îl aprobă, apoi se lansează în producție.</p>}
      <Cauta valoare={f.cauta} pastreaza={{ tip, toate: f.toate, grupare: f.grupare }} placeholder="caută: comandă, produs, SKU, KAM" />
      <Grupare ales={g} pastreaza={{ tip, toate: f.toate, cauta: f.cauta }} />
      {poateDa && (
        <p className="filtre"><Link href={`/comenzi/noua?tip=${tip}`} className="buton">+ {tip} nouă</Link> <AduDinShopify /></p>
      )}
      <div className="tabel-derulant">
        <table>
          <thead>
            <tr>
              <th>Comandă</th>
              <th>Model</th>
              <th>KAM</th>
              <th>Lansată</th>
              <th>Termen</th>
              <th className="nr">Cerut</th>
              <th>Progres</th>
              <th>Liniile</th>
            </tr>
          </thead>
          <tbody>
            {grupe.map((gr) => (
              <Fragment key={gr.perioada?.de_la ?? 'toate'}>
              {gr.perioada && (
                <tr className="grupa-model">
                  <td colSpan={5}><strong>{gr.perioada.nume}</strong> <span className="slab">{gr.randuri.length} comenzi lansate</span></td>
                  <td className="nr"><strong>{gr.randuri.reduce((s, c) => s + c.cerut, 0)}</strong></td>
                  <td>
                    <Progres cerut={gr.randuri.reduce((s, c) => s + c.cerut, 0)} croit={gr.randuri.reduce((s, c) => s + c.croit, 0)}
                             intrat={gr.randuri.reduce((s, c) => s + c.intrat, 0)} />
                  </td>
                  <td />
                </tr>
              )}
              {gr.randuri.map((c) => {
              const pe = (s: StadiuLinie) => [...c.stadii.values()].filter((x) => x === s).length;
              return (
                <tr key={c.numar}>
                  <td>
                    <Link href={`/centralizator?cauta=${encodeURIComponent(c.numar)}&toate=1`}>{c.numar}</Link>{' '}
                    <span className="slab">{c.brand} · P{c.prioritate}{c.stare === 'ciorna' && ' · ciornă'}{c.stare === 'de_aprobat' && ' · de aprobat'}</span>
                  </td>
                  <td>{modele.get(c.numar)}</td>
                  <td>{c.kam ?? <span className="slab">—</span>}</td>
                  <td className="slab">{c.lansare}</td>
                  <td>
                    <Termen data={c.cerutLa} gata={c.intrat >= c.cerut} />
                    {poateDa && c.intrat < c.cerut && (
                      <details className="schimba-termen">
                        <summary className="slab">schimbă</summary>
                        <form action={termen} className="in-rand">
                          <input type="hidden" name="numar" value={c.numar} />
                          <input type="hidden" name="inapoi" value={aici} />
                          <input type="date" name="data" defaultValue={c.cerutLa} min={c.lansare} required aria-label={`Termenul nou pentru ${c.numar}`} />
                          <button className="secundar">Salvează termenul</button>
                        </form>
                      </details>
                    )}
                  </td>
                  <td className="nr">{c.cerut}</td>
                  <td><Progres cerut={c.cerut} croit={c.croit} intrat={c.intrat} /></td>
                  <td>
                    {(Object.keys(STADII_LINIE) as StadiuLinie[]).filter((s) => pe(s) > 0)
                      .map((s) => <Stadiu key={s} cheie={s} nume={`${pe(s)} ${STADII_LINIE[s].toLowerCase()}`} />)}
                  </td>
                </tr>
              );
            })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
