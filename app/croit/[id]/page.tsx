import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { bifeazaEtapa, detaliiLot, inregistreazaCroit } from '../../lib/croit';
import { cantitate, numarDinFormular } from '../../lib/format';
import { motiveCroit } from '../../lib/planificare';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

function inapoi(id: string, eroare: string | null): never {
  redirect(eroare ? `/croit/${id}?eroare=${encodeURIComponent(eroare)}` : `/croit/${id}`);
}

/**
 * Fișa lotului, cum o vede croitul: ce i se cere pe mărimi, etapele bifate pe
 * măsură ce se fac, și la final ce s-a croit efectiv — care scade stofa din stoc.
 */
export default async function LotPagina({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string }>;
}) {
  const [{ id }, { eroare }] = await Promise.all([params, searchParams]);
  const [d, motive] = await Promise.all([detaliiLot(id), motiveCroit()]);
  if (!d) notFound();
  const { lot, marimi, etape, consum } = d;
  const croit = Boolean(lot.croit_la);
  const principal = consum.find((m) => m.principal);

  async function etapa(date: FormData) {
    'use server';
    await bifeazaEtapa(id, String(date.get('etapa')), date.get('bifat') === '1');
    inapoi(id, null);
  }

  async function inregistreaza(date: FormData) {
    'use server';
    inapoi(id, await inregistreazaCroit({
      lotId: id,
      croit: new Map([...date.entries()].filter(([k]) => k.startsWith('q:'))
        .map(([k, v]) => [k.slice(2), numarDinFormular(v) ?? -1])),
      motivId: String(date.get('motiv') ?? '') || null,
      consumPrincipal: numarDinFormular(date.get('consum')),
      incheie: date.get('incheie') === '1',
      motivIncheiereId: null,
    }));
  }

  return (
    <main className="formular">
      <p className="slab"><Link href="/croit?vedere=ramas">← Croit</Link></p>
      <h1>{lot.cod}</h1>
      <p className="sumar">
        {lot.produs} · {lot.cod_sku} · P{lot.prioritate} · cerut în depozit {lot.data_ceruta} · primit {lot.primit_la}
        {croit && <> · <strong>croit {lot.croit_la}</strong></>}
        {' · '}<Link href={`/planificare/${lot.planificare_id}`}>planificarea</Link>
        {croit && <>{' · '}<Link href={`/banda/alimenteaza?lot=${lot.id}`}>dă pe bandă</Link></>}
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      <h2>Etape</h2>
      <ol className="etape">
        {etape.map((e) => (
          <li key={e.id} className={e.bifat_la ? 'bifat' : ''}>
            <form action={etapa}>
              <input type="hidden" name="etapa" value={e.id} />
              <input type="hidden" name="bifat" value={e.bifat_la ? '0' : '1'} />
              <button className="bifa-etapa" disabled={croit} aria-pressed={Boolean(e.bifat_la)}
                aria-label={`${e.bifat_la ? 'Debifează' : 'Bifează'} ${e.nume}`}>
                {e.bifat_la ? '✓' : ''}
              </button>
            </form>
            <span>{e.nume}</span>
            {e.bifat_la && <span className="slab">{e.bifat_la}</span>}
          </li>
        ))}
      </ol>

      <h2>{croit ? 'Croit' : 'De croit'}</h2>
      <form action={inregistreaza}>
        <table className="grila">
          <thead><tr><th>Mărime</th><th className="nr">Cerut</th><th className="nr">Croit efectiv</th>{croit && <th>Motiv</th>}</tr></thead>
          <tbody>
            {marimi.map((m) => (
              <tr key={m.marime_id}>
                <td>{m.marime}</td>
                <td className="nr">{m.cerut}</td>
                <td className="nr">
                  {croit
                    ? <span className={m.croit !== m.cerut ? 'lipsa' : ''}>{m.croit}</span>
                    : <input name={`q:${m.marime_id}`} defaultValue={m.cerut} inputMode="numeric"
                        className="bucati" aria-label={`Croit ${m.marime}`} />}
                </td>
                {croit && <td className="slab">{m.motiv ?? ''}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td><strong>Total</strong></td>
              <td className="nr"><strong>{marimi.reduce((s, m) => s + m.cerut, 0)}</strong></td>
              <td className="nr"><strong>{croit ? marimi.reduce((s, m) => s + (m.croit ?? 0), 0) : ''}</strong></td>
              {croit && <td />}</tr>
          </tfoot>
        </table>

        {!croit && (
          <div className="antet-comanda">
            <label>
              <span>Motiv, dacă diferă de cerut</span>
              <select name="motiv" defaultValue="">
                <option value="">—</option>
                {motive.map((m) => <option key={m.id} value={m.id}>{m.nume}</option>)}
              </select>
            </label>
            {principal && (
              <label>
                <span>{principal.denumire} consumat ({principal.unitate})</span>
                <input name="consum" inputMode="decimal"
                  placeholder={`teoretic ${cantitate(principal.teoretic)}`} />
              </label>
            )}
            <label className="lat bifa-linie">
              <input type="checkbox" name="incheie" value="1" />
              Ce nu s-a croit nu se mai croiește — încheie planificarea
            </label>
            <div className="actiuni"><button className="principal">Înregistrează croitul</button></div>
          </div>
        )}
      </form>

      {[['materie_prima', 'Materie primă — scade din stoc la croit'],
        ['accesoriu', 'Accesorii — scad la alimentarea benzii']].map(([tip, titlu]) => {
        const lista = consum.filter((m) => m.tip === tip);
        if (lista.length === 0) return null;
        return (
          <section key={tip}>
            <h2>{titlu}</h2>
            <table>
              <thead><tr><th>Material</th><th className="nr">Teoretic</th><th className="nr">{croit && tip === 'materie_prima' ? 'Scăzut din stoc' : ''}</th></tr></thead>
              <tbody>
                {lista.map((m) => (
                  <tr key={m.material_id}>
                    <td><Link href={`/stoc/${m.material_id}`}>{m.denumire}</Link>{m.principal && <span className="slab"> · principal</span>}</td>
                    <td className="nr">{cantitate(m.teoretic)} <span className="slab">{m.unitate}</span></td>
                    <td className="nr">{m.consumat ? cantitate(m.consumat) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </main>
  );
}
