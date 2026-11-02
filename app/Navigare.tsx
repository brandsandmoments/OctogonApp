'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Ecran = { href: string; nume: string; alte?: string[] };
type Sectiune = { nume: string; ecrane: Ecran[]; si?: string[] };

const sub = (cale: string, href: string) => cale === href || cale.startsWith(href + '/');
/** Cât de bine se potrivește fila: lungimea celei mai lungi adrese ale ei (a ei sau din `alte`); 0 = deloc. */
const potrivire = (cale: string, e: Ecran) => Math.max(0, ...[e.href, ...(e.alte ?? [])].filter((h) => sub(cale, h)).map((h) => h.length));

/**
 * Bara de secțiuni și, sub ea, filele secțiunii deschise. Fila e cea mai lungă
 * adresă care se potrivește: „/comenzi/noua" nu aprinde și „PSF și PSC". `alte`
 * sunt adresele care aprind fila fără să fie a ei (banda, la Producție).
 */
export default function Navigare({ sectiuni }: { sectiuni: Sectiune[] }) {
  const cale = usePathname();
  const activa = sectiuni.find((s) => s.ecrane.some((e) => potrivire(cale, e) > 0) || s.si?.some((h) => sub(cale, h)));
  const fila = activa?.ecrane.filter((e) => potrivire(cale, e) > 0).sort((a, b) => potrivire(cale, b) - potrivire(cale, a))[0];
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
