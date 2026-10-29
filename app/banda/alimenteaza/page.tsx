import Link from 'next/link';
import { cere } from '../../lib/sesiune';
import { notFound, redirect } from 'next/navigation';
import { alimenteaza, lotPentruAlimentare } from '../../lib/banda';
import { numarDinFormular } from '../../lib/format';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

/** O tranșă nouă pe bandă dintr-un lot croit: câte bucăți intră acum, cine o duce, în cât timp. */
export default async function Alimenteaza({
  searchParams,
}: {
  searchParams: Promise<{ lot?: string; eroare?: string }>;
}) {
  await cere('banda', 'modifica');
  const { lot: lotId, eroare } = await searchParams;
  if (!lotId) notFound();
  const d = await lotPentruAlimentare(lotId);
  if (!d) notFound();
  const { lot, marimi } = d;
  const rest = marimi.reduce((s, m) => s + m.rest, 0);

  async function salveaza(date: FormData) {
    'use server';
    await cere('banda', 'modifica');
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
          <label className="lat"><span>Operatorii care lucrează la produs</span><input name="responsabil" placeholder="ex. Maria, Elena, Ioana" /></label>
          <label><span>Număr de operatori</span><input name="persoane" inputMode="numeric" /></label>
          <label><span>Minute pe bucată</span><input name="timp" inputMode="decimal" defaultValue={lot.timp_min_buc ? Number(lot.timp_min_buc) : ''} /></label>
          <label className="lat"><span>Observații</span><input name="observatii" /></label>
        </div>
        <p className="slab">
          Minutele pe bucată vin din fișa de produs{lot.timp_min_buc ? '' : ' (modelul n-are încă timpul trecut: scrie-l aici)'}. Timpul
          tranșei = bucăți × minute pe bucată, cu +20% sub 50 de bucăți și −15% peste 200; împărțit la operatori și la orele
          pe zi, dă data estimată în depozit și marja față de termen.
        </p>
        {eroare && <p className="eroare">{eroare}</p>}
        <div className="actiuni"><button className="principal" disabled={rest === 0}>Dă pe bandă</button></div>
      </form>

    </main>
  );
}
