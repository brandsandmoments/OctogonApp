import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Termen } from '../Insigne';
import { poate, type Cine } from '../lib/acces';
import { ORIGINI, schimbaBrandMostra, stadiuMostra, type MostraLista } from '../lib/mostre';
import { cere } from '../lib/sesiune';

/** Cine schimbă brandul unei mostre: cine dă mostre (croit, dezvoltare produs) — și adminul. */
export const poateSchimbaMostre = (u: Cine) => poate(u, 'croit', 'modifica') || poate(u, 'dezvoltare', 'modifica');

/**
 * Lista mostrelor (și a comenzilor de croit interne, unde se cer): numărul mst-…, brandul, produsul,
 * mărimile, cât s-a croit / e în lucru / a ieșit / e în depozit și stadiul; cine a dat-o și când.
 * Cine dă mostre poate muta o mostră pe brandul bun (numărul se schimbă odată cu el).
 */
export default function ListaMostre({ lista, branduri, schimba, aici }: {
  lista: MostraLista[]; branduri: { id: string; nume: string }[]; schimba: boolean; aici: string;
}) {
  async function brand(date: FormData) {
    'use server';
    const cine = await cere();
    const la = String(date.get('inapoi') ?? '/mostre');
    const sep = la.includes('?') ? '&' : '?';
    if (!poateSchimbaMostre(cine)) redirect(`${la}${sep}eroare=${encodeURIComponent('Brandul mostrei îl schimbă croitul sau dezvoltarea produsului.')}`);
    const rez = await schimbaBrandMostra(String(date.get('comanda')), String(date.get('brand') ?? ''), cine.nume);
    revalidatePath('/mostre');
    revalidatePath('/croit');
    redirect(`${la}${sep}${'eroare' in rez ? `eroare=${encodeURIComponent(rez.eroare)}` : `ok=${encodeURIComponent(`Mostra are acum brandul bun: ${rez.numar}.`)}`}`);
  }
  if (!lista.length) return <p className="slab">Nicio mostră încă.</p>;
  return (
    <div className="tabel-derulant">
      <table className="centralizator lista-mostre">
        <thead><tr><th>Mostră</th><th>Brand</th><th>Produs</th><th>Mărimi</th><th className="nr">Cerut</th><th className="nr">Croit</th>
          <th className="nr">În lucru</th><th className="nr">Ieșit</th><th className="nr">Depozit</th><th>Stadiu</th><th>Gata până la</th><th>Dată de</th><th /></tr></thead>
        <tbody>
          {lista.map((x) => {
            const [stadiu, ton] = stadiuMostra(x);
            return (
              <tr key={x.comanda_id}>
                <td><strong>{x.numar}</strong>{x.origine !== 'mostra' && <div><span className="insigna albastru">{ORIGINI[x.origine]}</span></div>}</td>
                <td>
                  {x.brand}
                  {schimba && (
                    <details className="schimba-brand">
                      <summary className="slab">schimbă</summary>
                      <form action={brand} className="in-rand">
                        <input type="hidden" name="comanda" value={x.comanda_id} />
                        <input type="hidden" name="inapoi" value={aici} />
                        <select name="brand" defaultValue="" required aria-label={`Brandul bun pentru ${x.numar}`}>
                          <option value="">alege</option>
                          {branduri.filter((b) => b.id !== x.brand_id).map((b) => <option key={b.id} value={b.id}>{b.nume}</option>)}
                        </select>
                        <button className="secundar">Mută</button>
                      </form>
                    </details>
                  )}
                </td>
                <td>{x.produs}{x.din_aplicatie && <> <span className="insigna galben" title="Scris în aplicație, încă nu e în Shopify">nou, nu e în Shopify</span></>}
                  {x.observatii && <div className="slab">{x.observatii}</div>}</td>
                <td className="slab">{x.marimi}</td>
                <td className="nr"><strong>{x.cerut}</strong></td>
                <td className="nr">{x.croit || '—'}</td>
                <td className="nr">{Math.max(0, x.dat - x.gata) || '—'}</td>
                <td className="nr">{x.gata || '—'}</td>
                <td className="nr">{x.depozit || '—'}</td>
                <td><span className={`insigna ${ton}`}>{stadiu}</span></td>
                <td><Termen data={x.data_ceruta} gata={x.depozit >= x.cerut} /></td>
                <td className="slab">{x.creat_de ?? '—'} · {x.creat_la}</td>
                <td>
                  {x.croit < x.cerut
                    ? <Link href={`/croit?vedere=ramas&cauta=${encodeURIComponent(x.numar)}`} className="buton">La croit</Link>
                    : <Link href={`/productie/mostre?cauta=${encodeURIComponent(x.numar)}`} className="buton">În producție</Link>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
