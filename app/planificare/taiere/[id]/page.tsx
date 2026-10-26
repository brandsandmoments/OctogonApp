import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cantitate } from '../../../lib/format';
import { deplanificat } from '../../../lib/planificare';
import { cere, poateModifica } from '../../../lib/sesiune';
import { STADII } from '../../../lib/stadii';
import { detaliiTaiere, grupeaza, scoate, trimiteLaCroit } from '../../../lib/taiere';
import '../../../formulare.css';

export const dynamic = 'force-dynamic';

const inapoi = (id: string, e?: string | null): never =>
  redirect(e ? `/planificare/taiere/${id}?eroare=${encodeURIComponent(e)}` : `/planificare/taiere/${id}`);

/**
 * O taiere: comenzile care se taie împreună, necesarul lor adunat și, cât timp
 * n-a plecat la croit, comenzile de pe același model care se mai pot adăuga.
 */
export default async function TaierePagina({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string }>;
}) {
  await cere('planificare');
  const m = await poateModifica('planificare');
  const [{ id }, { eroare }] = await Promise.all([params, searchParams]);
  const t = await detaliiTaiere(id);
  if (!t) notFound();
  const deschisa = !t.trimis_la;
  const deAdaugat = deschisa ? (await deplanificat()).filter((l) => l.model_cheie === t.model_cheie && l.are_reteta) : [];

  const ultima = t.planificari.length === 1;
  async function adauga(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    const r = await grupeaza(date.getAll('linie').map(String), id);
    inapoi(id, 'eroare' in r ? r.eroare : null);
  }
  async function scoateComanda(date: FormData) {
    'use server';
    await cere('planificare', 'modifica');
    const e = await scoate(id, String(date.get('planificare')));
    if (!e && ultima) redirect('/planificare');
    inapoi(id, e);
  }
  async function trimite() {
    'use server';
    await cere('planificare', 'modifica');
    const e = await trimiteLaCroit(id);
    if (e) inapoi(id, e);
    redirect('/planificare');
  }

  return (
    <main className="formular">
      <p className="slab"><Link href="/planificare">← Planificare</Link></p>
      <h1>{t.cod} · {t.model}</h1>
      <p className="sumar">
        {t.planificari.length} {t.planificari.length === 1 ? 'comandă' : 'comenzi'} · {t.bucati} buc · termen {t.termen} ·{' '}
        <strong>{t.trimis_la ? `trimisă la croit ${t.trimis_la}` : 'în planificare'}</strong>
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      <h2>Comenzi în taiere</h2>
      <table>
        <thead><tr><th>Planificare</th><th>Termen</th><th>Produs</th><th>Stadiu</th><th className="nr">Planif.</th><th className="nr">Croit</th><th /></tr></thead>
        <tbody>
          {t.planificari.map((p) => (
            <tr key={p.id}>
              <td><Link href={`/planificare/${p.id}`}>{p.cod}</Link> <span className="slab">{p.tip} · P{p.prioritate}</span></td>
              <td className="slab">{p.data_ceruta}</td>
              <td>{p.produs}</td>
              <td>{STADII[p.stadiu] ?? p.stadiu}</td>
              <td className="nr">{p.planificat}</td>
              <td className="nr">{p.croit || '—'}</td>
              <td>
                {deschisa && (
                  <form action={scoateComanda}><fieldset disabled={!m} className="fara-chenar">
                    <input type="hidden" name="planificare" value={p.id} />
                    <button className="secundar">Scoate</button>
                  </fieldset></form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {t.materiale.length > 0 && (
        <>
          <h2>Necesar de materii prime și accesorii</h2>
          <table>
            <thead><tr><th>Material</th><th className="nr">Necesar</th><th className="nr">Stoc</th><th /></tr></thead>
            <tbody>
              {t.materiale.map((x) => (
                <tr key={x.material_id}>
                  <td><Link href={`/stoc/${x.material_id}`}>{x.denumire}</Link>{x.principal && <span className="slab"> · principal</span>}</td>
                  <td className="nr">{cantitate(x.necesar)} <span className="slab">{x.unitate}</span></td>
                  <td className="nr">{cantitate(x.stoc)}</td>
                  <td>{x.acoperit ? <span className="slab">acoperit</span>
                    : x.principal ? <span className="lipsa">lipsă — oprește trimiterea</span>
                    : <span className="slab">lipsă</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {deschisa && deAdaugat.length > 0 && (
        <form action={adauga}><fieldset disabled={!m} className="fara-chenar">
          <h2>Se mai pot tăia împreună</h2>
          <table>
            <tbody>
              {deAdaugat.map((l) => (
                <tr key={l.linie_id}>
                  <td><input type="checkbox" name="linie" value={l.linie_id} aria-label={l.comanda} /></td>
                  <td>{l.comanda} <span className="slab">{l.tip} · P{l.prioritate}</span></td>
                  <td className="slab">{l.data_ceruta}</td>
                  <td>{l.produs}</td>
                  <td className="nr">{l.rest} buc</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actiuni"><button className="secundar">Adaugă în {t.cod}</button></div>
        </fieldset></form>
      )}

      {deschisa && (
        <form action={trimite}><fieldset disabled={!m || t.stofa_lipsa} className="fara-chenar">
          <div className="actiuni"><button className="principal">Trimite la croit ({t.bucati} buc)</button></div>
        </fieldset></form>
      )}
    </main>
  );
}
