import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adaugaAngajat, FUNCTII, personal, schimbaAngajat, type Functie } from '../../lib/alocare';
import { cere, poateModifica } from '../../lib/sesiune';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

const inapoi = (eroare?: string | null): never => redirect(eroare ? `/banda/oameni?eroare=${encodeURIComponent(eroare)}` : '/banda/oameni');

/**
 * Oamenii din producție, pe funcții: din ei se aleg cei care lucrează la fazele unei
 * tranșe. Cine a plecat se scoate (nu se șterge: alocările vechi îi păstrează numele).
 */
export default async function OameniProductie({ searchParams }: { searchParams: Promise<{ eroare?: string; toti?: string }> }) {
  await cere('banda');
  const f = await searchParams;
  const m = await poateModifica('banda');
  const lista = await personal(!f.toti);

  async function adauga(d: FormData) {
    'use server';
    await cere('banda', 'modifica');
    inapoi(await adaugaAngajat(String(d.get('nume') ?? ''), d.getAll('functie').map(String)));
  }
  async function schimba(d: FormData) {
    'use server';
    await cere('banda', 'modifica');
    const id = String(d.get('id'));
    if (d.get('ce') === 'activ') await schimbaAngajat(id, { activ: d.get('activ') === '1' });
    else await schimbaAngajat(id, { functii: d.getAll('functie').map(String) });
    inapoi();
  }

  const peFunctie = (Object.keys(FUNCTII) as Functie[]).map((k) => ({ k, oameni: lista.filter((o) => o.functii.includes(k)) }));
  const faraFunctie = lista.filter((o) => o.functii.length === 0);

  return (
    <main className="formular">
      <p className="slab"><Link href="/banda">← Bandă</Link></p>
      <h1>Oameni producție</h1>
      <p className="sumar">{lista.length} oameni · din ei se aleg cei care lucrează la fazele unei tranșe de pe bandă ·{' '}
        {f.toti ? <Link href="/banda/oameni">doar cei activi</Link> : <Link href="/banda/oameni?toti=1">arată și pe cei scoși</Link>}</p>
      {f.eroare && <p className="eroare">{f.eroare}</p>}

      {m && (
        <form action={adauga} className="antet-comanda alocare">
          <label className="lat-2"><span>Nume</span><input name="nume" placeholder="Prenume Nume" required /></label>
          <fieldset className="lat comutator"><legend>Funcții</legend>
            {(Object.entries(FUNCTII) as [Functie, string][]).map(([k, n]) => (
              <label key={k}><input type="checkbox" name="functie" value={k} defaultChecked={k === 'operator'} /> {n}</label>
            ))}
          </fieldset>
          <div className="lat"><button>Adaugă omul</button></div>
        </form>
      )}

      {[...peFunctie, ...(faraFunctie.length ? [{ k: null, oameni: faraFunctie }] : [])].filter((g) => g.oameni.length).map((g) => (
        <section key={g.k ?? 'fara'}>
          <h2>{g.k ? FUNCTII[g.k] : 'Fără funcție'} · {g.oameni.length}</h2>
          <table className="oameni-productie">
            <thead><tr><th>Nume</th><th>Funcții</th><th>Acum</th><th /></tr></thead>
            <tbody>
              {g.oameni.map((o) => (
                <tr key={o.id} className={o.activ ? '' : 'scos'}>
                  <td><strong>{o.nume}</strong>{!o.activ && <span className="slab"> · scos</span>}</td>
                  <td>
                    {m ? (
                      <form action={schimba} className="functii-om">
                        <input type="hidden" name="id" value={o.id} /><input type="hidden" name="ce" value="functii" />
                        <details>
                          <summary>{o.functii.map((x) => FUNCTII[x]).join(', ') || 'fără funcție'}</summary>
                          <div className="functii-alege">
                            {(Object.entries(FUNCTII) as [Functie, string][]).map(([k, n]) => (
                              <label key={k}><input type="checkbox" name="functie" value={k} defaultChecked={o.functii.includes(k)} /> {n}</label>
                            ))}
                            <button className="mic-buton">Salvează</button>
                          </div>
                        </details>
                      </form>
                    ) : o.functii.map((x) => FUNCTII[x]).join(', ')}
                  </td>
                  <td className="slab">{o.ocupat ?? (o.activ ? 'liber' : '—')}</td>
                  <td>{m && (
                    <form action={schimba}>
                      <input type="hidden" name="id" value={o.id} /><input type="hidden" name="ce" value="activ" />
                      <input type="hidden" name="activ" value={o.activ ? '0' : '1'} />
                      <button className="mic-buton">{o.activ ? 'Scoate' : 'Readu'}</button>
                    </form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
