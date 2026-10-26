import type { Metadata } from 'next';
import Link from 'next/link';
import { ROLURI, type Rol } from './lib/acces';
import { iesire } from './lib/logare';
import { utilizatorCurent } from './lib/sesiune';
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
        {children}
      </body>
    </html>
  );
}
