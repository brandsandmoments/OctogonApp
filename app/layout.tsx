import type { Metadata } from 'next';
import Link from 'next/link';
import { meniulLui, ROLURI, type Rol } from './lib/acces';
import { iesire } from './lib/logare';
import { utilizatorCurent } from './lib/sesiune';
import Navigare from './Navigare';
import Tabele from './Tabele';
import './global.css';

export const metadata: Metadata = {
  title: 'OctogonApp',
  description: 'Producție: de la comanda lansată până la intrarea în depozit.',
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  const u = await utilizatorCurent();
  return (
    <html lang="ro">
      <body>
        {/* Pe copia de test (OCTOGON_TEST=1): să nu o confunde nimeni cu aplicația adevărată. */}
        {process.env.OCTOGON_TEST === '1' && (
          <div className="banda-test">Copie de test — datele se pot schimba oricum; clienții sunt anonimizați. Aplicația adevărată e separată.</div>
        )}
        {u && (
          <header className="bara-sus">
            <Link href="/" className="acasa">OctogonApp</Link>
            <span className="cine">
              {u.nume}
              <span className="slab"> · {u.roluri.map((r) => ROLURI[r as Rol] ?? r).join(', ') || 'fără rol'}</span>
            </span>
            <form action={iesire}><button className="iesire">Ieși</button></form>
          </header>
        )}
        {u && (
          <Navigare
            sectiuni={meniulLui(u).map((s) => ({ nume: s.nume, si: s.si, ecrane: s.ecrane.map(({ href, nume }) => ({ href, nume })) }))}
          />
        )}
        {children}
        <Tabele />
      </body>
    </html>
  );
}
