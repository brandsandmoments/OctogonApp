import Link from 'next/link';
import { cere, poateModifica } from '../lib/sesiune';
import { redirect } from 'next/navigation';
import { cantitate, numarDinFormular } from '../lib/format';
import { adaugaMiscare, familii, listaStoc, materialeSelect } from '../lib/stoc';
import '../formulare.css';

export const dynamic = 'force-dynamic';

type Cautare = { tip?: string; familie?: string; cauta?: string; lipsa?: string; eroare?: string; ok?: string };

async function intrare(date: FormData) {
  'use server';
  await cere('materiale', 'modifica');
  const s = (k: string) => String(date.get(k) ?? '');
  const eroare = await adaugaMiscare({
    materialId: s('material'), tip: 'intrare', cantitate: numarDinFormular(date.get('cantitate')) ?? 0,
    data: s('data'), furnizor: s('furnizor'), document: s('document'),
    pret: numarDinFormular(date.get('pret')), observatii: s('observatii'),
  });
  redirect(eroare ? `/stoc?eroare=${encodeURIComponent(eroare)}` : `/stoc?ok=1`);
}

/**
 * Stocul de materii prime și accesorii: ce e pe raft, ce e promis planificărilor,
 * ce mai cer comenzile neplanificate și cât trebuie cumpărat.
 */
export default async function Stoc({ searchParams }: { searchParams: Promise<Cautare> }) {
  await cere('materiale');
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('materiale');
  const f = await searchParams;
  const [randuri, fam, materiale] = await Promise.all([
    listaStoc({ ...f, lipsa: f.lipsa === '1' }), familii(), materialeSelect(),
  ]);
  const deCumparat = randuri.filter((r) => Number(r.de_aprovizionat) > 0).length;

  return (
    <main className="formular lat">
      <h1>Stoc materiale</h1>
      <p className="sumar">
        {randuri.length} materiale · {deCumparat} de aprovizionat · <Link href="/stoc/cumparaturi">lista de cumpărături</Link> ·{' '}
        <Link href="/inventar">inventar</Link>
      </p>

      <details className="caseta" open={Boolean(f.eroare)}>
        <summary>Intrare de la furnizor</summary>
        <form action={intrare} className="antet-comanda"><fieldset disabled={!m} className="fara-chenar">
          <label className="lat">
            <span>Material</span>
            <select name="material" required defaultValue="">
              <option value="">—</option>
              {materiale.map((m) => (
                <option key={m.id} value={m.id}>{m.denumire} · {m.cod} ({m.unitate})</option>
              ))}
            </select>
          </label>
          <label><span>Cantitate</span><input name="cantitate" inputMode="decimal" required /></label>
          <label><span>Data</span><input name="data" type="date" /></label>
          <label><span>Furnizor</span><input name="furnizor" required /></label>
          <label><span>Document</span><input name="document" placeholder="factură / aviz" /></label>
          <label><span>Preț unitar (RON)</span><input name="pret" inputMode="decimal" /></label>
          <label className="lat"><span>Observații</span><input name="observatii" /></label>
          <div className="actiuni"><button className="principal">Înregistrează intrarea</button></div>
        </fieldset></form>
      </details>
      {f.eroare && <p className="eroare">{f.eroare}</p>}
      {f.ok && <p className="ok">Intrarea s-a înregistrat.</p>}

      <form className="filtre">
        <select name="tip" defaultValue={f.tip ?? ''} aria-label="Tip">
          <option value="">Toate</option>
          <option value="materie_prima">Materii prime</option>
          <option value="accesoriu">Accesorii</option>
        </select>
        <select name="familie" defaultValue={f.familie ?? ''} aria-label="Familie">
          <option value="">Toate familiile</option>
          {fam.map((x) => <option key={x}>{x}</option>)}
        </select>
        <input name="cauta" defaultValue={f.cauta ?? ''} placeholder="cod sau denumire" aria-label="Caută" />
        <label className="bifa">
          <input type="checkbox" name="lipsa" value="1" defaultChecked={f.lipsa === '1'} /> doar de aprovizionat
        </label>
        <button>Filtrează</button>
      </form>

      <div className="tabel-derulant">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th className="nr">Stoc</th>
              <th className="nr">Rezervat</th>
              <th className="nr">Disponibil</th>
              <th className="nr">Neplanificat</th>
              <th className="nr">De aprovizionat</th>
            </tr>
          </thead>
          <tbody>
            {randuri.map((r) => {
              const disponibil = Number(r.stoc) - Number(r.rezervat);
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/stoc/${r.id}`}>{r.denumire}</Link>
                    <br />
                    <span className="slab">{r.cod}{r.familie && ` · ${r.familie}`}</span>
                  </td>
                  <td className="nr">{cantitate(r.stoc)} <span className="slab">{r.unitate}</span></td>
                  <td className="nr">{Number(r.rezervat) ? cantitate(r.rezervat) : '—'}</td>
                  <td className={`nr ${disponibil < 0 ? 'lipsa' : ''}`}>{cantitate(disponibil)}</td>
                  <td className="nr">{Number(r.neplanificat) ? cantitate(r.neplanificat) : '—'}</td>
                  <td className="nr">
                    {Number(r.de_aprovizionat) > 0
                      ? <strong className="lipsa">{cantitate(r.de_aprovizionat)}</strong> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
