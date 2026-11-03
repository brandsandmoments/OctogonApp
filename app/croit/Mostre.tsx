import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Termen } from '../Insigne';
import { adaugaZile } from '../lib/perioade';
import { azi, numarDinFormular, potriveste } from '../lib/format';
import { daMostraLaCroit, mostreSiComenziCroit, nomenclatoareMostre, ORIGINI, type OrigineCroit } from '../lib/mostre';
import { poate, type Cine } from '../lib/acces';
import { cere, utilizatorCurent } from '../lib/sesiune';
import VariatiiMostra from './VariatiiMostra';

/** Cine dă mostre și comenzi de croit: cine modifică la croit (șefa de croit) sau la dezvoltare produs. */
const poateDa = (u: Cine) => poate(u, 'croit', 'modifica') || poate(u, 'dezvoltare', 'modifica');

/**
 * „Mostre": șefa de croit și dezvoltarea produsului își dau singure la croit o mostră sau
 * o comandă de croit (ceva ce nu era pe listă) — produsul ales din listă sau scris de mână,
 * cu culoarea și mărimile. Devine o comandă PSF internă, fără KAM: apare în „Rămas de croit"
 * (cu „Dă la croit și croiește acum" se deschide direct acolo) și apoi în producție.
 * Dedesubt, mostrele și comenzile date așa, cu cât s-a croit și cât a ieșit din lucru.
 */
export default async function Mostre({ cauta, ok }: { cauta?: string; ok?: string }) {
  const u = await utilizatorCurent();
  const m = Boolean(u && poateDa(u));
  const [{ branduri, produse, marimi }, toate] = await Promise.all([nomenclatoareMostre(), mostreSiComenziCroit()]);
  const lista = toate.filter((x) => potriveste(cauta, x.numar, x.produs, x.creat_de ?? '', x.observatii ?? ''));

  async function da(date: FormData) {
    'use server';
    const cine = await cere('croit');
    if (!poateDa(cine)) redirect(`/croit?vedere=mostre&eroare=${encodeURIComponent('Mostrele le dau șefa de croit și dezvoltarea produsului.')}`);
    const rez = await daMostraLaCroit({
      origine: (date.get('origine') === 'croit' ? 'croit' : 'mostra') as OrigineCroit,
      brandId: String(date.get('brand') ?? ''),
      produs: String(date.get('produs') ?? ''),
      // Fiecare rând de culoare: cul:N și q:N:mărime.
      variatii: [...date.keys()].filter((k) => k.startsWith('cul:')).map((k) => {
        const n = k.slice(4);
        return {
          culoare: String(date.get(k) ?? ''),
          cantitati: Object.fromEntries([...date.keys()].filter((q) => q.startsWith(`q:${n}:`))
            .map((q) => [q.slice(`q:${n}:`.length), numarDinFormular(date.get(q)) ?? 0])),
        };
      }),
      dataCeruta: String(date.get('data') ?? ''),
      prioritate: numarDinFormular(date.get('prioritate')) ?? 2,
      observatii: String(date.get('observatii') ?? ''),
    });
    if ('eroare' in rez) redirect(`/croit?vedere=mostre&eroare=${encodeURIComponent(rez.eroare)}`);
    if (date.get('dupa') === 'croieste') redirect(`/croit?vedere=ramas&cauta=${encodeURIComponent(rez.numar)}`);
    redirect(`/croit?vedere=mostre&ok=${encodeURIComponent(`${rez.numar} a fost dată la croit.`)}`);
  }

  return (
    <>
      {ok && <p className="insigna verde">{ok}</p>}
      {m && (
        <form action={da} className="formular-mostra">
          <h2>Dă la croit o mostră sau o comandă</h2>
          <fieldset className="ce-dai">
            <legend className="slab">Ce dai</legend>
            {(Object.keys(ORIGINI) as OrigineCroit[]).map((k, i) => (
              <label key={k}><input type="radio" name="origine" value={k} defaultChecked={i === 0} /> {ORIGINI[k]}</label>
            ))}
            <span className="slab">— comanda de croit e pentru ce se croiește și nu era pe listă.</span>
          </fieldset>
          <div className="campuri-mostra">
            <label><span>Brand</span>
              <select name="brand" required defaultValue={branduri.length === 1 ? branduri[0].id : ''}>
                <option value="">alege</option>
                {branduri.map((b) => <option key={b.id} value={b.id}>{b.nume}</option>)}
              </select>
            </label>
            <label className="lat"><span>Produs</span>
              <input name="produs" list="produse-mostra" required placeholder="alege din listă sau scrie denumirea fără culoare (ex. Rochie Sofia)" />
              <datalist id="produse-mostra">{produse.map((p) => <option key={p} value={p} />)}</datalist>
            </label>
            <label><span>Gata până la</span><input type="date" name="data" required defaultValue={adaugaZile(azi(), 7)} /></label>
            <label><span>Prioritate</span>
              <select name="prioritate" defaultValue="2">{[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}</select>
            </label>
          </div>
          <div>
            <span className="slab">Culori și bucăți pe mărimi — același produs în mai multe culori: „+ Adaugă culoare"</span>
            <VariatiiMostra marimi={marimi} />
          </div>
          <label className="lat"><span>Observații</span><input name="observatii" placeholder="opțional: material, pentru cine e mostra…" /></label>
          <p className="slab">Un produs care nu e în listă (încă nu e în Shopify) se creează din denumire și culoare — câte unul pe fiecare culoare. Comanda pleacă direct în „Rămas de croit"; croită, mostra apare în Producție → Mostre.</p>
          <div className="actiuni">
            <button className="secundar">Dă la croit</button>
            <button name="dupa" value="croieste" className="principal">Dă la croit și croiește acum</button>
          </div>
        </form>
      )}

      <h2>Mostre și comenzi de croit</h2>
      {lista.length === 0 ? <p className="slab">Nicio mostră dată încă.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Comandă</th><th>Ce</th><th>Produs</th><th>Mărimi</th><th className="nr">Cerut</th><th className="nr">Croit</th>
              <th className="nr">În lucru</th><th className="nr">Ieșit</th><th>Gata până la</th><th>Dată de</th><th /></tr></thead>
            <tbody>
              {lista.map((x) => (
                <tr key={x.comanda_id}>
                  <td><strong>{x.numar}</strong></td>
                  <td><span className={`insigna ${x.origine === 'mostra' ? 'violet' : 'albastru'}`}>{ORIGINI[x.origine]}</span></td>
                  <td>{x.produs}{x.din_aplicatie && <> <span className="insigna galben" title="Scris în aplicație, încă nu e în Shopify">nou, nu e în Shopify</span></>}
                    {x.observatii && <div className="slab">{x.observatii}</div>}</td>
                  <td className="slab">{x.marimi}</td>
                  <td className="nr"><strong>{x.cerut}</strong></td>
                  <td className="nr">{x.croit || '—'}</td>
                  <td className="nr">{Math.max(0, x.dat - x.gata) || '—'}</td>
                  <td className="nr">{x.gata || '—'}</td>
                  <td><Termen data={x.data_ceruta} gata={x.gata >= x.cerut} /></td>
                  <td className="slab">{x.creat_de ?? '—'} · {x.creat_la}</td>
                  <td>
                    {x.croit < x.cerut
                      ? <Link href={`/croit?vedere=ramas&cauta=${encodeURIComponent(x.numar)}`} className="buton">Croiește</Link>
                      : <Link href={`/productie/mostre?cauta=${encodeURIComponent(x.numar)}`} className="buton">În producție</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
