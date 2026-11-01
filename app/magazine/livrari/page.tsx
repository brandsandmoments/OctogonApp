import Link from 'next/link';
import Tipareste from '../../Tipareste';
import { azi } from '../../lib/format';
import { livrariPeZi, type Colet } from '../../lib/livrari';
import { magazine } from '../../lib/magazine';
import { cere } from '../../lib/sesiune';
import '../magazine.css';
import '../foaie.css';

export const dynamic = 'force-dynamic';

const STARI: Record<string, string> = { awb: 'AWB generat', in_tranzit: 'în tranzit', in_livrare: 'în livrare', livrat: 'livrat', refuzat: 'refuzat', nelivrat: 'nelivrat' };
const ziua = (zi: string, pas: number) => new Date(Date.parse(zi) + pas * 86_400_000).toISOString().slice(0, 10);
const frumos = (zi: string) => new Date(`${zi}T12:00:00`).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' });

function Tabel({ lista, cuMagazin, coloana }: { lista: Colet[]; cuMagazin: boolean; coloana: { nume: string; val: (c: Colet) => React.ReactNode } }) {
  if (lista.length === 0) return <p className="foaie-gol">Niciun colet.</p>;
  return (
    <table>
      <thead><tr>{cuMagazin && <th>Magazin</th>}<th>Comandă</th><th>Client</th><th>Telefon</th><th>Oraș</th><th>Ce a comandat</th><th>Curier · AWB</th><th>{coloana.nume}</th></tr></thead>
      <tbody>
        {lista.map((c) => (
          <tr key={`${c.magazin_id}${c.comanda}${c.awb}`}>
            {cuMagazin && <td className="mic">{c.magazin}</td>}
            <td><strong>{c.comanda}</strong><div className="mic">{c.comandata}</div></td>
            <td>{c.client ?? '—'}</td>
            <td>{c.telefon ?? '—'}</td>
            <td className="mic">{c.oras ?? '—'}</td>
            <td className="produs">{c.produse}{c.bucati > 1 && <span className="mic"> · {c.bucati} buc</span>}</td>
            <td className="mic">{c.curier ?? '—'}{c.awb && <div>{c.urmarire ? <a href={c.urmarire} target="_blank" rel="noreferrer">{c.awb}</a> : c.awb}</div>}</td>
            <td>{coloana.val(c)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Situația coletelor la curier, pe zi și pe magazin: ce a ridicat curierul, ce s-a
 * livrat, ce a fost refuzat și ce nu s-a livrat (retur), cu numărul comenzii, ce a
 * comandat clientul și telefonul — apoi ce e încă pe drum și AWB-urile neridicate.
 * Se tipărește pe A4.
 */
export default async function Livrari({ searchParams }: { searchParams: Promise<{ magazin?: string; zi?: string }> }) {
  await cere('expediere');
  const f = await searchParams;
  const zi = /^\d{4}-\d{2}-\d{2}$/.test(f.zi ?? '') ? f.zi! : azi();
  const lista = await magazine();
  const ales = lista.find((m) => m.id === f.magazin) ?? null;
  const z = await livrariPeZi(zi, ales?.id);
  const cuMagazin = !ales;
  const adresa = (o: { magazin?: string | null; zi?: string }) => {
    const q = new URLSearchParams();
    const m = o.magazin === undefined ? ales?.id : o.magazin;
    if (m) q.set('magazin', m);
    const d = o.zi ?? zi;
    if (d !== azi()) q.set('zi', d);
    return `/magazine/livrari${q.size ? `?${q}` : ''}`;
  };
  const buc = (l: Colet[]) => l.reduce((s, c) => s + c.bucati, 0);
  const generat = new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <main className="lat">
      <h1 className="nu-tipari">Livrări la curier</h1>
      <nav className="file">
        <Link href={adresa({ magazin: null })} className={!ales ? 'activ' : ''}>Toate</Link>
        {lista.map((m) => <Link key={m.id} href={adresa({ magazin: m.id })} className={m.id === ales?.id ? 'activ' : ''}>{m.brand}</Link>)}
      </nav>
      <div className="liste-actiuni nu-tipari">
        <span className="filtre">
          <Link href={adresa({ zi: ziua(zi, -1) })} className="buton">← ziua dinainte</Link>
          <Link href={adresa({ zi: azi() })} className={`buton ${zi === azi() ? 'activ-buton' : ''}`}>azi</Link>
          {zi < azi() && <Link href={adresa({ zi: ziua(zi, 1) })} className="buton">ziua următoare →</Link>}
          <form method="get" className="in-rand">
            {ales && <input type="hidden" name="magazin" value={ales.id} />}
            <input type="date" name="zi" defaultValue={zi} max={azi()} aria-label="Ziua" />
            <button className="buton">Arată</button>
          </form>
        </span>
        <Tipareste />
      </div>

      <div className="numere-magazin nu-tipari">
        <span className="numar-situatie"><strong>{z.ridicate.length}</strong> ridicate de curier<span className="slab"> · {buc(z.ridicate)} buc</span></span>
        <span className="numar-situatie ton-verde"><strong>{z.livrate.length}</strong> livrate<span className="slab"> · {buc(z.livrate)} buc</span></span>
        <span className="numar-situatie ton-rosu"><strong>{z.refuzate.length}</strong> refuzate</span>
        <span className="numar-situatie ton-galben"><strong>{z.nelivrate.length}</strong> nelivrate (retur)</span>
        <span className="numar-situatie"><strong>{z.pe_drum.length}</strong> încă pe drum</span>
        <span className={`numar-situatie ${z.neridicate.some((c) => (c.zile ?? 0) >= 1) ? 'ton-rosu' : ''}`}><strong>{z.neridicate.length}</strong> AWB neridicate</span>
      </div>

      <article className="foaie">
        <header className="foaie-antet">
          <h1>Livrări · {frumos(zi)}</h1>
          <p className="foaie-sub">{ales ? ales.brand : 'toate magazinele'} · coletele la curier, din evenimentele trimise de curier în Shopify</p>
          <p className="foaie-mic">Generat {generat}</p>
          <p className="foaie-rezumat">
            {z.ridicate.length} ridicate de curier · {z.livrate.length} livrate · {z.refuzate.length} refuzate · {z.nelivrate.length} nelivrate (retur)
            {zi === azi() && ` · ${z.pe_drum.length} încă pe drum · ${z.neridicate.length} AWB neridicate`}
          </p>
        </header>

        <section className="foaie-grupa">
          <h2>1. Ridicate de curier · {z.ridicate.length}</h2>
          <Tabel lista={z.ridicate} cuMagazin={cuMagazin} coloana={{ nume: 'Ridicat', val: (c) => <span className="mic">{c.ora}{c.stare !== 'in_tranzit' && ` · acum ${STARI[c.stare]}`}</span> }} />
        </section>
        <section className="foaie-grupa">
          <h2>2. Livrate · {z.livrate.length}</h2>
          <Tabel lista={z.livrate} cuMagazin={cuMagazin} coloana={{ nume: 'Livrat', val: (c) => <span className="mic">{c.ora}{c.zile !== null && ` · în ${c.zile} ${c.zile === 1 ? 'zi' : 'zile'}`}</span> }} />
        </section>
        <section className="foaie-grupa">
          <h2>3. Refuzate · {z.refuzate.length}</h2>
          <Tabel lista={z.refuzate} cuMagazin={cuMagazin} coloana={{ nume: 'Motiv', val: (c) => <span className="rosu-tare">{c.motiv ?? 'refuzat'} · {c.ora}</span> }} />
        </section>
        <section className="foaie-grupa">
          <h2>4. Nelivrate (retur) · {z.nelivrate.length}</h2>
          <Tabel lista={z.nelivrate} cuMagazin={cuMagazin} coloana={{ nume: 'Motiv', val: (c) => <span className="rosu-tare">{c.motiv ?? 'nelivrat'} · {c.ora}</span> }} />
        </section>
        {zi === azi() && (
          <>
            <section className="foaie-grupa">
              <h2>5. Încă pe drum · {z.pe_drum.length}</h2>
              <p className="foaie-mic">Ridicate de curier, încă nelivrate. Cele de 4 zile sau mai mult, de urmărit la curier.</p>
              <Tabel lista={z.pe_drum} cuMagazin={cuMagazin} coloana={{ nume: 'La curier', val: (c) => <span className={(c.zile ?? 0) >= 4 ? 'rosu-tare' : 'mic'}>{STARI[c.stare]} · de {c.zile} {c.zile === 1 ? 'zi' : 'zile'}</span> }} />
            </section>
            <section className="foaie-grupa">
              <h2>6. AWB generat, neridicat de curier · {z.neridicate.length}</h2>
              <p className="foaie-mic">Etichetă făcută, dar curierul n-a scanat coletul. Mai vechi de o zi: verifică dacă a plecat din depozit.</p>
              <Tabel lista={z.neridicate} cuMagazin={cuMagazin} coloana={{ nume: 'AWB din', val: (c) => <span className={(c.zile ?? 0) >= 1 ? 'rosu-tare' : 'mic'}>{c.awb_la}</span> }} />
            </section>
          </>
        )}
      </article>
    </main>
  );
}
