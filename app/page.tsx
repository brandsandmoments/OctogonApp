import Link from 'next/link';
import { ECRANE, poate, ZONE, type Zona } from './lib/acces';
import { cere } from './lib/sesiune';

export const dynamic = 'force-dynamic';

const NUME_ZONA: Record<Zona, string> = { ...ZONE, oameni: 'Oameni și conturi' };

/** Pagina de pornire: doar ecranele pe care omul logat le poate deschide. */
export default async function Acasa({ searchParams }: { searchParams: Promise<{ fara_acces?: string; doar_vede?: string }> }) {
  const [u, { fara_acces, doar_vede }] = await Promise.all([cere(), searchParams]);
  const ale = ECRANE.filter((e) => (Array.isArray(e.zona) ? e.zona : [e.zona]).some((z) => poate(u, z, e.nivel)));
  return (
    <main>
      <h1>Bună, {u.nume.split(' ')[0]}</h1>
      {fara_acces && (
        <p className="eroare">
          {doar_vede ? 'Poți doar să vezi' : 'Nu ai drept la'} „{NUME_ZONA[fara_acces as Zona] ?? fara_acces}”
          {doar_vede && ', nu să modifici'}. Dacă ar trebui să ai, cere-i unui cont master dreptul.
        </p>
      )}
      <ul className="meniu">
        {ale.map((e) => (
          <li key={e.href}>
            <Link href={e.href}>{e.nume}</Link> <span className="slab">— {e.ce}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
