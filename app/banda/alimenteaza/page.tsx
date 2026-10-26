import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { alimenteaza, lotPentruAlimentare } from '../../lib/banda';
import { cantitate, numarDinFormular } from '../../lib/format';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

/** O tranșă nouă pe bandă dintr-un lot croit: câte bucăți intră acum, cine o duce, în cât timp. */
export default async function Alimenteaza({
  searchParams,
}: {
  searchParams: Promise<{ lot?: string; eroare?: string }>;
}) {
  const { lot: lotId, eroare } = await searchParams;
  if (!lotId) notFound();
  const d = await lotPentruAlimentare(lotId);
  if (!d) notFound();
  const { lot, marimi, accesorii } = d;
  const rest = marimi.reduce((s, m) => s + m.rest, 0);

  async function salveaza(date: FormData) {
    'use server';
    const r = await alimenteaza({
      lotId: lotId!,
      cantitati: new Map([...date.entries()].filter(([k]) => k.startsWith('q:'))
        .map(([k, v]) => [k.slice(2), numarDinFormular(v) ?? 0])),
      persoane: numarDinFormular(date.get('persoane')),
      timpMinBuc: numarDinFormular(date.get('timp')),
      responsabil: String(date.get('responsabil') ?? ''),
      observatii: String(date.get('observatii') ?? ''),
    });
    if ('eroare' in r) redirect(`/banda/alimenteaza?lot=${lotId}&eroare=${encodeURIComponent(r.eroare)}`);
    redirect(`/banda/${r.id}`);
  }

  return (
    <main className="formular">
      <p className="slab"><Link href="/banda">← Bandă</Link></p>
      <h1>Dă pe bandă {lot.cod}</h1>
      <p className="sumar">{lot.produs} · {lot.cod_sku} · P{lot.prioritate} · cerut în depozit {lot.data_ceruta}</p>
      {rest === 0 && <p className="slab">Tot lotul e deja pe bandă.</p>}

      <form action={salveaza}>
        <table className="grila">
          <thead><tr><th>Mărime</th><th className="nr">Croit</th><th className="nr">Deja pe bandă</th><th className="nr">Intră acum</th></tr></thead>
          <tbody>
            {marimi.map((m) => (
              <tr key={m.marime_id}>
                <td>{m.marime}</td>
                <td className="nr">{m.croit}</td>
                <td className="nr">{m.alimentat || '—'}</td>
                <td className="nr">
                  <input name={`q:${m.marime_id}`} defaultValue={m.rest || ''} inputMode="numeric" className="bucati"
                    disabled={m.rest === 0} aria-label={`Intră acum ${m.marime}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="antet-comanda">
          <label><span>Responsabil bandă</span><input name="responsabil" /></label>
          <label><span>Persoane pe bandă</span><input name="persoane" inputMode="numeric" /></label>
          <label><span>Minute pe bucată</span><input name="timp" inputMode="decimal" /></label>
          <label className="lat"><span>Observații</span><input name="observatii" /></label>
        </div>
        <p className="slab">Cu persoanele și minutele pe bucată, aplicația estimează data în depozit și marja față de termen.</p>
        {eroare && <p className="eroare">{eroare}</p>}
        <div className="actiuni"><button className="principal" disabled={rest === 0}>Dă pe bandă</button></div>
      </form>

      {accesorii.length > 0 && (
        <>
          <h2>Accesorii care ies din depozit, pe bucată</h2>
          <table>
            <tbody>
              {accesorii.map((a) => (
                <tr key={a.denumire}><td>{a.denumire}</td><td className="nr">{cantitate(a.consum)} <span className="slab">{a.unitate}</span></td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
