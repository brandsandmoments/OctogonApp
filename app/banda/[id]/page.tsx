import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { detaliiTransa, ETAPE_BANDA, schimbaEtapa, type EtapaBanda } from '../../lib/banda';
import { cantitate } from '../../lib/format';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

function inapoi(id: string, eroare: string | null): never {
  redirect(eroare ? `/banda/${id}?eroare=${encodeURIComponent(eroare)}` : `/banda/${id}`);
}

/** Fișa tranșei: bucățile, drumul pe bandă bifat etapă cu etapă, data estimată și accesoriile consumate. */
export default async function TransaPagina({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string }>;
}) {
  const [{ id }, { eroare }] = await Promise.all([params, searchParams]);
  const d = await detaliiTransa(id);
  if (!d) notFound();
  const { transa: t, marimi, accesorii } = d;
  const total = marimi.reduce((s, m) => s + m.cantitate, 0);

  async function etapa(date: FormData) {
    'use server';
    inapoi(id, await schimbaEtapa(id, String(date.get('etapa')) as EtapaBanda, date.get('bifat') === '1'));
  }

  return (
    <main className="formular">
      <p className="slab"><Link href="/banda?vedere=pe_banda">← Bandă</Link></p>
      <h1>{t.cod}</h1>
      <p className="sumar">
        {t.produs} · {t.cod_sku} · P{t.prioritate} · cerut în depozit {t.data_ceruta} · alimentat {t.alimentat_la}
        {t.responsabil && ` · ${t.responsabil}`} · <Link href={`/croit/${t.lot_id}`}>lotul croit</Link>
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      <table className="grila">
        <thead><tr>{marimi.map((m) => <th key={m.marime} className="nr">{m.marime}</th>)}<th className="nr">Total</th></tr></thead>
        <tbody><tr>{marimi.map((m) => <td key={m.marime} className="nr">{m.cantitate}</td>)}<td className="nr"><strong>{total}</strong></td></tr></tbody>
      </table>

      <dl className="cifre-birou">
        <div><dt>Estimat în depozit</dt><dd>{t.eta ?? '—'}</dd></div>
        <div className={t.marja_zile !== null && t.marja_zile < 0 ? 'lipsa' : ''}>
          <dt>Marjă față de termen</dt>
          <dd>{t.marja_zile === null ? '—' : `${t.marja_zile > 0 ? '+' : ''}${t.marja_zile}`} <span>zile</span></dd>
        </div>
        <div><dt>Ore-om</dt><dd>{t.ore_om ? cantitate(t.ore_om) : '—'}</dd></div>
      </dl>
      {!t.eta && <p className="slab">Fără persoane și minute pe bucată nu se estimează data în depozit.</p>}

      <h2>Pe bandă</h2>
      <ol className="etape">
        {ETAPE_BANDA.map(([k, nume]) => (
          <li key={k} className={t[k] ? 'bifat' : ''}>
            <form action={etapa}>
              <input type="hidden" name="etapa" value={k} />
              <input type="hidden" name="bifat" value={t[k] ? '0' : '1'} />
              <button className="bifa-etapa" aria-pressed={Boolean(t[k])}
                aria-label={`${t[k] ? 'Debifează' : 'Bifează'} ${nume}`}>{t[k] ? '✓' : ''}</button>
            </form>
            <span>{nume}</span>
            {t[k] && <span className="slab">{t[k]}</span>}
          </li>
        ))}
      </ol>

      {accesorii.length > 0 && (
        <>
          <h2>Accesorii scăzute din stoc</h2>
          <table>
            <tbody>
              {accesorii.map((a) => (
                <tr key={a.material_id}>
                  <td><Link href={`/stoc/${a.material_id}`}>{a.denumire}</Link></td>
                  <td className="nr">{cantitate(a.consumat)} <span className="slab">{a.unitate}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
