import Link from 'next/link';
import Cauta from '../Cauta';
import { cantitate, potriveste } from '../lib/format';
import { cere, poateModifica } from '../lib/sesiune';
import { redirect } from 'next/navigation';
import { nomenclatoareComanda } from '../lib/comenzi';
import { adaugaModel, modele } from '../lib/retete';
import '../formulare.css';

export const dynamic = 'force-dynamic';

async function adauga(date: FormData) {
  'use server';
  await cere('retete', 'modifica');
  const s = (k: string) => String(date.get(k) ?? '');
  const eroare = await adaugaModel({ brandId: s('brand'), cod: s('cod'), denumire: s('denumire') });
  redirect(eroare ? `/modele?eroare=${encodeURIComponent(eroare)}` : '/modele');
}

/**
 * Modelele și starea rețetei lor: câte culori, câte componente, câte operații în
 * procesul tehnologic și timpul pe bucată. Se caută după model sau după produs
 * (denumire, culoare, SKU). „Nealocate" numără perechile produs × componentă fără
 * material: cât timp nu e zero, necesarul acelor produse e incomplet.
 *
 * Le schimbă doar cine are dreptul „retete" (și conturile master); ceilalți le văd.
 */
export default async function Modele({ searchParams }: { searchParams: Promise<{ eroare?: string; cauta?: string; brand?: string }> }) {
  await cere(['necesar', 'retete', 'croit', 'dezvoltare']);
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('retete');
  const [{ eroare, cauta, brand }, toate, { branduri }] = await Promise.all([searchParams, modele(), nomenclatoareComanda()]);
  const lista = toate.filter((x) => (!brand || x.brand === brand) && potriveste(cauta, x.denumire, x.cod, x.brand, x.cauta));

  return (
    <main className="formular">
      <h1>Modele și rețete</h1>

      <Cauta valoare={cauta} pastreaza={{ brand }} placeholder="caută model sau produs: denumire, culoare, SKU" />
      <p className="filtre">
        <Link href={`/modele${cauta ? `?cauta=${encodeURIComponent(cauta)}` : ''}`} className={`buton ${!brand ? 'activ-buton' : ''}`}>toate brandurile</Link>
        {branduri.map((b) => (
          <Link key={b.id} href={`/modele?brand=${encodeURIComponent(b.nume)}${cauta ? `&cauta=${encodeURIComponent(cauta)}` : ''}`}
                className={`buton ${brand === b.nume ? 'activ-buton' : ''}`}>{b.nume}</Link>
        ))}
      </p>
      <p className="sumar">{lista.length} modele{cauta || brand ? ` din ${toate.length}` : ''}</p>

      {m && <details className="caseta"><summary>Model nou</summary>
      <form action={adauga} className="antet-comanda"><fieldset disabled={!m} className="fara-chenar">
        <label>
          <span>Brand</span>
          <select name="brand" defaultValue="" required>
            <option value="">—</option>
            {branduri.map((b) => <option key={b.id} value={b.id}>{b.nume}</option>)}
          </select>
        </label>
        <label><span>Cod</span><input name="cod" placeholder="echo" required /></label>
        <label><span>Denumire</span><input name="denumire" placeholder="Trening Echo" required /></label>
        <div className="actiuni"><button className="principal">Adaugă model</button></div>
      </fieldset></form></details>}
      {eroare && <p className="eroare">{eroare}</p>}

      <table>
        <thead>
          <tr>
            <th>Model</th><th>Brand</th>
            <th className="nr">Culori</th><th className="nr">Componente</th><th className="nr">Nealocate</th>
            <th className="nr">Operații</th><th className="nr">Timp / buc</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((m) => (
            <tr key={m.id}>
              <td><Link href={`/modele/${m.id}`}>{m.denumire}</Link> <span className="slab">{m.cod}</span></td>
              <td>{m.brand}</td>
              <td className="nr">{m.produse}</td>
              <td className="nr">{m.componente || <span className="lipsa">fără rețetă</span>}</td>
              <td className="nr">{m.nealocate ? <span className="lipsa">{m.nealocate}</span> : '—'}</td>
              <td className="nr">{m.operatii || <span className="slab">—</span>}</td>
              <td className="nr">{m.timp_min ? `${cantitate(m.timp_min)} min` : <span className="slab">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
