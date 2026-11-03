import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { cere, poateModifica } from '../../lib/sesiune';
import { cantitate } from '../../lib/format';
import {
  adaugaComponenta, adaugaOperatie, detaliiModel, legaProduse, mutaOperatie, salveazaAlocari, schimbaConsum, schimbaOperatie,
  stergeComponenta, stergeOperatie, UNITATI,
} from '../../lib/retete';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

/** Înapoi pe pagina modelului, cu eroarea în adresă dacă există, la secțiunea unde s-a lucrat. */
function inapoi(id: string, eroare: string | null, unde?: string): never {
  const aici = `/modele/${id}`;
  revalidatePath(aici);   // aceeași adresă, altă ancoră: fără asta pagina nu se reîncarcă
  redirect(`${eroare ? `${aici}?eroare=${encodeURIComponent(eroare)}` : aici}${unde ? `#${unde}` : ''}`);
}

/**
 * Tot ce trebuie știut despre un model: din ce e făcut (componentele, cu consumul pe
 * bucată și materialul fiecărei culori) și cum se face (procesul tehnologic, cu
 * operațiile în ordine, utilajul și timpul pe bucată). Suma timpilor e timpul
 * modelului, din care banda își calculează orele.
 *
 * Schimbă doar cine are dreptul „retete" (și conturile master); ceilalți văd.
 */
export default async function ModelPagina({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string }>;
}) {
  await cere(['necesar', 'retete', 'croit', 'dezvoltare']);
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('retete');
  const [{ id }, { eroare }] = await Promise.all([params, searchParams]);
  const d = await detaliiModel(id);
  if (!d) notFound();
  const { model, componente, operatii, produse, libere, materiale } = d;
  const numeMaterial = (id: string | undefined) => materiale.find((x) => x.id === id);
  const timpTotal = operatii.reduce((s, o) => s + Number(o.timp_min), 0);

  async function operatieNoua(date: FormData) {
    'use server';
    await cere('retete', 'modifica');
    const s = (k: string) => String(date.get(k) ?? '');
    inapoi(id, await adaugaOperatie(id, { denumire: s('denumire'), utilaj: s('utilaj'), timp: Number(s('timp').replace(',', '.')), observatii: s('observatii') }), 'proces');
  }

  async function operatie(date: FormData) {
    'use server';
    await cere('retete', 'modifica');
    const s = (k: string) => String(date.get(k) ?? '');
    const op = s('operatie');
    if (date.get('sterge')) { await stergeOperatie(id, op); inapoi(id, null, 'proces'); }
    if (date.get('muta')) { await mutaOperatie(id, op, s('muta') === 'sus' ? -1 : 1); inapoi(id, null, 'proces'); }
    inapoi(id, await schimbaOperatie(id, op, { denumire: s('denumire'), utilaj: s('utilaj'), timp: Number(s('timp').replace(',', '.')), observatii: s('observatii') }), 'proces');
  }

  async function componentaNoua(date: FormData) {
    'use server';
    await cere('retete', 'modifica');
    const s = (k: string) => String(date.get(k) ?? '');
    inapoi(id, await adaugaComponenta(id, {
      nume: s('nume'), tip: s('tip'), unitate: s('unitate'), consum: Number(s('consum').replace(',', '.')),
    }));
  }

  async function consum(date: FormData) {
    'use server';
    await cere('retete', 'modifica');
    const s = (k: string) => String(date.get(k) ?? '');
    if (date.get('sterge')) {
      await stergeComponenta(s('componenta'));
      inapoi(id, null);
    }
    inapoi(id, await schimbaConsum(s('componenta'), Number(s('consum').replace(',', '.'))));
  }

  async function lega(date: FormData) {
    'use server';
    await cere('retete', 'modifica');
    await legaProduse(id, date.getAll('produs').map(String));
    inapoi(id, null);
  }

  async function alocari(date: FormData) {
    'use server';
    await cere('retete', 'modifica');
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
      <p className="sumar">
        {model.brand} · {model.cod} · {produse.length} culori · {componente.length} componente · {operatii.length} operații
        {model.timp_min_buc && ` · ${cantitate(model.timp_min_buc)} min pe bucată`}
        {!m && ' · doar vizualizare'}
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      <section className="caseta ce-contine">
        <h2>Ce conține</h2>
        {componente.length === 0 ? <p className="slab">Modelul nu are încă rețetă.</p> : (
          <table>
            <thead><tr><th>Componentă</th><th className="nr">Consum / buc</th>{produse.map((p) => <th key={p.id}>{p.culoare ?? p.denumire}</th>)}</tr></thead>
            <tbody>
              {(['materie_prima', 'accesoriu'] as const).map((tip) => {
                const rs = componente.filter((c) => c.tip === tip);
                if (rs.length === 0) return null;
                return [
                  <tr key={tip} className="tip-rand"><td colSpan={2 + produse.length}>{tip === 'materie_prima' ? 'Materie primă' : 'Accesorii'}</td></tr>,
                  ...rs.map((c) => (
                    <tr key={c.id}>
                      <td>{c.nume}</td>
                      <td className="nr">{cantitate(c.consum)} {c.unitate}</td>
                      {produse.map((p) => {
                        const mat = numeMaterial(p.materiale[c.id]);
                        return <td key={p.id} className={mat ? '' : 'lipsa'}>{mat ? mat.denumire : 'nealocat'}</td>;
                      })}
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        )}
        <h3 id="proces-rezumat">Proces tehnologic</h3>
        {operatii.length === 0 ? <p className="slab">Nicio operație scrisă încă.</p> : (
          <ol className="proces-rezumat">
            {operatii.map((o) => (
              <li key={o.id}>{o.denumire}{o.utilaj && <span className="slab"> · {o.utilaj}</span>} <strong>{cantitate(o.timp_min)} min</strong></li>
            ))}
            <li className="total">Total: <strong>{cantitate(timpTotal)} min pe bucată</strong></li>
          </ol>
        )}
      </section>

      <h2>Consum pe bucată</h2>
      <table>
        <thead><tr><th>Componentă</th><th>Tip</th><th className="nr">Consum</th><th /></tr></thead>
        <tbody>
          {componente.map((c) => (
            <tr key={c.id}>
              <td>{c.nume}</td>
              <td className="slab">{c.tip === 'materie_prima' ? 'materie primă' : 'accesoriu'}</td>
              <td className="nr">
                <form action={consum} className="in-linie"><fieldset disabled={!m} className="fara-chenar">
                  <input type="hidden" name="componenta" value={c.id} />
                  <input name="consum" defaultValue={Number(c.consum)} inputMode="decimal" aria-label={`Consum ${c.nume}`} />
                  <span>{c.unitate}</span>
                  <button className="mic">Salvează</button>
                  <button className="mic" name="sterge" value="1" aria-label={`Șterge ${c.nume}`}>×</button>
                </fieldset></form>
              </td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>

      <form action={componentaNoua} className="antet-comanda"><fieldset disabled={!m} className="fara-chenar">
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
      </fieldset></form>

      <h2 id="proces">Proces tehnologic</h2>
      <p className="slab">Operațiile în ordine, cu utilajul și minutele pe bucată. Totalul devine timpul modelului pe bucată, din care banda își calculează orele.</p>
      {operatii.length > 0 && (
        <div className="tabel-derulant">
          <table className="operatii">
            <thead><tr><th>#</th><th>Operație · utilaj · minute pe bucată · observații</th></tr></thead>
            <tbody>
              {operatii.map((o, i) => (
                <tr key={o.id}>
                  <td className="slab">{o.ordine}</td>
                  <td>
                    <form action={operatie} className="rand-operatie"><fieldset disabled={!m} className="fara-chenar">
                      <input type="hidden" name="operatie" value={o.id} />
                      <input name="denumire" defaultValue={o.denumire} aria-label="Operația" required />
                      <input name="utilaj" defaultValue={o.utilaj ?? ''} aria-label="Utilajul" placeholder="utilaj" />
                      <input name="timp" defaultValue={Number(o.timp_min)} inputMode="decimal" className="timp" aria-label="Minute pe bucată" />
                      <input name="observatii" defaultValue={o.observatii ?? ''} aria-label="Observații" placeholder="observații" />
                      <button className="mic">Salvează</button>
                      <button className="mic" name="muta" value="sus" disabled={i === 0} aria-label="Mai sus">↑</button>
                      <button className="mic" name="muta" value="jos" disabled={i === operatii.length - 1} aria-label="Mai jos">↓</button>
                      <button className="mic" name="sterge" value="1" aria-label={`Șterge ${o.denumire}`}>×</button>
                    </fieldset></form>
                  </td>
                </tr>
              ))}
              <tr><td /><td><strong>Total: {cantitate(timpTotal)} minute pe bucată</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}
      <form action={operatieNoua} className="antet-comanda"><fieldset disabled={!m} className="fara-chenar">
        <label><span>Operație nouă</span><input name="denumire" placeholder="Cusut buzunare" required /></label>
        <label><span>Utilaj</span><input name="utilaj" placeholder="Mașină simplă" /></label>
        <label><span>Minute / buc</span><input name="timp" inputMode="decimal" placeholder="2,5" required /></label>
        <label><span>Observații</span><input name="observatii" placeholder="opțional" /></label>
        <div className="actiuni"><button className="principal">Adaugă operația</button></div>
      </fieldset></form>

      <h2>Material pe culoare</h2>
      {produse.length === 0 ? (
        <p className="slab">Niciun produs legat de model încă.</p>
      ) : componente.length === 0 ? (
        <p className="slab">Adaugă întâi componentele rețetei.</p>
      ) : (
        <form action={alocari}><fieldset disabled={!m} className="fara-chenar">
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
        </fieldset></form>
      )}

      {libere.length > 0 && (
        <>
          <h2>Leagă produse de model</h2>
          <form action={lega}><fieldset disabled={!m} className="fara-chenar">
            <div className="lista-bife">
              {libere.map((p) => (
                <label key={p.id}>
                  <input type="checkbox" name="produs" value={p.id} /> {p.denumire} <span className="slab">{p.cod_sku}</span>
                </label>
              ))}
            </div>
            <div className="actiuni"><button className="principal">Leagă</button></div>
          </fieldset></form>
        </>
      )}
    </main>
  );
}
