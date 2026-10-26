import Link from 'next/link';
import { cere } from '../../lib/sesiune';
import { acuratete, adresaPerioadei, detaliiKam, perioadaDinAdresa } from '../../lib/kam';
import NavPerioada from '../NavPerioada';
import { Acuratete, buc, Procent, Ritm, Semnal } from '../semafor';

export const dynamic = 'force-dynamic';

/** Un KAM într-o perioadă: fiecare linie PSF activă și direcția din ultimele 8 perioade. */
export default async function KamPagina({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ perioada?: string; de_la?: string; saptamana?: string }>;
}) {
  await cere('kam');
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const per = perioadaDinAdresa(q);
  const d = await detaliiKam(id === 'fara' ? null : id, per);
  const p = d.praguri;

  return (
    <main className="lat">
      <p className="slab"><Link href={`/kam?${adresaPerioadei(per)}`}>← Toți KAM-ii</Link></p>
      <h1>{d.kam}</h1>
      <NavPerioada per={per} baza={`/kam/${id}`} />

      <h2>Ultimele 8 perioade</h2>
      <table>
        <thead><tr><th>Perioada</th><th className="nr">PSF active</th><th className="nr">De vândut</th><th className="nr">Vândut</th><th className="nr">Ritm</th><th className="nr">Acuratețe la zi</th></tr></thead>
        <tbody>
          {d.istoric.map((w) => (
            <tr key={w.perioada.de_la} className={w.perioada.de_la === per.de_la ? 'prima' : ''}>
              <td><Link href={`/kam/${id}?${adresaPerioadei(w.perioada)}`}>{w.perioada.nume}</Link></td>
              <td className="nr">{w.linii || '—'}</td>
              <td className="nr">{w.linii ? buc(w.tinta_sapt) : '—'}</td>
              <td className="nr">{w.linii ? buc(w.vandut_sapt) : '—'}</td>
              <td className="nr">{w.linii ? <Ritm vandut={w.vandut_sapt} tinta={w.tinta_sapt} p={p} /> : '—'}</td>
              <td className="nr"><Acuratete v={w.acuratete} p={p} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>PSF active în perioadă</h2>
      {d.linii.length === 0 ? <p className="slab">Niciun PSF cu perioada de vânzare în perioada asta.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead>
              <tr>
                <th>PSF</th><th>Produs</th><th>Perioada</th><th className="nr">Volum</th>
                <th className="nr">De vândut în perioadă</th><th className="nr">Vândut în perioadă</th><th className="nr">Ritm</th>
                <th className="nr">De vândut la zi</th><th className="nr">Vândut la zi</th><th className="nr">Acuratețe</th>
                <th className="nr">Din volum</th><th>Semnal</th>
              </tr>
            </thead>
            <tbody>
              {d.linii.map((r) => (
                <tr key={r.linie_id}>
                  <td><Link href={`/centralizator?cauta=${encodeURIComponent(r.comanda)}`}>{r.comanda}</Link></td>
                  <td>{r.produs} <span className="slab">{r.cod_sku}</span></td>
                  <td className="slab">{r.de_la} – {r.pana_la}{r.se_incheie && <strong> · se încheie</strong>}</td>
                  <td className="nr">{r.volum}</td>
                  <td className="nr">{buc(r.tinta_sapt)}</td>
                  <td className="nr">{buc(r.vandut_sapt)}</td>
                  <td className="nr"><Ritm vandut={r.vandut_sapt} tinta={r.tinta_sapt} p={p} /></td>
                  <td className="nr">{buc(r.tinta_cum)}</td>
                  <td className="nr">{buc(r.vandut_cum)}</td>
                  <td className="nr"><Acuratete v={acuratete(r.vandut_cum, r.tinta_cum)} p={p} /></td>
                  <td className="nr"><Procent v={r.volum ? r.vandut_cum / r.volum : null} galben={p.vandutGalben} verde={p.vandutVerde} /></td>
                  <td><Semnal vandut={r.vandut_cum} tinta={r.tinta_cum} p={p} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="slab">Ultima vânzare înregistrată: {d.ultima_vanzare ?? '—'}.</p>
    </main>
  );
}
