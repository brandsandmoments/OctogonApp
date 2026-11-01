import Link from 'next/link';
import Tipareste from '../../Tipareste';
import { magazine } from '../../lib/magazine';
import { alerte, praguri, produseMagazine } from '../../lib/produse';
import { cere } from '../../lib/sesiune';
import '../magazine.css';
import '../foaie.css';

export const dynamic = 'force-dynamic';

const zi = (d: string | null) => (d ? `${d.slice(8)}.${d.slice(5, 7)}` : '—');
const peSapt = (v30: number) => Math.round((v30 / 30) * 7 * 10) / 10;

/**
 * Alertele magazinelor, pe toate sau pe unul, ca o foaie care se tipărește pe A4:
 *
 * 1. clienți care așteaptă — comenzile deschise cer mai mult decât e pe stoc;
 * 2. terminate, se vindeau — stoc zero, nimeni nu așteaptă; dacă varianta nu se poate
 *    comanda la stoc zero, vânzarea se pierde fără să se vadă;
 * 3. se termină curând — încă pe stoc, dar ține sub pragul de zile;
 * 4. în trend și 5. nu se mișcă.
 *
 * Aceleași alerte pleacă dimineața și pe Slack.
 */
export default async function Alerte({ searchParams }: { searchParams: Promise<{ magazin?: string }> }) {
  await cere('expediere');
  const f = await searchParams;
  const [lista, p] = await Promise.all([magazine(), praguri()]);
  const ales = lista.find((m) => m.id === f.magazin) ?? null;
  const a = alerte(await produseMagazine(ales?.id));
  const toate = !ales;
  const generat = new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fara = (n: number) => n === 0 && <p className="foaie-gol">Nimic aici acum.</p>;
  const Mag = ({ m }: { m: string }) => (toate ? <td className="mic">{m}</td> : null);
  const thMag = toate ? <th>Magazin</th> : null;

  return (
    <main className="lat">
      <h1 className="nu-tipari">Alerte magazine</h1>
      <nav className="file">
        <Link href="/magazine/alerte" className={toate ? 'activ' : ''}>Toate</Link>
        {lista.map((m) => <Link key={m.id} href={`/magazine/alerte?magazin=${m.id}`} className={m.id === ales?.id ? 'activ' : ''}>{m.brand}</Link>)}
      </nav>
      <div className="liste-actiuni nu-tipari">
        <span className="slab">raportul se tipărește pe A4, ca foile de picking</span>
        <Tipareste />
      </div>

      <article className="foaie">
        <header className="foaie-antet">
          <h1>Alerte stoc · {toate ? 'toate magazinele' : ales.brand}</h1>
          <p className="foaie-sub">clienți care așteaptă · terminate · se termină curând · trend · nu se mișcă</p>
          <p className="foaie-mic">vânzări din ultimele 60 de zile · stoc fizic Shopify · Generat {generat}</p>
          <p className="foaie-rezumat">
            {a.asteapta.length} mărimi cu clienți care așteaptă ({a.asteapta.reduce((s, x) => s + x.m.lipsa, 0)} buc lipsă) ·{' '}
            {a.terminat.length} terminate · {a.curand.length} se termină curând · {a.trend.length} în trend · {a.stoc_mort.length} nu se mișcă
          </p>
        </header>

        <section className="foaie-grupa">
          <h2>1. Clienți care așteaptă</h2>
          <p className="foaie-mic">Comenzile deschise cer mai mult decât e pe stoc. Cerere sigură: de produs sau de cumpărat.</p>
          {fara(a.asteapta.length) || (
            <table>
              <thead><tr>{thMag}<th>Produs</th><th className="c">Măr.</th><th className="c">Stoc</th><th className="c">Comenzi</th><th className="c">Cerut</th><th className="c">Lipsă</th><th className="c">Vândut 30 z</th></tr></thead>
              <tbody>
                {a.asteapta.map(({ p: x, m }) => (
                  <tr key={`${x.magazin_id}${x.produs}${m.marime}`}>
                    <Mag m={x.magazin} />
                    <td>{x.produs}{!x.activ && <span className="mic"> · scos din magazin</span>}</td>
                    <td className="c">{m.marime}</td>
                    <td className="c">{m.stoc}</td>
                    <td className="c">{m.comenzi}</td>
                    <td className="c">{m.asteapta}</td>
                    <td className="c rosu-tare">{m.lipsa}</td>
                    <td className="c">{m.v30}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="foaie-grupa">
          <h2>2. Terminate, se vindeau</h2>
          <p className="foaie-mic">
            Stoc zero, nimeni nu așteaptă, dar s-au vândut în ultimele 30 de zile. Unde nu se mai poate comanda, vânzarea se
            pierde fără să se vadă — estimat din ritmul de dinainte. Decizia: restoc sau nu.
          </p>
          {fara(a.terminat.length) || (
            <table>
              <thead><tr>{thMag}<th>Produs</th><th className="c">Măr.</th><th className="c">Vândut 30 z</th><th className="c">Ultima vânzare</th><th>În magazin</th></tr></thead>
              <tbody>
                {a.terminat.map(({ p: x, m }) => (
                  <tr key={`${x.magazin_id}${x.produs}${m.marime}`}>
                    <Mag m={x.magazin} />
                    <td>{x.produs}</td>
                    <td className="c">{m.marime}</td>
                    <td className="c">{m.v30}</td>
                    <td className="c mic">{zi(m.ultima)}</td>
                    <td>{m.se_poate_comanda
                      ? <span className="mic">se poate comanda — comenzile noi vor apărea la „așteaptă"</span>
                      : <span className="rosu-tare">nu se mai poate comanda · ~{peSapt(m.v30)} buc/săpt pierdute</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="foaie-grupa">
          <h2>3. Se termină curând</h2>
          <p className="foaie-mic">Încă pe stoc, dar la ritmul ultimelor 30 de zile ține sub {p.alerta_zile_stoc} zile.</p>
          {fara(a.curand.length) || (
            <table>
              <thead><tr>{thMag}<th>Produs</th><th className="c">Măr.</th><th className="c">Stoc</th><th className="c">Vândut 7 z</th><th className="c">30 z</th><th className="c">Ține</th></tr></thead>
              <tbody>
                {a.curand.map(({ p: x, m }) => (
                  <tr key={`${x.magazin_id}${x.produs}${m.marime}`}>
                    <Mag m={x.magazin} />
                    <td>{x.produs}</td>
                    <td className="c">{m.marime}</td>
                    <td className="c stoc">{m.stoc}</td>
                    <td className="c">{m.v7}</td>
                    <td className="c">{m.v30}</td>
                    <td className={`c ${m.zile! < 7 ? 'rosu-tare' : ''}`}>{m.zile} zile</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="foaie-grupa">
          <h2>4. În trend</h2>
          <p className="foaie-mic">Ultimele 7 zile de cel puțin {p.trend_factor}× media săptămânală de dinainte, minim {p.trend_min_buc} buc.</p>
          {fara(a.trend.length) || (
            <table>
              <thead><tr>{thMag}<th>Produs</th><th className="c">Vândut 7 z</th><th className="c">30 z</th><th className="c">Creștere</th><th className="c">Stoc</th><th className="c">Ține</th></tr></thead>
              <tbody>
                {a.trend.map((x) => (
                  <tr key={`${x.magazin_id}${x.produs}`}>
                    <Mag m={x.magazin} />
                    <td>{x.produs}</td>
                    <td className="c"><strong>{x.v7}</strong></td>
                    <td className="c">{x.v30}</td>
                    <td className="c">{x.semnale.trend ? `×${x.semnale.trend}` : 'nou'}</td>
                    <td className="c stoc">{x.stoc}</td>
                    <td className="c">{x.zile === null ? '—' : `${x.zile} zile`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="foaie-grupa">
          <h2>5. Nu se mișcă</h2>
          <p className="foaie-mic">Cel puțin {p.stoc_mort_min_buc} buc pe stoc și nicio vânzare în {p.stoc_mort_zile} de zile.</p>
          {fara(a.stoc_mort.length) || (
            <table>
              <thead><tr>{thMag}<th>Produs</th><th className="c">Stoc</th><th className="c">Ultima vânzare</th><th>Mărimi · stoc</th></tr></thead>
              <tbody>
                {a.stoc_mort.map((x) => (
                  <tr key={`${x.magazin_id}${x.produs}`}>
                    <Mag m={x.magazin} />
                    <td>{x.produs}</td>
                    <td className="c"><strong>{x.stoc}</strong></td>
                    <td className="c mic">{x.ultima ? zi(x.ultima) : 'niciuna în 60 z'}</td>
                    <td className="mic">{x.marimi.filter((m) => m.stoc > 0).map((m) => `${m.marime} ${m.stoc}`).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </article>
    </main>
  );
}
