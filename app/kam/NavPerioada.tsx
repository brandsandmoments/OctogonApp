import Link from 'next/link';
import { adresaPerioadei, PERIOADE, perioada, vecina, type Perioada, type TipPerioada } from '../lib/kam';

/** Felul perioadei (săptămână, lună, trimestru, an) și pașii înainte și înapoi. */
export default function NavPerioada({ per, baza }: { per: Perioada; baza: string }) {
  const azi = new Date().toLocaleDateString('sv-SE');
  return (
    <>
      <nav className="file">
        {(Object.keys(PERIOADE) as TipPerioada[]).map((t) => (
          <Link key={t} href={`${baza}?${adresaPerioadei(perioada(t, t === per.tip ? per.de_la : azi))}`} className={t === per.tip ? 'activ' : ''}>
            {PERIOADE[t]}
          </Link>
        ))}
      </nav>
      <p className="filtre">
        <Link href={`${baza}?${adresaPerioadei(vecina(per, -1))}`} className="buton">←</Link>
        <strong>{per.nume}</strong>
        <Link href={`${baza}?${adresaPerioadei(vecina(per, 1))}`} className="buton">→</Link>
      </p>
    </>
  );
}
