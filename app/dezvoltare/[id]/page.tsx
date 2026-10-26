import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { esteAdmin, poate } from '../../lib/acces';
import { actualizeaza, adaugaPas, aproba, detalii, nomenclatoare, PASI, propuneri, STARI, TIPURI } from '../../lib/dezvoltare';
import { cere } from '../../lib/sesiune';
import CampuriCerere, { cerereDinFormular } from '../CampuriCerere';
import Referinte from '../Referinte';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

function inapoi(id: string, eroare: string | null): never {
  redirect(eroare ? `/dezvoltare/${id}?eroare=${encodeURIComponent(eroare)}` : `/dezvoltare/${id}`);
}

/** Pașii pe care atelierul îi poate apăsa acum, în ordinea firească. */
function urmatoriiPasi(stare: string, tiparGata: boolean, fisaGata: boolean): string[] {
  if (['aprobat', 'anulat'].includes(stare)) return [];
  if (stare === 'de_facut') return ['inceput'];
  return ['proba', ...(tiparGata ? (stare === 'mostra_gata' ? [] : ['mostra_gata']) : ['tipar_gata']),
          ...(fisaGata ? [] : ['fisa_gata'])];
}

/**
 * Fișa unui model în dezvoltare: datele cererii, pașii (cine, când, ce s-a corectat)
 * și, când mostra e gata, aprobarea — cu denumirea și SKU-ul fiecărei culori, care
 * intră în catalog așa cum le confirmă KAM-ul.
 */
export default async function DezvoltarePagina({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string }>;
}) {
  const u = await cere(['dezvoltare', 'comenzi']);
  const [{ id }, { eroare }] = await Promise.all([params, searchParams]);
  const [d, nom] = await Promise.all([detalii(id), nomenclatoare()]);
  if (!d) notFound();
  const atelier = poate(u, 'dezvoltare', 'modifica');
  const kamulEi = esteAdmin(u) || d.kam_id === u.id;
  const deAprobat = d.stare === 'mostra_gata' && kamulEi;
  const prop = deAprobat ? await propuneri(d) : [];

  async function salveaza(f: FormData) {
    'use server';
    await cere('dezvoltare', 'modifica');
    inapoi(id, await actualizeaza(id, cerereDinFormular(f)));
  }
  async function pas(f: FormData) {
    'use server';
    await cere(['dezvoltare', 'comenzi'], 'vede'); // ordinea și cine poate: adaugaPas
    inapoi(id, await adaugaPas(id, String(f.get('pas')), String(f.get('observatii') ?? '')));
  }
  async function aprobaMostra(f: FormData) {
    'use server';
    await cere(['dezvoltare', 'comenzi'], 'vede'); // doar KAM-ul ei: aproba()
    const culori = f.getAll('culoare').map(String);
    const e = await aproba(id, culori.map((culoare, i) => ({
      culoare, denumire: String(f.getAll('denumire')[i] ?? ''), sku: String(f.getAll('sku')[i] ?? ''),
    })));
    inapoi(id, e);
  }

  return (
    <main className="formular">
      <p className="slab"><Link href="/dezvoltare">← Dezvoltare produs</Link></p>
      <h1>{d.model}</h1>
      <p className="sumar">
        {d.brand} · {d.categorie ?? 'fără categorie'} · {TIPURI[d.tip]} · <strong>{STARI[d.stare]}</strong>
        {d.termen && <> · termen <span className={d.intarziat ? 'lipsa' : ''}>{d.termen}</span></>}
        {d.kam && ` · KAM ${d.kam}`}
        {d.model_id && <> · <Link href={`/modele/${d.model_id}`}>în catalog — completează rețeta</Link></>}
      </p>
      <p className="slab">
        Culori: {d.culori.join(', ') || '—'}{d.marimi && ` · mărimi ${d.marimi}`}
        {d.link_poze && <> · <a href={d.link_poze} target="_blank" rel="noreferrer">poze</a></>}
        {d.link_fisa && <> · <a href={d.link_fisa} target="_blank" rel="noreferrer">fișă</a></>}
      </p>
      {eroare && <p className="eroare">{eroare}</p>}
      <p>
        <Link href={`/dezvoltare/${id}/fisa`} className="buton">Fișa de produs</Link>{' '}
        <a href={`/dezvoltare/${id}/fisa/excel`} className="buton">Descarcă Excel</a>{' '}
        <Link href={`/dezvoltare/${id}/fisa/tipar`} className="buton" target="_blank">PDF</Link>
      </p>

      <Referinte id={id} culori={d.culori} poateAdauga={atelier || poate(u, 'comenzi', 'modifica')} />

      {deAprobat && (
        <section className="caseta">
          <h2>Aprobă mostra</h2>
          <p className="slab">
            Fiecare culoare intră în catalog ca produs. Denumirea și SKU-ul trebuie să fie exact cele din Shopify,
            ca vânzările să se lege de produs. Fișa de produs devine rețeta modelului: componentele, consumurile și
            materialul fiecărei culori.
          </p>
          <form action={aprobaMostra}>
            <table className="grila">
              <thead><tr><th>Culoare</th><th>Denumire (titlul din Shopify)</th><th>SKU</th></tr></thead>
              <tbody>
                {prop.map((p) => (
                  <tr key={p.culoare}>
                    <td>{p.culoare}<input type="hidden" name="culoare" value={p.culoare} /></td>
                    <td><input name="denumire" defaultValue={p.denumire} required /></td>
                    <td><input name="sku" defaultValue={p.sku} required /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="actiuni"><button className="principal">Aprobă și pune în catalog</button></div>
          </form>
        </section>
      )}

      {(atelier || kamulEi) && !['aprobat', 'anulat'].includes(d.stare) && (
        <>
          <h2>Pasul următor</h2>
          <div className="actiuni">
            {atelier && urmatoriiPasi(d.stare, d.tipar_gata, d.fisa_gata).map((p) => (
              <form key={p} action={pas}>
                <input type="hidden" name="pas" value={p} />
                <button className={p === 'mostra_gata' || p === 'inceput' ? 'principal' : 'secundar'}>{PASI[p]}</button>
              </form>
            ))}
          </div>
          {d.stare !== 'de_facut' && (atelier || d.stare === 'mostra_gata') && (
            <form action={pas} className="antet-comanda">
              <input type="hidden" name="pas" value="corecturi" />
              <label className="lat"><span>Corecturi — ce trebuie schimbat</span><input name="observatii" required /></label>
              <div className="actiuni"><button className="secundar">Cere corecturi</button></div>
            </form>
          )}
        </>
      )}

      <h2>Istoric</h2>
      {d.pasi.length === 0 ? <p className="slab">Niciun pas încă: tiparul e de făcut.</p> : (
        <table>
          <tbody>
            {d.pasi.map((p, i) => (
              <tr key={i}>
                <td className="slab">{p.la}</td>
                <td><strong>{PASI[p.pas]}</strong>{p.observatii && <div>{p.observatii}</div>}</td>
                <td className="slab">{p.de ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {atelier && (
        <details className="caseta">
          <summary>Modifică cererea</summary>
          <form action={salveaza} className="antet-comanda">
            <CampuriCerere nom={nom} d={d} />
            <div className="actiuni"><button className="principal">Salvează</button></div>
          </form>
          {!['aprobat', 'anulat'].includes(d.stare) && (
            <form action={pas}>
              <input type="hidden" name="pas" value="anulat" />
              <button className="mic">Anulează cererea</button>
            </form>
          )}
        </details>
      )}
    </main>
  );
}
