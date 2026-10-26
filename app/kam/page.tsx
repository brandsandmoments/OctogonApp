import Link from 'next/link';
import { cere } from '../lib/sesiune';
import { adaugaZile, luni, saptamana } from '../lib/kam';
import { Acuratete, buc, Procent, Ritm } from './semafor';

export const dynamic = 'force-dynamic';

/**
 * Eficiența KAM-ilor într-o săptămână: pe fiecare, PSF-urile active, ritmul
 * săptămânii (vândut / de vândut în săptămână) și acuratețea la zi (cumulat de la
 * începutul fiecărei perioade). Ultimul rând e HEAD OF SALES: toți KAM-ii împreună.
 */
export default async function Kam({ searchParams }: { searchParams: Promise<{ saptamana?: string }> }) {
  await cere('kam');
  const { saptamana: s } = await searchParams;
  // Implicit, ultima săptămână încheiată: cea curentă abia a început.
  const azi = new Date().toLocaleDateString('sv-SE');
  const l = luni(s ?? adaugaZile(azi, -7));
  const d = await saptamana(l);
  const p = d.praguri;

  const Rand = ({ r, link }: { r: typeof d.total; link: boolean }) => (
    <tr className={link ? '' : 'prima'}>
      <td>{link ? <Link href={`/kam/${r.kam_id ?? 'fara'}?saptamana=${l}`}>{r.kam}</Link> : <strong>{r.kam}</strong>}</td>
      <td className="nr">{r.linii}</td>
      <td className="nr">{buc(r.tinta_sapt)}</td>
      <td className="nr">{buc(r.vandut_sapt)}</td>
      <td className="nr"><Ritm vandut={r.vandut_sapt} tinta={r.tinta_sapt} p={p} /></td>
      <td className="nr">{buc(r.tinta_cum)}</td>
      <td className="nr">{buc(r.vandut_cum)}</td>
      <td className="nr"><Acuratete v={r.acuratete} p={p} /></td>
      <td className="nr"><Procent v={r.volum ? r.vandut_cum / r.volum : null} galben={p.vandutGalben} verde={p.vandutVerde} /></td>
    </tr>
  );

  return (
    <main className="lat">
      <h1>Eficiența KAM</h1>
      <nav className="file">
        <Link href={`/kam?saptamana=${adaugaZile(l, -7)}`}>← săptămâna dinainte</Link>
        <span className="activ-text">{l} – {d.duminica}</span>
        <Link href={`/kam?saptamana=${adaugaZile(l, 7)}`}>săptămâna următoare →</Link>
      </nav>
      <p className="sumar">
        Vânzări înregistrate până la {d.ultima_vanzare ?? '—'}
        {d.ultima_vanzare && d.ultima_vanzare < d.duminica && <strong className="lipsa"> — săptămâna nu e completă în date</strong>}
        {' · '}praguri: acuratețe {Math.round(p.acurateteGalben * 100)}% / {Math.round(p.acurateteVerde * 100)}%
      </p>

      <div className="tabel-derulant">
        <table className="centralizator">
          <thead>
            <tr>
              <th>KAM</th><th className="nr">PSF active</th>
              <th className="nr">De vândut în săpt.</th><th className="nr">Vândut în săpt.</th><th className="nr">Ritm</th>
              <th className="nr">De vândut la zi</th><th className="nr">Vândut la zi</th><th className="nr">Acuratețe la zi</th>
              <th className="nr">Vândut din volum</th>
            </tr>
          </thead>
          <tbody>
            {d.kami.map((r) => <Rand key={r.kam_id ?? 'fara'} r={r} link />)}
            <Rand r={d.total} link={false} />
          </tbody>
        </table>
      </div>
      <p className="slab">
        Ritmul compară săptămâna cu ținta ei; acuratețea la zi compară tot ce s-a vândut de la începutul
        fiecărei perioade cu cât trebuia vândut până acum. La finalul perioadei, acuratețea la zi e KPI-ul din dashboard.
      </p>
    </main>
  );
}
