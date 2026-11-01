import Link from 'next/link';
import { magazine } from '../../lib/magazine';
import { alerte, praguri, produseMagazine } from '../../lib/produse';
import { cere } from '../../lib/sesiune';
import '../magazine.css';

export const dynamic = 'force-dynamic';

/**
 * Alertele magazinelor, pe toate sau pe unul: ce se termină (o mărime care mai
 * ține sub pragul de zile), ce nu se mișcă (stoc fără vânzări) și ce prinde avânt
 * (ultima săptămână mult peste media de dinainte). Aceleași alerte pleacă dimineața
 * și pe Slack.
 */
export default async function Alerte({ searchParams }: { searchParams: Promise<{ magazin?: string }> }) {
  await cere('expediere');
  const f = await searchParams;
  const [lista, p] = await Promise.all([magazine(), praguri()]);
  const ales = lista.find((m) => m.id === f.magazin) ?? null;
  const a = alerte(await produseMagazine(ales?.id));
  const cu = (m: string) => (ales ? '' : ` · ${m}`);

  return (
    <main className="lat">
      <h1>Alerte magazine</h1>
      <nav className="file">
        <Link href="/magazine/alerte" className={!ales ? 'activ' : ''}>Toate</Link>
        {lista.map((m) => <Link key={m.id} href={`/magazine/alerte?magazin=${m.id}`} className={m.id === ales?.id ? 'activ' : ''}>{m.brand}</Link>)}
      </nav>
      <p className="sumar">
        {a.se_termina.length} mărimi se termină · {a.stoc_mort.length} produse nu se mișcă · {a.trend.length} în trend
      </p>

      <h2>Se termină <span className="slab">— mai ține sub {p.alerta_zile_stoc} zile la ritmul ultimelor 30 de zile</span></h2>
      {a.se_termina.length === 0 ? <p className="slab">Nimic.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Produs</th><th>Mărime</th><th className="nr">Stoc</th><th className="nr">Vândut 7 zile</th><th className="nr">30 zile</th><th>Ține</th></tr></thead>
            <tbody>
              {a.se_termina.map(({ p: x, m }) => (
                <tr key={`${x.magazin_id}${x.produs}${m.marime}`}>
                  <td><strong>{x.produs}</strong><span className="slab">{cu(x.magazin)}</span></td>
                  <td>{m.marime}</td>
                  <td className="nr">{m.stoc}</td>
                  <td className="nr">{m.v7}</td>
                  <td className="nr">{m.v30}</td>
                  <td>{m.stoc === 0 ? <span className="insigna rosu">terminat, încă se cere</span>
                    : <span className={`insigna ${m.zile! < 7 ? 'rosu' : 'galben'}`}>{m.zile} zile</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>În trend <span className="slab">— ultimele 7 zile de cel puțin {p.trend_factor}× media săptămânală de dinainte, minim {p.trend_min_buc} buc</span></h2>
      {a.trend.length === 0 ? <p className="slab">Nimic.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Produs</th><th className="nr">Vândut 7 zile</th><th className="nr">30 zile</th><th>Creștere</th><th className="nr">Stoc</th><th>Ține</th></tr></thead>
            <tbody>
              {a.trend.map((x) => (
                <tr key={`${x.magazin_id}${x.produs}`}>
                  <td><strong>{x.produs}</strong><span className="slab">{cu(x.magazin)}</span></td>
                  <td className="nr"><strong>{x.v7}</strong></td>
                  <td className="nr">{x.v30}</td>
                  <td><span className="insigna violet">{x.semnale.trend ? `×${x.semnale.trend}` : 'nou'}</span></td>
                  <td className="nr">{x.stoc}</td>
                  <td>{x.zile === null ? '—' : <span className={`insigna ${x.zile < 7 ? 'rosu' : x.zile < p.alerta_zile_stoc ? 'galben' : 'verde'}`}>{x.zile} zile</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Nu se mișcă <span className="slab">— cel puțin {p.stoc_mort_min_buc} buc pe stoc și nicio vânzare în {p.stoc_mort_zile} de zile</span></h2>
      {a.stoc_mort.length === 0 ? <p className="slab">Nimic.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead><tr><th>Produs</th><th className="nr">Stoc</th><th>Ultima vânzare</th><th>Mărimi · stoc</th></tr></thead>
            <tbody>
              {a.stoc_mort.map((x) => (
                <tr key={`${x.magazin_id}${x.produs}`}>
                  <td><strong>{x.produs}</strong><span className="slab">{cu(x.magazin)}</span></td>
                  <td className="nr"><strong>{x.stoc}</strong></td>
                  <td className="slab">{x.ultima ? `${x.ultima.slice(8)}.${x.ultima.slice(5, 7)}` : 'în ultimele 60 de zile, niciuna'}</td>
                  <td className="marimi-stoc">{x.marimi.filter((m) => m.stoc > 0).map((m) => <span key={m.marime}>{m.marime} <strong>{m.stoc}</strong></span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
