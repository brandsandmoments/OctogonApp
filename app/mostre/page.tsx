import Link from 'next/link';
import Cauta from '../Cauta';
import { mostreSiComenziCroit, nomenclatoareMostre, stadiuMostra } from '../lib/mostre';
import { potriveste } from '../lib/format';
import { cere } from '../lib/sesiune';
import ListaMostre, { poateSchimbaMostre } from './ListaMostre';
import '../productie/productie.css';

export const dynamic = 'force-dynamic';

const STADII = ['De croit', 'Croită', 'În lucru', 'Ieșită din lucru', 'În depozit'];

/**
 * Mostrele, pentru toată lumea: toate, oricare le-ar fi stadiul — de croit, croite, în lucru,
 * ieșite, în depozit —, cu brandul, produsul, mărimile și cine le-a dat. Mostrele au numărul lor
 * (mst-…), nu intră în PSF-uri și nici în Centralizator. Se dau din Croit → Mostre.
 */
export default async function Mostre({ searchParams }: { searchParams: Promise<{ cauta?: string; brand?: string; stadiu?: string; eroare?: string; ok?: string }> }) {
  const u = await cere();
  const f = await searchParams;
  const [toate, { branduri }] = await Promise.all([mostreSiComenziCroit(false), nomenclatoareMostre()]);
  const cautate = toate.filter((x) => potriveste(f.cauta, x.numar, x.produs, x.creat_de ?? '', x.observatii ?? ''))
    .filter((x) => !f.brand || x.brand === f.brand);
  const lista = f.stadiu ? cautate.filter((x) => stadiuMostra(x)[0] === f.stadiu) : cautate;
  const adresa = (p: { brand?: string | null; stadiu?: string | null }) => {
    const q = new URLSearchParams();
    const b = p.brand === undefined ? f.brand : p.brand;
    const s = p.stadiu === undefined ? f.stadiu : p.stadiu;
    if (f.cauta) q.set('cauta', f.cauta);
    if (b) q.set('brand', b);
    if (s) q.set('stadiu', s);
    return `/mostre${q.size ? `?${q}` : ''}`;
  };
  const daMostre = poateSchimbaMostre(u);
  return (
    <main className="lat">
      <h1>Mostre</h1>
      <p className="sumar">
        {toate.length} mostre · {toate.reduce((s, x) => s + x.cerut, 0)} buc
        {daMostre && <> · <Link href="/croit?vedere=mostre" className="buton">+ Dă o mostră la croit</Link></>}
      </p>
      {f.eroare && <p className="eroare">{f.eroare}</p>}
      {f.ok && <p className="mesaj-ok">{f.ok}</p>}
      <Cauta valoare={f.cauta} pastreaza={{ brand: f.brand, stadiu: f.stadiu }} placeholder="caută: mst-…, produs, cine a dat-o" />
      <div className="filtre">
        <Link href={adresa({ brand: null })} className={`buton ${!f.brand ? 'activ-buton' : ''}`}>Toate brandurile</Link>
        {[...new Set(toate.map((x) => x.brand))].sort().map((b) => (
          <Link key={b} href={adresa({ brand: b })} className={`buton ${f.brand === b ? 'activ-buton' : ''}`}>{b}</Link>
        ))}
      </div>
      <nav className="faze" aria-label="Stadiul mostrelor">
        <Link href={adresa({ stadiu: null })} className={`faza ${!f.stadiu ? 'activ-faza' : ''}`}><strong>{cautate.length}</strong> toate</Link>
        {STADII.map((s) => (
          <Link key={s} href={adresa({ stadiu: s })} className={`faza ${f.stadiu === s ? 'activ-faza' : ''}`}>
            <strong>{cautate.filter((x) => stadiuMostra(x)[0] === s).length}</strong> {s.toLowerCase()}
          </Link>
        ))}
      </nav>
      <ListaMostre lista={lista} branduri={branduri} schimba={daMostre} aici={adresa({})} />
    </main>
  );
}
