import Link from 'next/link';
import { meniulLui, ZONE, type Zona } from './lib/acces';
import { deFacutAzi } from './lib/acasa';
import { cere } from './lib/sesiune';
import './acasa.css';

export const dynamic = 'force-dynamic';

const NUME_ZONA: Record<Zona, string> = { ...ZONE, oameni: 'Oameni și conturi' };

/**
 * Pagina de pornire: ce are omul de făcut azi, pe carduri — numărul mare, ce
 * înseamnă și un buton spre ecranul unde se face. Roșu e întârziat, galben e de
 * făcut curând, verde e liniște. Dedesubt, toate ecranele la care are drept.
 */
export default async function Acasa({ searchParams }: { searchParams: Promise<{ fara_acces?: string; doar_vede?: string }> }) {
  const [u, { fara_acces, doar_vede }] = await Promise.all([cere(), searchParams]);
  const grupe = await deFacutAzi(u);
  const azi = new Date().toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Bucharest' });

  return (
    <main className="acasa">
      <h1>Bună, {u.nume.split(' ')[0]}</h1>
      <p className="sumar">Ce ai de făcut azi, {azi}</p>
      {fara_acces && (
        <p className="eroare">
          {doar_vede ? 'Poți doar să vezi' : 'Nu ai drept la'} „{NUME_ZONA[fara_acces as Zona] ?? fara_acces}”
          {doar_vede && ', nu să modifici'}. Dacă ar trebui să ai, cere-i unui cont master dreptul.
        </p>
      )}

      {grupe.map((g) => (
        <section key={g.nume} className="grupa-carduri">
          <h2>{g.nume}</h2>
          <div className="carduri">
            {g.carduri.map((c) => (
              <Link key={c.titlu} href={c.href} className={`card ton-${c.ton}`}>
                <span className="card-titlu">{c.titlu}</span>
                <span className="card-numar">{c.numar.toLocaleString('ro-RO')} <span className="card-unitate">{c.unitate}</span></span>
                {c.detaliu && <span className="card-detaliu">{c.detaliu}</span>}
                <span className="card-actiune">{c.ton === 'verde' && c.numar === 0 ? 'Nimic de făcut' : `${c.actiune} →`}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <details className="toate-ecranele" open={grupe.length === 0}>
        <summary>Toate ecranele tale</summary>
        {meniulLui(u).map((s) => (
          <section key={s.nume}>
            <h3>{s.nume}</h3>
            <ul className="meniu">
              {s.ecrane.map((e) => (
                <li key={e.href}>
                  <Link href={e.href}>{e.nume}</Link> <span className="slab">— {e.ce}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </details>
    </main>
  );
}
