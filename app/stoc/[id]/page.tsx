import Link from 'next/link';
import { cere, poateModifica } from '../../lib/sesiune';
import { notFound, redirect } from 'next/navigation';
import { cantitate, numarDinFormular } from '../../lib/format';
import { adaugaMiscare, fisaMaterial, modelePentruRezervare, rezervaPentruModel, rezervariMaterial, stergeRezervareModel } from '../../lib/stoc';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

const TIPURI: Record<string, string> = {
  intrare: 'Intrare', consum_croit: 'Consum croit', consum_banda: 'Consum bandă', ajustare_inventar: 'Ajustare inventar',
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
  await cere('materiale');
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('materiale');
  const [{ id }, { eroare }] = await Promise.all([params, searchParams]);
  const [fisa, peModele, modele] = await Promise.all([fisaMaterial(id), rezervariMaterial(id), modelePentruRezervare()]);
  if (!fisa) notFound();
  const { material, stoc, miscari, rezervari } = fisa;
  const rezervat = rezervari.reduce((s, r) => s + Number(r.rezervat), 0);
  const pusDeoparte = peModele.reduce((s, r) => s + r.ramas, 0);
  const disponibil = Number(stoc) - rezervat - pusDeoparte;

  async function rezerva(date: FormData) {
    'use server';
    await cere('materiale', 'modifica');
    inapoi(id, await rezervaPentruModel(id, String(date.get('model') ?? ''), numarDinFormular(date.get('cantitate')) ?? 0, String(date.get('observatii') ?? '')));
  }
  async function stergeRezervare(date: FormData) {
    'use server';
    await cere('materiale', 'modifica');
    await stergeRezervareModel(String(date.get('id')));
    inapoi(id, null);
  }

  async function miscare(date: FormData) {
    'use server';
    await cere('materiale', 'modifica');
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
        <div><dt>Pe modele</dt><dd>{cantitate(pusDeoparte)}</dd></div>
        <div className={disponibil < 0 ? 'lipsa' : ''}>
          <dt>Disponibil</dt><dd>{cantitate(disponibil)}</dd>
        </div>
      </dl>

      <section id="pe-modele" className="caseta pe-modele">
        <h2>Pus deoparte pe modele</h2>
        <p className="slab">O cantitate din stoc pusă deoparte pentru un model; restul rămâne liber. Ce rămâne scade singur cu ce se croiește din materialul ăsta pe modelul respectiv.</p>
        {peModele.length > 0 && (
          <table className="fara-fise">
            <thead><tr><th>Model</th><th className="nr">Pus deoparte</th><th className="nr">Croit din el</th><th className="nr">Rămas</th><th>Când, cine</th><th /></tr></thead>
            <tbody>
              {peModele.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.model}</strong> <span className="slab">{r.brand}</span>{r.observatii && <div className="slab">{r.observatii}</div>}</td>
                  <td className="nr">{cantitate(String(r.cantitate))} {material.unitate}</td>
                  <td className="nr">{r.consumat ? cantitate(String(r.consumat)) : '—'}</td>
                  <td className="nr"><strong>{cantitate(String(r.ramas))}</strong></td>
                  <td className="slab">{r.creat_la}{r.creat_de && ` · ${r.creat_de}`}</td>
                  <td>{m && (
                    <form action={stergeRezervare}><input type="hidden" name="id" value={r.id} />
                      <button className="secundar" aria-label={`Scoate rezervarea pentru ${r.model}`}>×</button></form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {m && (
          <form action={rezerva} className="filtre rezerva-model">
            <select name="model" required defaultValue="" aria-label="Modelul">
              <option value="">modelul</option>
              {modele.map((x) => <option key={x.id} value={x.id}>{x.nume}</option>)}
            </select>
            <input name="cantitate" inputMode="decimal" required placeholder={`cât (${material.unitate})`} aria-label="Cantitatea pusă deoparte" />
            <input name="observatii" placeholder="observații (opțional)" aria-label="Observații" />
            <button className="principal">Pune deoparte</button>
            <span className="slab">liber acum: {cantitate(String(Math.max(Number(stoc) - pusDeoparte, 0)))} {material.unitate}</span>
          </form>
        )}
      </section>

      <form action={miscare} className="antet-comanda"><fieldset disabled={!m} className="fara-chenar">
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
      </fieldset></form>
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
