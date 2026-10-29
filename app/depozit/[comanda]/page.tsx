import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { comandaDepozit, intrareManuala, stingeComanda } from '../../lib/depozit';
import { numarDinFormular } from '../../lib/format';
import { motiveReceptie } from '../../lib/receptie';
import { cere, poateModifica } from '../../lib/sesiune';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

const inapoi = (numar: string, e?: string | null): never =>
  redirect(`/depozit/${encodeURIComponent(numar)}${e ? `?eroare=${encodeURIComponent(e)}` : ''}`);

/**
 * O comandă în depozit: pe fiecare poziție cât s-a cerut, cât a intrat și cât
 * lipsește; câte au venit azi, scris de mână; istoricul intrărilor; și stingerea
 * comenzii la un clic, cu motiv și observații. Doar KAM-ii, depozitul și contul
 * master (dreptul „Recepție", modifică).
 */
export default async function ComandaDepozitPagina({
  params, searchParams,
}: {
  params: Promise<{ comanda: string }>;
  searchParams: Promise<{ eroare?: string }>;
}) {
  await cere('receptie');
  const m = await poateModifica('receptie');
  const [{ comanda: brut }, { eroare }] = await Promise.all([params, searchParams]);
  const numar = decodeURIComponent(brut);
  const [d, motive] = await Promise.all([comandaDepozit(numar), motiveReceptie()]);
  if (!d) notFound();
  const { comanda: c, pozitii, intrari } = d;
  const deschise = pozitii.filter((p) => !p.inchisa && p.intrat < p.cerut);

  async function intra(date: FormData) {
    'use server';
    await cere('receptie', 'modifica');
    const q = new Map([...date.entries()].filter(([k]) => k.startsWith('q:'))
      .map(([k, v]) => [k.slice(2), String(v).trim() ? numarDinFormular(v) ?? -1 : 0]));
    inapoi(numar, await intrareManuala(numar, q, String(date.get('observatii') ?? '')));
  }
  async function stinge(date: FormData) {
    'use server';
    await cere('receptie', 'modifica');
    inapoi(numar, await stingeComanda(numar, String(date.get('motiv') ?? ''), String(date.get('observatii') ?? '')));
  }

  return (
    <main className="formular lat">
      <p className="slab"><Link href="/depozit">← Depozit</Link></p>
      <h1>{c.numar}</h1>
      <p className="sumar">
        {c.tip} · {c.brand} · {c.kam ?? 'fără KAM'} · termen {c.termen ?? '—'} · cerut {c.cerut} · intrat {c.intrat} ·{' '}
        <strong>{c.finalizata ? 'stinsă' : `lipsesc ${c.lipsesc}`}</strong>
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      <form action={intra}><fieldset disabled={!m || deschise.length === 0} className="fara-chenar">
        <div className="tabel-derulant">
          <table className="grila">
            <thead><tr><th>Produs</th><th>Mărime</th><th className="nr">Cerut</th><th className="nr">Intrat</th><th className="nr">Lipsesc</th><th>Azi au venit</th></tr></thead>
            <tbody>
              {pozitii.map((p) => {
                const lipsesc = Math.max(p.cerut - p.intrat, 0);
                return (
                  <tr key={`${p.linie_id}:${p.marime_id}`}>
                    <td>{p.produs} <span className="slab">{p.cod_sku}</span></td>
                    <td>{p.marime}</td>
                    <td className="nr">{p.cerut}</td>
                    <td className="nr">{p.intrat || '—'}</td>
                    <td className="nr">{p.inchisa ? <span className="slab">închisă{p.motiv ? ` — ${p.motiv}` : ''}</span> : lipsesc || '—'}</td>
                    <td>
                      {!p.inchisa && (
                        <input name={`q:${p.linie_id}:${p.marime_id}`} inputMode="numeric" className="bucati"
                               placeholder={lipsesc ? String(lipsesc) : '0'} aria-label={`Azi ${p.produs} ${p.marime}`} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {deschise.length > 0 && (
          <div className="antet-comanda">
            <label className="lat"><span>Observații</span><input name="observatii" placeholder="opțional" /></label>
            <p className="slab lat">Ce nu vine azi rămâne de stins. Peste cerut se poate, dacă a venit fizic.</p>
            <div className="actiuni"><button className="principal">Înregistrează ce a venit azi</button></div>
          </div>
        )}
      </fieldset></form>

      {!c.finalizata && m && (
        <details>
          <summary>Stinge comanda — restul nu mai vine</summary>
          <form action={stinge} className="antet-comanda">
            <label>
              <span>Motiv</span>
              <input name="motiv" list="motive-depozit" required placeholder="din listă sau scrie ce vrei" />
              <datalist id="motive-depozit">{motive.map((x) => <option key={x.id} value={x.nume} />)}</datalist>
            </label>
            <label><span>Observații</span><input name="observatii" placeholder="opțional" /></label>
            <div className="actiuni"><button className="secundar">Stinge comanda ({c.lipsesc} buc nu mai vin)</button></div>
          </form>
        </details>
      )}

      {intrari.length > 0 && (
        <>
          <h2>Intrări</h2>
          <table>
            <thead><tr><th>Când</th><th>Cine</th><th>Produs</th><th>Mărime</th><th className="nr">Buc</th><th>Observații</th></tr></thead>
            <tbody>
              {intrari.map((x, i) => (
                <tr key={i}>
                  <td className="slab">{x.la}</td>
                  <td>{x.cine ?? '—'}</td>
                  <td>{x.produs}</td>
                  <td>{x.marime}</td>
                  <td className="nr">{x.cantitate}</td>
                  <td className="slab">{[x.inchide && `închisă${x.motiv ? ` — ${x.motiv}` : ''}`, x.observatii].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
