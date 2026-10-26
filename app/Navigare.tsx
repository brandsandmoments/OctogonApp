'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Sectiune = { nume: string; ecrane: { href: string; nume: string }[]; si?: string[] };

const sub = (cale: string, href: string) => cale === href || cale.startsWith(href + '/');

/**
 * Bara de secțiuni și, sub ea, filele secțiunii deschise. Fila e cea mai lungă
 * adresă care se potrivește: „/comenzi/noua" nu aprinde și „PSF și PSC".
 */
export default function Navigare({ sectiuni }: { sectiuni: Sectiune[] }) {
  const cale = usePathname();
  const activa = sectiuni.find((s) => s.ecrane.some((e) => sub(cale, e.href)) || s.si?.some((h) => sub(cale, h)));
  const fila = activa?.ecrane.filter((e) => sub(cale, e.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav className="navigare">
      <div className="sectiuni">
        {sectiuni.map((s) => (
          <Link key={s.nume} href={s.ecrane[0].href} className={s === activa ? 'activ' : ''}>{s.nume}</Link>
        ))}
      </div>
      {activa && activa.ecrane.length > 1 && (
        <div className="file-sectiune">
          {activa.ecrane.map((e) => (
            <Link key={e.href} href={e.href} className={e === fila ? 'activ' : ''}>{e.nume}</Link>
          ))}
        </div>
      )}
    </nav>
  );
}
