import { notFound, redirect } from 'next/navigation';
import {
  adaugaComponenta, detaliiModel, legaProduse, salveazaAlocari, schimbaConsum, stergeComponenta, UNITATI,
} from '../../lib/retete';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

/** Înapoi pe pagina modelului, cu eroarea în adresă dacă există. */
function inapoi(id: string, eroare: string | null): never {
  const aici = `/modele/${id}`;
  redirect(eroare ? `${aici}?eroare=${encodeURIComponent(eroare)}` : aici);
}

/**
 * Rețeta unui model, în două jumătăți: sus CÂT consumă o bucată (pe model, comun
 * tuturor culorilor), jos CE material concret intră în fiecare culoare.
 */
export default async function ModelPagina({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string }>;
}) {
  const [{ id }, { eroare }] = await Promise.all([params, searchParams]);
  const d = await detaliiModel(id);
  if (!d) notFound();
  const { model, componente, produse, libere, materiale } = d;

  async function componentaNoua(date: FormData) {
    'use server';
    const s = (k: string) => String(date.get(k) ?? '');
    inapoi(id, await adaugaComponenta(id, {
      nume: s('nume'), tip: s('tip'), unitate: s('unitate'), consum: Number(s('consum').replace(',', '.')),
    }));
  }

  async function consum(date: FormData) {
    'use server';
    const s = (k: string) => String(date.get(k) ?? '');
    if (date.get('sterge')) {
      await stergeComponenta(s('componenta'));
      inapoi(id, null);
    }
    inapoi(id, await schimbaConsum(s('componenta'), Number(s('consum').replace(',', '.'))));
  }

  async function lega(date: FormData) {
    'use server';
    await legaProduse(id, date.getAll('produs').map(String));
    inapoi(id, null);
  }

  async function alocari(date: FormData) {
    'use server';
    const lista = [...date.entries()]
      .filter(([k]) => k.startsWith('m:'))
      .map(([k, v]) => {
        const [, produsId, componentaId] = k.split(':');
        return { produsId, componentaId, materialId: String(v) };
      });
    await salveazaAlocari(id, lista);
    inapoi(id, null);
  }

  return (
    <main className="formular">
      <h1>{model.denumire}</h1>
      <p className="sumar">{model.brand} · {model.cod} · {produse.length} culori</p>
      {eroare && <p className="eroare">{eroare}</p>}

      <h2>Consum pe bucată</h2>
      <table>
        <thead><tr><th>Componentă</th><th>Tip</th><th className="nr">Consum</th><th /></tr></thead>
        <tbody>
          {componente.map((c) => (
            <tr key={c.id}>
              <td>{c.nume}</td>
              <td className="slab">{c.tip === 'materie_prima' ? 'materie primă' : 'accesoriu'}</td>
              <td className="nr">
                <form action={consum} className="in-linie">
                  <input type="hidden" name="componenta" value={c.id} />
                  <input name="consum" defaultValue={Number(c.consum)} inputMode="decimal" aria-label={`Consum ${c.nume}`} />
                  <span>{c.unitate}</span>
                  <button className="mic">Salvează</button>
                  <button className="mic" name="sterge" value="1" aria-label={`Șterge ${c.nume}`}>×</button>
                </form>
              </td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>

      <form action={componentaNoua} className="antet-comanda">
        <label><span>Componentă nouă</span><input name="nume" placeholder="Stofă principală" required /></label>
        <label>
          <span>Tip</span>
          <select name="tip" defaultValue="materie_prima">
            <option value="materie_prima">Materie primă</option>
            <option value="accesoriu">Accesoriu</option>
          </select>
        </label>
        <label>
          <span>Unitate</span>
          <select name="unitate" defaultValue="m">{UNITATI.map((u) => <option key={u}>{u}</option>)}</select>
        </label>
        <label><span>Consum pe bucată</span><input name="consum" inputMode="decimal" placeholder="2,1" required /></label>
        <div className="actiuni"><button className="principal">Adaugă</button></div>
      </form>

      <h2>Material pe culoare</h2>
      {produse.length === 0 ? (
        <p className="slab">Niciun produs legat de model încă.</p>
      ) : componente.length === 0 ? (
        <p className="slab">Adaugă întâi componentele rețetei.</p>
      ) : (
        <form action={alocari}>
          <div className="tabel-derulant">
            <table className="grila">
              <thead>
                <tr>
                  <th>Produs</th>
                  {componente.map((c) => <th key={c.id}>{c.nume} <span className="slab">{c.unitate}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {produse.map((p) => (
                  <tr key={p.id}>
                    <td>{p.denumire}<br /><span className="slab">{p.cod_sku}</span></td>
                    {componente.map((c) => {
                      // Doar materialele care se potrivesc componentei: același tip, aceeași unitate.
                      const potrivite = materiale.filter((m) => m.tip === c.tip && m.unitate === c.unitate);
                      const ales = p.materiale[c.id] ?? '';
                      return (
                        <td key={c.id}>
                          <select name={`m:${p.id}:${c.id}`} defaultValue={ales} className={ales ? '' : 'gol'}
                            aria-label={`${c.nume} pentru ${p.denumire}`}>
                            <option value="">— nealocat —</option>
                            {potrivite.map((m) => (
                              <option key={m.id} value={m.id}>{m.denumire}{m.culoare ? ` · ${m.culoare}` : ''}</option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actiuni"><button className="principal">Salvează materialele</button></div>
        </form>
      )}

      {libere.length > 0 && (
        <>
          <h2>Leagă produse de model</h2>
          <form action={lega}>
            <div className="lista-bife">
              {libere.map((p) => (
                <label key={p.id}>
                  <input type="checkbox" name="produs" value={p.id} /> {p.denumire} <span className="slab">{p.cod_sku}</span>
                </label>
              ))}
            </div>
            <div className="actiuni"><button className="principal">Leagă</button></div>
          </form>
        </>
      )}
    </main>
  );
}
