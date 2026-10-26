import Link from 'next/link';
import { cere } from '../../lib/sesiune';
import { notFound, redirect } from 'next/navigation';
import { numarDinFormular } from '../../lib/format';
import { creeazaPlanificare, liniePentruPlanificare } from '../../lib/planificare';
import { taieriDeschisePeModel } from '../../lib/taiere';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

/** Planificare nouă pe o linie: câte bucăți din fiecare mărime intră acum în producție. */
export default async function PlanificareNoua({
  searchParams,
}: {
  searchParams: Promise<{ linie?: string; eroare?: string }>;
}) {
  await cere('planificare', 'modifica');
  const { linie: linieId, eroare } = await searchParams;
  if (!linieId) notFound();
  const d = await liniePentruPlanificare(linieId);
  if (!d) notFound();
  const { linie, marimi } = d;
  const taieri = await taieriDeschisePeModel(linie.model_cheie);

  async function salveaza(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    const cantitati = new Map(
      [...date.entries()].filter(([k]) => k.startsWith('q:'))
        .map(([k, v]) => [k.slice(2), numarDinFormular(v) ?? 0]),
    );
    const r = await creeazaPlanificare(linieId!, cantitati, String(date.get('observatii') ?? ''),
      String(date.get('taiere') ?? '') || undefined);
    if ('eroare' in r) redirect(`/planificare/nou?linie=${linieId}&eroare=${encodeURIComponent(r.eroare)}`);
    redirect(`/planificare/${r.id}`);
  }

  return (
    <main className="formular">
      <p className="slab"><Link href="/planificare">← Planificare</Link></p>
      <h1>Planifică {linie.produs}</h1>
      <p className="sumar">{linie.comanda} · {linie.tip} · P{linie.prioritate} · cerut în depozit {linie.data_ceruta} · {linie.cod_sku}</p>
      {!linie.are_reteta && <p className="eroare">Produsul nu are rețetă: completează întâi rețeta modelului.</p>}

      <form action={salveaza}>
        <div className="tabel-derulant">
          <table className="grila">
            <thead>
              <tr><th>Mărime</th><th className="nr">Cerut</th><th className="nr">Deja planificat</th><th className="nr">Planifică acum</th></tr>
            </thead>
            <tbody>
              {marimi.map((m) => (
                <tr key={m.marime_id}>
                  <td>{m.marime}</td>
                  <td className="nr">{m.cerut}</td>
                  <td className="nr">{m.planificat || '—'}</td>
                  <td className="nr">
                    {/* Propunerea e tot restul; planificatorul scade ce nu intră acum. */}
                    <input name={`q:${m.marime_id}`} defaultValue={m.rest || ''} inputMode="numeric"
                      className="bucati" disabled={m.rest === 0} aria-label={`Planifică ${m.marime}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {taieri.length > 0 && (
          <label className="antet-comanda">
            <span>Se taie</span>
            <select name="taiere" defaultValue="">
              <option value="">separat, într-o taiere nouă</option>
              {taieri.map((t) => <option key={t.id} value={t.id}>împreună cu {t.cod}</option>)}
            </select>
          </label>
        )}
        <label className="antet-comanda"><span>Observații</span><input name="observatii" /></label>
        {eroare && <p className="eroare">{eroare}</p>}
        <div className="actiuni"><button className="principal">Salvează planificarea</button></div>
      </form>
    </main>
  );
}
