import Link from 'next/link';
import { cere, poateModifica } from '../../lib/sesiune';
import { notFound, redirect } from 'next/navigation';
import { bifeazaEtapa, detaliiLot } from '../../lib/croit';
import { cantitate } from '../../lib/format';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

function inapoi(id: string, eroare: string | null): never {
  redirect(eroare ? `/croit/${id}?eroare=${encodeURIComponent(eroare)}` : `/croit/${id}`);
}

/**
 * Fișa lotului — o comandă dintr-o taiere: ce i se cere pe mărimi, etapele bifate
 * pe măsură ce se fac și ce s-a croit. Croitul se înregistrează pe fișa taierii,
 * odată pentru toate comenzile tăiate împreună.
 */
export default async function LotPagina({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string }>;
}) {
  await cere('croit');
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('croit');
  const peBanda = await poateModifica('banda');
  const [{ id }, { eroare }] = await Promise.all([params, searchParams]);
  const d = await detaliiLot(id);
  if (!d) notFound();
  const { lot, marimi, etape, consum } = d;
  const croit = Boolean(lot.croit_la);

  async function etapa(date: FormData) {
    'use server';
    await cere('croit', 'modifica');
    await bifeazaEtapa(id, String(date.get('etapa')), date.get('bifat') === '1');
    inapoi(id, null);
  }

  return (
    <main className="formular">
      <p className="slab"><Link href="/croit?vedere=ramas">← Croit</Link></p>
      <h1>{lot.cod}</h1>
      <p className="sumar">
        {lot.produs} · {lot.cod_sku} · P{lot.prioritate} · cerut în depozit {lot.data_ceruta} · primit {lot.primit_la}
        {croit && <> · <strong>croit {lot.croit_la}</strong></>}
        {lot.taiere_id && <>{' · '}<Link href={`/croit/taiere/${lot.taiere_id}`}>taierea {lot.taiere}</Link></>}
        {' · '}<Link href={`/planificare/${lot.planificare_id}`}>planificarea</Link>
        {croit && peBanda && <>{' · '}<Link href={`/banda/alimenteaza?lot=${lot.id}`}>dă pe bandă</Link></>}
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      <h2>Etape</h2>
      <ol className="etape">
        {etape.map((e) => (
          <li key={e.id} className={e.bifat_la ? 'bifat' : ''}>
            <form action={etapa}><fieldset disabled={!m} className="fara-chenar">
              <input type="hidden" name="etapa" value={e.id} />
              <input type="hidden" name="bifat" value={e.bifat_la ? '0' : '1'} />
              <button className="bifa-etapa" disabled={croit} aria-pressed={Boolean(e.bifat_la)}
                aria-label={`${e.bifat_la ? 'Debifează' : 'Bifează'} ${e.nume}`}>
                {e.bifat_la ? '✓' : ''}
              </button>
            </fieldset></form>
            <span>{e.nume}</span>
            {e.bifat_la && <span className="slab">{e.bifat_la}</span>}
          </li>
        ))}
      </ol>

      <h2>{croit ? 'Croit' : 'De croit'}</h2>
      <table className="grila">
        <thead><tr><th>Mărime</th><th className="nr">Cerut</th><th className="nr">Croit efectiv</th><th>Motiv</th></tr></thead>
        <tbody>
          {marimi.map((m) => (
            <tr key={m.marime_id}>
              <td>{m.marime}</td>
              <td className="nr">{m.cerut}</td>
              <td className="nr"><span className={croit && m.croit !== m.cerut ? 'lipsa' : ''}>{m.croit ?? '—'}</span></td>
              <td className="slab">{m.motiv ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!croit && lot.taiere_id && (
        <p><Link href={`/croit/taiere/${lot.taiere_id}`} className="buton">Croitul se înregistrează pe fișa taierii {lot.taiere}</Link></p>
      )}

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
