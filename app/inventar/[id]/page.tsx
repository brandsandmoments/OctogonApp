import Link from 'next/link';
import { cere, poateModifica } from '../../lib/sesiune';
import { notFound, redirect } from 'next/navigation';
import { cantitate } from '../../lib/format';
import { detaliiInventar, familii, inchideInventar, salveazaNumaratori } from '../../lib/stoc';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

function inapoi(id: string, familie: string, eroare: string | null): never {
  const q = new URLSearchParams();
  if (familie) q.set('familie', familie);
  if (eroare) q.set('eroare', eroare);
  redirect(`/inventar/${id}${q.size ? `?${q}` : ''}`);
}

/**
 * Lista de numărare. Se completează doar ce s-a numărat; un câmp gol rămâne
 * nenumărat și nu atinge stocul. La închidere, diferențele devin ajustări.
 */
export default async function InventarPagina({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ familie?: string; eroare?: string }>;
}) {
  await cere('materiale');
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('materiale');
  const [{ id }, { familie = '', eroare }] = await Promise.all([params, searchParams]);
  const [d, fam] = await Promise.all([detaliiInventar(id, familie), familii()]);
  if (!d) notFound();
  const { inventar, linii } = d;
  const numarate = linii.filter((l) => l.numarat !== null);

  async function salveaza(date: FormData) {
    'use server';
    await cere('materiale', 'modifica');
    const numaratori = new Map(
      [...date.entries()].filter(([k]) => k.startsWith('n:')).map(([k, v]) => [k.slice(2), String(v)]),
    );
    const eroareSalvare = await salveazaNumaratori(id, numaratori);
    if (eroareSalvare || !date.get('inchide')) inapoi(id, familie, eroareSalvare);
    inapoi(id, familie, await inchideInventar(id));
  }

  return (
    <main className="formular">
      <p className="slab"><Link href="/inventar">← Inventar</Link></p>
      <h1>Inventar {inventar.data}</h1>
      <p className="sumar">
        {inventar.descriere && `${inventar.descriere} · `}
        {inventar.inchis ? 'închis — diferențele au intrat în fișa de magazie' : 'deschis'}
        {' · '}{numarate.length} materiale numărate
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      {!inventar.inchis && (
        <form className="filtre">
          <select name="familie" defaultValue={familie} aria-label="Familie">
            <option value="">Toate familiile</option>
            {fam.map((x) => <option key={x}>{x}</option>)}
          </select>
          <button>Arată</button>
        </form>
      )}

      <form action={salveaza}><fieldset disabled={!m} className="fara-chenar">
        <div className="tabel-derulant">
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th className="nr">Scriptic</th>
                <th className="nr">Numărat</th>
                <th className="nr">Diferență</th>
              </tr>
            </thead>
            <tbody>
              {linii.map((l) => {
                const scriptic = inventar.inchis ? l.scriptic_la_inchidere ?? l.scriptic : l.scriptic;
                const dif = l.numarat !== null ? Number(l.numarat) - Number(scriptic) : null;
                return (
                  <tr key={l.material_id}>
                    <td>
                      {l.denumire}
                      <br />
                      <span className="slab">{l.cod}{l.familie && ` · ${l.familie}`}</span>
                    </td>
                    <td className="nr">{cantitate(scriptic)} <span className="slab">{l.unitate}</span></td>
                    <td className="nr">
                      {inventar.inchis ? cantitate(l.numarat ?? 0) : (
                        <input
                          name={`n:${l.material_id}`}
                          defaultValue={l.numarat !== null ? Number(l.numarat) : ''}
                          inputMode="decimal"
                          className="numar-scurt"
                          aria-label={`Numărat ${l.denumire}`}
                        />
                      )}
                    </td>
                    <td className={`nr ${dif && dif < 0 ? 'lipsa' : ''}`}>
                      {dif === null ? '' : dif === 0 ? '—' : `${dif > 0 ? '+' : ''}${cantitate(dif)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!inventar.inchis && (
          <div className="actiuni">
            <button className="principal">Salvează numărătorile</button>
            <button name="inchide" value="1" className="secundar">
              Salvează și închide inventarul
            </button>
          </div>
        )}
      </fieldset></form>
    </main>
  );
}
