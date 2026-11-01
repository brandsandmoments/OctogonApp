import Link from 'next/link';
import Cauta from '../../Cauta';
import { potriveste } from '../../lib/format';
import { magazine } from '../../lib/magazine';
import { produseMagazine, type ProdusMagazin } from '../../lib/produse';
import { cere, poateModifica } from '../../lib/sesiune';
import '../magazine.css';

export const dynamic = 'force-dynamic';

const ORDINI: [string, string, (a: ProdusMagazin, b: ProdusMagazin) => number][] = [
  ['vandute', 'cele mai vândute', (a, b) => b.v30 - a.v30 || b.v7 - a.v7],
  ['zile', 'se termină primele', (a, b) => (a.zile ?? 1e9) - (b.zile ?? 1e9)],
  ['stoc', 'cel mai mult stoc', (a, b) => b.stoc - a.stoc],
  ['nume', 'după nume', (a, b) => a.produs.localeCompare(b.produs, 'ro')],
];

const zileStoc = (p: ProdusMagazin, prag = 14) => {
  if (p.zile === null) return <span className="slab">nu se vinde</span>;
  const ton = p.zile < 7 ? 'rosu' : p.zile < prag ? 'galben' : 'verde';
  return <span className={`insigna ${ton}`}>{p.zile} zile</span>;
};

/**
 * Produsele unui magazin, cu stocul fizic, vânzările pe 7 / 30 / 60 de zile, ritmul
 * pe zi și câte zile mai ține stocul la ritmul ăsta. Mărimile apar pe rând, cu cele
 * terminate în roșu. Semnalele (se termină, nu se mișcă, trend) sunt aceleași ca în
 * „Alerte".
 */
export default async function Produse({ searchParams }: { searchParams: Promise<{ magazin?: string; ordine?: string; cauta?: string; toate?: string }> }) {
  await cere('expediere');
  const f = await searchParams;
  const daComenzi = await poateModifica('comenzi');
  const lista = await magazine();
  const ales = lista.find((m) => m.id === f.magazin) ?? lista.find((m) => m.legat) ?? lista[0];
  const [, , sortare] = ORDINI.find(([k]) => k === f.ordine) ?? ORDINI[0];
  const toate = ales ? await produseMagazine(ales.id) : [];
  const produse = toate
    .filter((p) => f.toate === '1' || p.activ)
    .filter((p) => potriveste(f.cauta, p.produs, p.tip))
    .sort(sortare);
  const adresa = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ magazin: ales?.id, ordine: f.ordine, cauta: f.cauta, toate: f.toate, ...o })
      .filter(([, v]) => v) as [string, string][]);
    return `/magazine/produse?${q}`;
  };

  return (
    <main className="lat">
      <h1>Produse și vânzări</h1>
      <nav className="file">
        {lista.map((m) => <Link key={m.id} href={adresa({ magazin: m.id })} className={m.id === ales?.id ? 'activ' : ''}>{m.brand}</Link>)}
      </nav>
      <p className="sumar">
        {produse.length} produse{f.toate === '1' ? '' : ' active'} · stoc {produse.reduce((s, p) => s + p.stoc, 0)} buc ·
        vândut {produse.reduce((s, p) => s + p.v7, 0)} în 7 zile, {produse.reduce((s, p) => s + p.v30, 0)} în 30 de zile ·{' '}
        <Link href={adresa({ toate: f.toate === '1' ? undefined : '1' })}>{f.toate === '1' ? 'doar active' : 'și inactive'}</Link>
      </p>
      <p className="filtre">
        {ORDINI.map(([k, nume]) => (
          <Link key={k} href={adresa({ ordine: k })} className={`buton ${(f.ordine ?? 'vandute') === k ? 'activ-buton' : ''}`}>{nume}</Link>
        ))}
      </p>
      <Cauta valoare={f.cauta} pastreaza={{ magazin: ales?.id, ordine: f.ordine, toate: f.toate }} placeholder="caută produs" />
      {produse.length === 0 ? <p className="slab">Niciun produs. Leagă magazinul din „Legături Shopify".</p> : (
        <div className="tabel-derulant">
          <table className="centralizator produse-magazin">
            <thead>
              <tr><th>Produs</th><th className="nr">Stoc</th><th className="nr">7 zile</th><th className="nr">30 zile</th>
                  <th className="nr">60 zile</th><th className="nr">Pe zi</th><th>Ține</th><th>Mărimi · stoc</th><th>Semnale</th>{daComenzi && <th />}</tr>
            </thead>
            <tbody>
              {produse.map((p) => (
                <tr key={p.produs}>
                  <td><strong>{p.produs}</strong>{!p.activ && <span className="slab"> · inactiv</span>}
                    {p.ultima && <div className="slab">ultima vânzare {p.ultima.slice(8)}.{p.ultima.slice(5, 7)}</div>}</td>
                  <td className="nr">{p.stoc}</td>
                  <td className="nr">{p.v7 || '—'}</td>
                  <td className="nr"><strong>{p.v30 || '—'}</strong></td>
                  <td className="nr">{p.v60 || '—'}</td>
                  <td className="nr">{p.ritm || '—'}</td>
                  <td>{zileStoc(p)}</td>
                  <td className="marimi-stoc">
                    {p.marimi.map((m) => (
                      <span key={m.marime} className={m.stoc === 0 ? (m.v30 > 0 ? 'gol-cerut' : 'gol') : ''}
                            title={`vândut ${m.v30} în 30 de zile${m.zile !== null ? ` · ține ${m.zile} zile` : ''}${m.asteapta ? ` · ${m.asteapta} cerute de comenzi deschise` : ''}${m.stoc === 0 && !m.se_poate_comanda ? ' · nu se poate comanda la stoc zero' : ''}`}>
                        {m.marime} <strong>{m.stoc}</strong>
                      </span>
                    ))}
                  </td>
                  <td>
                    {p.semnale.asteapta.length > 0 && <span className="insigna rosu">așteaptă: {p.semnale.asteapta.map((m) => `${m.marime} −${m.lipsa}`).join(', ')}</span>}
                    {p.semnale.terminat.length > 0 && <span className={`insigna ${p.semnale.terminat.some((m) => !m.se_poate_comanda) ? 'rosu' : 'gri'}`}>terminat: {p.semnale.terminat.map((m) => m.marime).join(', ')}</span>}
                    {p.semnale.curand.length > 0 && <span className="insigna galben">curând: {p.semnale.curand.map((m) => m.marime).join(', ')}</span>}
                    {p.semnale.trend !== null && <span className="insigna violet">trend{p.semnale.trend ? ` ×${p.semnale.trend}` : ' nou'}</span>}
                    {p.semnale.stoc_mort && <span className="insigna galben">nu se mișcă</span>}
                  </td>
                  {daComenzi && <td>{p.produs_id && <Link href={`/comenzi/noua?din_produs=${p.produs_id}`} className="buton mic-buton">PSF →</Link>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
