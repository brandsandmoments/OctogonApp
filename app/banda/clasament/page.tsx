import Link from 'next/link';
import { clasamentCroit, clasamentProductie, comenziFaraOameni } from '../../lib/clasament';
import { OPERATII } from '../../lib/croitTaiere';
import { azi } from '../../lib/format';
import { adaugaZile, luni } from '../../lib/perioade';
import { cere } from '../../lib/sesiune';
import './clasament.css';

export const dynamic = 'force-dynamic';

const eData = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
const zi = (d: string) => d.split('-').reverse().join('.');
const nr = (x: number) => x.toLocaleString('ro-RO', { maximumFractionDigits: 1 });
const MEDALII = ['🥇', '🥈', '🥉'];
// Întâi tăiatul (cine a tăiat și cât), apoi celelalte operații de la croit.
const ORDINE_CROIT = ['taiat', 'intins', 'separat', 'termocolat'];

/**
 * Clasamentul oamenilor din producție pe o perioadă aleasă, după bucăți: la croit pe fiecare
 * operație (bucățile taierii, împărțite egal între cei care au făcut operația), în producție pe
 * fiecare fază și pe total (bucățile ieșite din lucru, împărțite între cei trecuți la „Cine
 * lucrează"). Jos, comenzile ieșite din lucru fără niciun om trecut — ca managerii să le completeze.
 */
export default async function Clasament({ searchParams }: { searchParams: Promise<{ de?: string; pana?: string }> }) {
  await cere(['banda', 'planificare', 'croit']);
  const f = await searchParams;
  const astazi = azi();
  const lunaAsta = astazi.slice(0, 8) + '01';
  const lunaTrecuta = adaugaZile(lunaAsta, -1).slice(0, 8) + '01';
  const PERIOADE: [string, string, string][] = [
    ['Săptămâna asta', luni(astazi), astazi],
    ['Săptămâna trecută', adaugaZile(luni(astazi), -7), adaugaZile(luni(astazi), -1)],
    ['Luna asta', lunaAsta, astazi],
    ['Luna trecută', lunaTrecuta, adaugaZile(lunaAsta, -1)],
  ];
  let de = eData(f.de) ? f.de! : lunaAsta;
  let pana = eData(f.pana) ? f.pana! : astazi;
  if (pana < de) [de, pana] = [pana, de];
  const [croit, productie, fara] = await Promise.all([clasamentCroit(de, pana), clasamentProductie(de, pana), comenziFaraOameni(de, pana)]);

  const operatii = [...new Set(croit.map((r) => r.operatie))].sort((a, b) =>
    (ORDINE_CROIT.indexOf(a) + 1 || 99) - (ORDINE_CROIT.indexOf(b) + 1 || 99));
  const faze = [...new Set(productie.map((r) => r.faza))].sort((a, b) => a.localeCompare(b, 'ro'));
  // Producție pe total: toate fazele unui om adunate.
  const total = new Map<string, { om: string; bucati: number; comenzi: number; faze: Set<string> }>();
  for (const r of productie) {
    const t = total.get(r.om) ?? { om: r.om, bucati: 0, comenzi: 0, faze: new Set() };
    t.bucati += r.bucati; t.comenzi = Math.max(t.comenzi, r.comenzi); t.faze.add(r.faza);
    total.set(r.om, t);
  }
  const peTotal = [...total.values()].sort((a, b) => b.bucati - a.bucati);

  return (
    <main className="lat clasament">
      <h1>Clasament</h1>
      <p className="slab">Cine ce a făcut, în bucăți, pe perioada aleasă. Bucățile unei taieri (sau ale unei comenzi ieșite din lucru) se împart egal între oamenii care au lucrat la aceeași operație sau fază.</p>
      <div className="filtre">
        {PERIOADE.map(([nume, a, b]) => (
          <Link key={nume} href={`/banda/clasament?de=${a}&pana=${b}`} className={`buton ${a === de && b === pana ? 'activ-buton' : ''}`}>{nume}</Link>
        ))}
      </div>
      <form method="get" className="filtre">
        <span className="slab">De la</span><input type="date" name="de" defaultValue={de} aria-label="De la" />
        <span className="slab">până la</span><input type="date" name="pana" defaultValue={pana} aria-label="Până la" />
        <button className="buton">Arată</button>
      </form>
      <p className="sumar">{zi(de)} – {zi(pana)}</p>

      <h2>Croit</h2>
      {operatii.length === 0 ? <p className="slab">Nicio operație de croit trecută în perioada asta.</p> : (
        <div className="clasamente">
          {operatii.map((op) => (
            <Tabel key={op} titlu={OPERATII[op as keyof typeof OPERATII] ?? op} coloana="Taieri"
              randuri={croit.filter((r) => r.operatie === op).map((r) => ({ om: r.om, bucati: r.bucati, cate: r.taieri }))} />
          ))}
        </div>
      )}

      <h2>Producție</h2>
      {peTotal.length === 0 ? <p className="slab">Nimeni trecut la „Cine lucrează" pe comenzile ieșite din lucru în perioada asta.</p> : (
        <div className="clasamente">
          <Tabel titlu="Total, toate fazele" coloana="Faze"
            randuri={peTotal.map((t) => ({ om: t.om, bucati: t.bucati, cate: t.faze.size, nota: [...t.faze].join(', ') }))} />
          {faze.map((fz) => (
            <Tabel key={fz} titlu={fz} coloana="Comenzi"
              randuri={productie.filter((r) => r.faza === fz).map((r) => ({ om: r.om, bucati: r.bucati, cate: r.comenzi }))} />
          ))}
        </div>
      )}

      {fara.length > 0 && (
        <section className="fara-oameni">
          <h3>Ieșite din lucru fără oameni trecuți ({fara.length})</h3>
          <p className="slab">Bucățile lor nu intră în clasament. Trece cine a lucrat la „Cine lucrează", în Producție → Plan pe săptămâni (comanda deschisă).</p>
          <ul>
            {fara.map((c) => (
              <li key={c.numar}><Link href={`/productie?cauta=${encodeURIComponent(c.numar)}&deschis=${encodeURIComponent(c.numar)}`}>{c.numar}</Link> <span className="slab">{c.produs} · {c.bucati} buc</span></li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** Un clasament: locul (medalii pentru primii trei), omul, bucățile și din câte taieri/comenzi/faze. */
function Tabel({ titlu, coloana, randuri }: { titlu: string; coloana: string; randuri: { om: string; bucati: number; cate: number; nota?: string }[] }) {
  const sus = randuri[0]?.bucati || 1;
  return (
    <section className="tabel-clasament">
      <h3>{titlu}</h3>
      <table>
        <thead><tr><th className="loc">#</th><th>Om</th><th className="nr">Bucăți</th><th className="nr">{coloana}</th></tr></thead>
        <tbody>
          {randuri.map((r, i) => (
            <tr key={r.om} className={i < 3 ? 'podium' : ''}>
              <td className="loc">{MEDALII[i] ?? i + 1}</td>
              <td>
                {r.om}{r.nota && <div className="slab">{r.nota}</div>}
                <div className="bara" aria-hidden="true"><span style={{ width: `${Math.round((r.bucati / sus) * 100)}%` }} /></div>
              </td>
              <td className="nr"><strong>{nr(r.bucati)}</strong></td>
              <td className="nr">{r.cate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
