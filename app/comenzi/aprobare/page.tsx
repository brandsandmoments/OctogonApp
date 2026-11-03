import { redirect } from 'next/navigation';
import { aprobaPsf, psfDeAprobat, respingePsf } from '../../lib/aprobare';
import { cere } from '../../lib/sesiune';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

const inapoi = (q: string): never => redirect(`/comenzi/aprobare?${q}`);

async function aproba(date: FormData) {
  'use server';
  const u = await cere('aprobare', 'modifica');
  const numar = String(date.get('numar'));
  const e = await aprobaPsf(numar, u.id);
  inapoi(e ? `eroare=${encodeURIComponent(e)}` : `aprobat=${encodeURIComponent(numar)}`);
}

async function respinge(date: FormData) {
  'use server';
  const u = await cere('aprobare', 'modifica');
  const numar = String(date.get('numar'));
  const e = await respingePsf(numar, String(date.get('motiv') ?? ''), u.id);
  inapoi(e ? `eroare=${encodeURIComponent(e)}` : `respins=${encodeURIComponent(numar)}`);
}

/**
 * PSF-urile și PSC-urile date de KAM-i fără drept de aprobare, de aprobat. Pe fiecare mărime: cât cere PSF-ul, cât e pe
 * stoc în magazin, cât s-a vândut în 30 de zile și cât e deja în producție. Aprobat,
 * PSF-ul se lansează și intră în planificare; respins, se anulează cu motivul scris.
 */
export default async function Aprobare({ searchParams }: { searchParams: Promise<{ eroare?: string; aprobat?: string; respins?: string }> }) {
  await cere('aprobare', 'modifica');
  const f = await searchParams;
  const lista = await psfDeAprobat();
  return (
    <main className="lat">
      <h1>De aprobat · PSF și PSC</h1>
      <p className="sumar">{lista.length} {lista.length === 1 ? 'comandă dată' : 'comenzi date'} de KAM-i așteaptă. Aprobată, comanda se lansează în producție; respinsă, KAM-ul vede motivul.</p>
      {f.eroare && <p className="eroare">{f.eroare}</p>}
      {f.aprobat && <p className="mesaj-ok">{f.aprobat} aprobat și lansat.</p>}
      {f.respins && <p className="mesaj-ok">{f.respins} respins.</p>}
      {lista.length === 0 && <p className="slab">Nimic de aprobat.</p>}
      {lista.map((c) => (
        <section key={c.numar} className="caseta aprobare">
          <h2>{c.numar} <span className="slab">· {c.brand} · {c.kam ?? 'fără KAM'} · {c.creata.split('-').reverse().join('.')}</span></h2>
          {c.observatii && <p className="slab">{c.observatii}</p>}
          <div className="tabel-derulant">
            <table>
              <thead><tr><th>Produs</th><th>Mărime</th><th className="nr">Cere</th><th className="nr">Stoc magazin</th><th className="nr">Vândut 30 z</th><th className="nr">În producție</th><th>Termen · vânzare</th></tr></thead>
              <tbody>
                {c.linii.flatMap((l) => l.marimi.map((m, i) => (
                  <tr key={`${l.produs}${m.marime}`}>
                    <td>{i === 0 && <strong>{l.produs}</strong>}</td>
                    <td>{m.marime}</td>
                    <td className="nr"><strong>{m.cantitate}</strong></td>
                    <td className="nr">{m.stoc}</td>
                    <td className="nr">{m.v30}</td>
                    <td className={`nr ${m.in_productie ? 'lipsa' : ''}`}>{m.in_productie || '—'}</td>
                    <td className="slab">{i === 0 && `${l.data_ceruta.split('-').reverse().join('.')}${l.vanzare ? ` · ${l.vanzare}` : ''}`}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          <div className="actiuni-aprobare">
            <form action={aproba}><input type="hidden" name="numar" value={c.numar} /><button className="buton aproba">Aprobă și lansează</button></form>
            <form action={respinge} className="respinge">
              <input type="hidden" name="numar" value={c.numar} />
              <input name="motiv" placeholder="de ce îl respingi" required />
              <button className="buton">Respinge</button>
            </form>
          </div>
        </section>
      ))}
    </main>
  );
}
