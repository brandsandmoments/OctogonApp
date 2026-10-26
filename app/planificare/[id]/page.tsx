import Link from 'next/link';
import { cere, poateModifica } from '../../lib/sesiune';
import { notFound, redirect } from 'next/navigation';
import { cantitate } from '../../lib/format';
import { anuleazaPlanificare, detaliiPlanificare, incheie, lanseazaSpreCroit, motiveCroit } from '../../lib/planificare';
import { STADII } from '../../lib/stadii';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

function inapoi(id: string, eroare: string | null): never {
  redirect(eroare ? `/planificare/${id}?eroare=${encodeURIComponent(eroare)}` : `/planificare/${id}`);
}

export default async function PlanificarePagina({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string }>;
}) {
  await cere('planificare');
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('planificare');
  const [{ id }, { eroare }] = await Promise.all([params, searchParams]);
  const [d, motive] = await Promise.all([detaliiPlanificare(id), motiveCroit()]);
  if (!d) notFound();
  const { plan, marimi, loturi, materiale } = d;
  const rest = marimi.reduce((s, m) => s + m.rest, 0);
  const activa = !['anulat', 'incheiat'].includes(plan.stadiu);
  const lotDeschis = loturi.some((l) => !l.croit_la);

  async function lanseaza() { 'use server'; await cere('planificare', 'modifica'); inapoi(id, await lanseazaSpreCroit(id)); }
  async function anuleaza() { 'use server'; await cere('planificare', 'modifica'); inapoi(id, await anuleazaPlanificare(id)); }
  async function inchide(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    inapoi(id, await incheie(id, String(date.get('motiv') ?? '') || null));
  }

  return (
    <main className="formular">
      <p className="slab"><Link href="/planificare">← Planificare</Link></p>
      <h1>{plan.cod}</h1>
      <p className="sumar">
        {plan.produs} · {plan.cod_sku} · P{plan.prioritate} · cerut în depozit {plan.data_ceruta} ·{' '}
        <strong>{STADII[plan.stadiu] ?? plan.stadiu}</strong>
        {plan.motiv_incheiere && ` — ${plan.motiv_incheiere}`}
        {plan.taiere_id && <> · în taierea <Link href={`/planificare/taiere/${plan.taiere_id}`}>{plan.taiere}</Link></>}
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      <table>
        <thead><tr><th>Mărime</th><th className="nr">Planificat</th><th className="nr">Croit</th><th className="nr">Rest de croit</th></tr></thead>
        <tbody>
          {marimi.map((m) => (
            <tr key={m.marime}>
              <td>{m.marime}</td><td className="nr">{m.planificat}</td>
              <td className="nr">{m.croit || '—'}</td><td className="nr">{m.rest || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {activa && materiale.length > 0 && (
        <>
          <h2>Materiale pentru ce a rămas de croit</h2>
          <table>
            <thead><tr><th>Material</th><th className="nr">Necesar</th><th className="nr">Stoc</th><th className="nr">Luat înainte</th><th /></tr></thead>
            <tbody>
              {materiale.map((m) => (
                <tr key={m.material_id}>
                  <td><Link href={`/stoc/${m.material_id}`}>{m.denumire}</Link>{m.principal && <span className="slab"> · principal</span>}</td>
                  <td className="nr">{cantitate(m.necesar)} <span className="slab">{m.unitate}</span></td>
                  <td className="nr">{cantitate(m.stoc)}</td>
                  {/* Ce au rezervat planificările cu prioritate mai mare: stocul le acoperă întâi pe ele. */}
                  <td className="nr slab">{Number(m.inaintea_ei) ? cantitate(m.inaintea_ei) : '—'}</td>
                  <td>{m.acoperit ? <span className="slab">acoperit</span>
                    : m.principal ? <span className="lipsa">lipsă — oprește lansarea</span>
                    : <span className="slab">lipsă</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {loturi.length > 0 && (
        <>
          <h2>Loturi de croit</h2>
          <table>
            <tbody>
              {loturi.map((l) => (
                <tr key={l.id}>
                  <td><Link href={`/croit/${l.id}`}>{l.cod}</Link></td>
                  <td className="nr">cerut {l.cerut}</td>
                  <td className="nr">{l.croit_la ? `croit ${l.croit} · ${l.croit_la}` : <strong>de croit</strong>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {activa && (
        <div className="actiuni">
          {rest > 0 && !lotDeschis && plan.taiere_id && !plan.taiere_trimisa && (
            <p className="slab">Pleacă la croit odată cu taierea <Link href={`/planificare/taiere/${plan.taiere_id}`}>{plan.taiere}</Link>.</p>
          )}
          {/* După ce taierea a plecat, ce a rămas necroit se poate relansa de aici. */}
          {rest > 0 && !lotDeschis && (!plan.taiere_id || plan.taiere_trimisa) && (
            <form action={lanseaza}><fieldset disabled={!m} className="fara-chenar"><button className="principal">{loturi.length ? `Relansează restul spre croit (${rest} buc)` : `Lansează spre croit (${rest} buc)`}</button></fieldset></form>
          )}
          {loturi.length === 0 && (
            <form action={anuleaza}><fieldset disabled={!m} className="fara-chenar"><button className="secundar">Anulează planificarea</button></fieldset></form>
          )}
        </div>
      )}

      {activa && loturi.length > 0 && !lotDeschis && (
        <form action={inchide} className="antet-comanda"><fieldset disabled={!m} className="fara-chenar">
          {rest > 0 && (
            <label>
              <span>De ce nu se mai croiesc {rest} buc</span>
              <select name="motiv" defaultValue="" required>
                <option value="">—</option>
                {motive.map((m) => <option key={m.id} value={m.id}>{m.nume}</option>)}
              </select>
            </label>
          )}
          <div className="actiuni"><button className="secundar">Încheie planificarea</button></div>
        </fieldset></form>
      )}
    </main>
  );
}
