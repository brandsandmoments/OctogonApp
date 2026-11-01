import Link from 'next/link';
import { Fragment } from 'react';
import { cerereMagazin, magazine, type RandCerere } from '../../lib/magazine';
import { cere, poateModifica } from '../../lib/sesiune';
import '../magazine.css';

export const dynamic = 'force-dynamic';

/**
 * Comenzile intrate într-un magazin, grupate pe model: pe fiecare culoare și mărime,
 * cât cer clienții, cât e pe stoc, cât e deja în producție (PSC/PSF lansate, încă
 * neintrate) și cât așteaptă aprobarea. „De dat" e restul — doar el intră într-o PSC
 * nouă, pe un model sau pe tot magazinul. O PSC făcută azi intră mâine la „în
 * producție", deci nu se mai cere a doua oară.
 */
export default async function PscDinComenzi({ searchParams }: { searchParams: Promise<{ magazin?: string; toate?: string }> }) {
  await cere('expediere');
  const f = await searchParams;
  const daComenzi = await poateModifica('comenzi');
  const lista = await magazine();
  const ales = lista.find((m) => m.id === f.magazin) ?? lista.find((m) => m.legat) ?? lista[0];
  const toate = ales ? await cerereMagazin(ales.id) : [];
  // Implicit doar ce mai trebuie dat; „și acoperite" arată și cererea acoperită deja.
  const randuri = f.toate === '1' ? toate : toate.filter((r) => r.de_dat > 0);
  const peModel = new Map<string, RandCerere[]>();
  for (const r of randuri) peModel.set(r.model_cheie, [...(peModel.get(r.model_cheie) ?? []), r]);
  const suma = (rs: RandCerere[], k: 'cerut' | 'stoc' | 'in_productie' | 'de_aprobat' | 'de_dat') => rs.reduce((s, r) => s + r[k], 0);
  const deDat = suma(toate, 'de_dat');

  return (
    <main className="lat">
      <h1>PSC din comenzile intrate</h1>
      <nav className="file">
        {lista.map((m) => <Link key={m.id} href={`/magazine/psc?magazin=${m.id}`} className={m.id === ales?.id ? 'activ' : ''}>{m.brand}</Link>)}
      </nav>
      <p className="sumar">
        Clienții cer {suma(toate, 'cerut')} buc pe comenzi deschise · pe stoc {suma(toate, 'stoc')} · în producție {suma(toate, 'in_productie')} ·
        de aprobat {suma(toate, 'de_aprobat')} · <strong>de dat {deDat}</strong> ·{' '}
        <Link href={`/magazine/psc?magazin=${ales?.id}${f.toate === '1' ? '' : '&toate=1'}`}>{f.toate === '1' ? 'doar ce mai trebuie dat' : 'și cele acoperite'}</Link>
      </p>
      {daComenzi && deDat > 0 && (
        <p><Link href={`/comenzi/noua?din_magazin=${ales!.id}`} className="buton">PSC pentru tot ce trebuie dat · {deDat} buc →</Link></p>
      )}
      {randuri.length === 0 ? <p className="slab">Nimic de dat: comenzile deschise sunt acoperite de stoc sau de ce e deja în producție.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead>
              <tr><th>Produs</th><th>Mărime</th><th className="nr">Comenzi</th><th className="nr">Cerut</th><th className="nr">Stoc</th>
                  <th className="nr">În producție</th><th className="nr">De aprobat</th><th className="nr">De dat</th></tr>
            </thead>
            <tbody>
              {[...peModel].map(([cheie, rs]) => (
                <Fragment key={cheie}>
                  <tr className="grupa-model">
                    <td colSpan={3}>
                      <strong>{rs[0].model}</strong> <span className="slab">{new Set(rs.map((r) => r.produs)).size} culori</span>
                      {daComenzi && suma(rs, 'de_dat') > 0 && (
                        <> {' '}<Link href={`/comenzi/noua?din_magazin=${ales!.id}&model=${encodeURIComponent(cheie)}`} className="buton mic-buton">PSC pentru {rs[0].model} →</Link></>
                      )}
                    </td>
                    <td className="nr"><strong>{suma(rs, 'cerut')}</strong></td>
                    <td className="nr">{suma(rs, 'stoc')}</td>
                    <td className="nr">{suma(rs, 'in_productie') || '—'}</td>
                    <td className="nr">{suma(rs, 'de_aprobat') || '—'}</td>
                    <td className="nr"><strong>{suma(rs, 'de_dat') || '—'}</strong></td>
                  </tr>
                  {rs.map((r) => (
                    <tr key={`${r.produs}${r.marime}`}>
                      <td>{r.produs}{!r.produs_id && <span className="slab"> · nu e în catalog</span>}</td>
                      <td>{r.marime}</td>
                      <td className="nr">{r.comenzi}</td>
                      <td className="nr">{r.cerut}</td>
                      <td className="nr">{r.stoc}</td>
                      <td className="nr">{r.in_productie || '—'}</td>
                      <td className="nr">{r.de_aprobat || '—'}</td>
                      <td className={`nr ${r.de_dat ? 'lipsa' : ''}`}>{r.de_dat || '—'}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
