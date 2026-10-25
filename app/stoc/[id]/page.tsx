import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cantitate, numarDinFormular } from '../../lib/format';
import { adaugaMiscare, fisaMaterial } from '../../lib/stoc';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

const TIPURI: Record<string, string> = {
  intrare: 'Intrare', consum_croit: 'Consum croit', ajustare_inventar: 'Ajustare inventar',
  iesire: 'Ieșire', retur_furnizor: 'Retur furnizor',
};

function inapoi(id: string, eroare: string | null): never {
  redirect(eroare ? `/stoc/${id}?eroare=${encodeURIComponent(eroare)}` : `/stoc/${id}`);
}

/** Fișa de magazie a unui material: fiecare mișcare cu soldul de după ea, și cine îl are rezervat. */
export default async function FisaMagazie({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string }>;
}) {
  const [{ id }, { eroare }] = await Promise.all([params, searchParams]);
  const fisa = await fisaMaterial(id);
  if (!fisa) notFound();
  const { material, stoc, miscari, rezervari } = fisa;
  const rezervat = rezervari.reduce((s, r) => s + Number(r.rezervat), 0);

  async function miscare(date: FormData) {
    'use server';
    const s = (k: string) => String(date.get(k) ?? '');
    inapoi(id, await adaugaMiscare({
      materialId: id, tip: s('tip') as 'intrare' | 'iesire' | 'retur_furnizor',
      cantitate: numarDinFormular(date.get('cantitate')) ?? 0, data: s('data'),
      furnizor: s('furnizor'), document: s('document'), pret: numarDinFormular(date.get('pret')),
      observatii: s('observatii'),
    }));
  }

  return (
    <main className="formular">
      <p className="slab"><Link href="/stoc">← Stoc</Link></p>
      <h1>{material.denumire}</h1>
      <p className="sumar">
        {material.cod} · {material.tip === 'materie_prima' ? 'materie primă' : 'accesoriu'}
        {material.familie && ` · ${material.familie}`}
        {material.pret_referinta && ` · preț referință ${cantitate(material.pret_referinta)} RON/${material.unitate}`}
      </p>

      <dl className="cifre-birou">
        <div><dt>Stoc</dt><dd>{cantitate(stoc)} <span>{material.unitate}</span></dd></div>
        <div><dt>Rezervat</dt><dd>{cantitate(rezervat)}</dd></div>
        <div className={Number(stoc) - rezervat < 0 ? 'lipsa' : ''}>
          <dt>Disponibil</dt><dd>{cantitate(Number(stoc) - rezervat)}</dd>
        </div>
      </dl>

      <form action={miscare} className="antet-comanda">
        <label>
          <span>Mișcare</span>
          <select name="tip" defaultValue="intrare">
            <option value="intrare">Intrare de la furnizor</option>
            <option value="iesire">Ieșire</option>
            <option value="retur_furnizor">Retur la furnizor</option>
          </select>
        </label>
        <label><span>Cantitate ({material.unitate})</span><input name="cantitate" inputMode="decimal" required /></label>
        <label><span>Data</span><input name="data" type="date" /></label>
        <label><span>Furnizor</span><input name="furnizor" defaultValue={material.furnizor ?? ''} /></label>
        <label><span>Document</span><input name="document" /></label>
        <label><span>Preț unitar (RON)</span><input name="pret" inputMode="decimal" /></label>
        <label className="lat"><span>Observații</span><input name="observatii" /></label>
        <div className="actiuni"><button className="principal">Înregistrează</button></div>
      </form>
      {eroare && <p className="eroare">{eroare}</p>}

      {rezervari.length > 0 && (
        <>
          <h2>Rezervat pentru</h2>
          <table>
            <tbody>
              {rezervari.map((r) => (
                <tr key={r.planificare}>
                  <td>{r.planificare}</td>
                  <td>{r.produs}</td>
                  <td className="nr">{cantitate(r.rezervat)} {material.unitate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Fișa de magazie</h2>
      {miscari.length === 0 ? (
        <p className="slab">Nicio mișcare încă.</p>
      ) : (
        <div className="tabel-derulant">
          <table>
            <thead>
              <tr>
                <th>Data</th><th>Mișcare</th><th className="nr">Cantitate</th><th className="nr">Sold</th>
                <th>Furnizor / document</th><th>Observații</th>
              </tr>
            </thead>
            <tbody>
              {miscari.map((m) => (
                <tr key={m.id}>
                  <td className="slab">{m.data}</td>
                  <td>{TIPURI[m.tip] ?? m.tip}{m.referinta && <div className="slab">{m.referinta}</div>}</td>
                  <td className={`nr ${Number(m.cantitate) < 0 ? 'slab' : ''}`}>
                    {Number(m.cantitate) > 0 ? '+' : ''}{cantitate(m.cantitate)}
                  </td>
                  <td className="nr">{cantitate(m.sold)}</td>
                  <td>
                    {m.furnizor}{m.document && <div className="slab">{m.document}</div>}
                    {m.pret_unitar && <div className="slab">{cantitate(m.pret_unitar)} RON</div>}
                  </td>
                  <td className="slab">{m.observatii}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
