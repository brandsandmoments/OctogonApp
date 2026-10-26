import Link from 'next/link';
import { centralizatorPeStadii, STADII_LINIE, type StadiuLinie } from '../lib/centralizator';
import { cere, poateModifica } from '../lib/sesiune';

export const dynamic = 'force-dynamic';

const TIPURI = {
  PSF: 'Punere pe stoc din forecast',
  PSC: 'Punere pe stoc din comanda clientului',
} as const;

/**
 * Comenzile date de KAM, pe două file: PSF (din forecast) și PSC (pe produse care
 * au deja comenzi pe site). Câte o comandă pe rând, cu cât s-a cerut, cât s-a
 * croit, cât a intrat în depozit și în ce stadiu sunt liniile ei. Pozițiile pe
 * mărimi sunt în centralizator.
 */
export default async function Comenzi({ searchParams }: { searchParams: Promise<{ tip?: string; toate?: string }> }) {
  await cere('comenzi');
  const f = await searchParams;
  const tip: keyof typeof TIPURI = f.tip === 'PSC' ? 'PSC' : 'PSF';
  const [{ randuri }, poateDa] = await Promise.all([
    centralizatorPeStadii({ tip, toate: f.toate === '1' }),
    poateModifica('comenzi'),
  ]);

  type Comanda = {
    numar: string; brand: string; kam: string | null; lansare: string; prioritate: number; stare: string;
    cerutLa: string; cerut: number; croit: number; intrat: number; stadii: Map<string, StadiuLinie>;
  };
  const comenzi = new Map<string, Comanda>();
  for (const r of randuri) {
    const c = comenzi.get(r.comanda) ?? {
      numar: r.comanda, brand: r.brand, kam: r.kam, lansare: r.data_lansare, prioritate: r.prioritate, stare: r.stare,
      cerutLa: r.data_ceruta, cerut: 0, croit: 0, intrat: 0, stadii: new Map(),
    };
    c.cerut += r.cerut; c.croit += r.croit; c.intrat += r.intrat;
    if (r.data_ceruta < c.cerutLa) c.cerutLa = r.data_ceruta;
    c.stadii.set(r.linie_id, r.stadiu);
    comenzi.set(r.comanda, c);
  }
  const lista = [...comenzi.values()].sort((a, b) => b.lansare.localeCompare(a.lansare) || a.numar.localeCompare(b.numar));

  return (
    <main className="lat">
      <h1>Comenzi</h1>
      <nav className="file">
        {(Object.keys(TIPURI) as (keyof typeof TIPURI)[]).map((t) => (
          <Link key={t} href={`/comenzi?tip=${t}`} className={t === tip ? 'activ' : ''}>{t}</Link>
        ))}
      </nav>
      <p className="sumar">
        {TIPURI[tip]} · {lista.length} comenzi{f.toate === '1' ? '' : ' deschise'} ·{' '}
        <Link href={`/comenzi?tip=${tip}${f.toate === '1' ? '' : '&toate=1'}`}>
          {f.toate === '1' ? 'doar deschise' : 'și închise'}
        </Link>
      </p>
      {poateDa && (
        <p><Link href={`/comenzi/noua?tip=${tip}`} className="buton">+ {tip} nouă</Link></p>
      )}
      <div className="tabel-derulant">
        <table>
          <thead>
            <tr>
              <th>Comandă</th>
              <th>KAM</th>
              <th>Lansată</th>
              <th>Cerută la</th>
              <th className="nr">Cerut</th>
              <th className="nr">Croit</th>
              <th className="nr">Intrat</th>
              <th>Liniile</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => {
              const pe = (s: StadiuLinie) => [...c.stadii.values()].filter((x) => x === s).length;
              return (
                <tr key={c.numar}>
                  <td>
                    <Link href={`/centralizator?cauta=${encodeURIComponent(c.numar)}&toate=1`}>{c.numar}</Link>{' '}
                    <span className="slab">{c.brand} · P{c.prioritate}{c.stare === 'ciorna' && ' · ciornă'}</span>
                  </td>
                  <td>{c.kam ?? <span className="slab">—</span>}</td>
                  <td className="slab">{c.lansare}</td>
                  <td className="slab">{c.cerutLa}</td>
                  <td className="nr">{c.cerut}</td>
                  <td className="nr">{c.croit || '—'}</td>
                  <td className="nr">{c.intrat || '—'}</td>
                  <td className="slab">
                    {(Object.keys(STADII_LINIE) as StadiuLinie[]).filter((s) => pe(s) > 0)
                      .map((s) => `${pe(s)} ${STADII_LINIE[s].toLowerCase()}`).join(' · ')}
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
