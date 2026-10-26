import Link from 'next/link';
import NavPerioada from '../../kam/NavPerioada';
import { eficientaAsiguraStoc, type LinieLivrare, type Rezumat } from '../../lib/asiguraStoc';
import { adresaPerioadei, perioadaDinAdresa } from '../../lib/kam';
import { cere } from '../../lib/sesiune';

export const dynamic = 'force-dynamic';

const pr = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const zile = (z: number | null) => (z === null ? '—' : `${z.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} zile`);

/**
 * Eficiența Asigură stoc pe săptămână, lună, trimestru sau an: liniile cu data
 * cerută de KAM în perioadă — câte au intrat la timp, mai devreme, cu întârziere
 * (și cu câte zile), câte sunt restante, câte bucăți au venit la termen și câte nu
 * mai vin, cu motivele lor. Sus perioada aleasă, apoi direcția pe ultimele 8.
 */
export default async function EficientaAsiguraStoc({ searchParams }: { searchParams: Promise<{ perioada?: string; de_la?: string }> }) {
  await cere(['centralizator', 'kam']);
  const per = perioadaDinAdresa(await searchParams);
  const { linii, rezumat: r, istoric } = await eficientaAsiguraStoc(per);
  const deVazut = linii.filter((l) => l.restanta_zile !== null || (l.zile ?? 0) > 0)
    .sort((a, b) => (b.restanta_zile ?? b.zile ?? 0) - (a.restanta_zile ?? a.zile ?? 0));
  const restul = linii.filter((l) => !deVazut.includes(l));

  return (
    <main className="lat">
      <h1>Eficiența Asigură stoc</h1>
      <NavPerioada per={per} baza="/eficienta/asigura-stoc" />
      <p className="sumar">
        Liniile PSF și PSC cu data cerută în perioadă. Livrată = a intrat tot în depozit sau s-a închis; pentru
        liniile fără recepții încă, contează predarea de pe bandă la depozit.
      </p>

      <div className="tabel-derulant">
        <table className="centralizator">
          <thead>
            <tr><th>Linii</th><th className="nr">Livrate</th><th className="nr">La timp</th><th className="nr">Mai devreme</th>
                <th className="nr">Întârziate</th><th className="nr">Restante</th><th className="nr">Bucăți la termen</th>
                <th className="nr">Nu mai vin</th></tr>
          </thead>
          <tbody>
            <Rand r={r} eticheta={<strong>{per.nume}</strong>} />
          </tbody>
        </table>
      </div>

      <h2>Ultimele 8 perioade</h2>
      <div className="tabel-derulant">
        <table className="centralizator">
          <thead>
            <tr><th>Perioada</th><th className="nr">Livrate</th><th className="nr">La timp</th><th className="nr">Mai devreme</th>
                <th className="nr">Întârziate</th><th className="nr">Restante</th><th className="nr">Bucăți la termen</th>
                <th className="nr">Nu mai vin</th></tr>
          </thead>
          <tbody>
            {istoric.map((x) => (
              <Rand key={x.perioada.de_la} r={x}
                    eticheta={<Link href={`/eficienta/asigura-stoc?${adresaPerioadei(x.perioada)}`}>{x.perioada.nume}</Link>} />
            ))}
          </tbody>
        </table>
      </div>

      <h2>Întârziate și restante</h2>
      {deVazut.length === 0 ? <p className="slab">Nimic întârziat în perioada asta.</p> : <Linii lista={deVazut} />}
      {restul.length > 0 && (
        <details>
          <summary>Celelalte {restul.length} linii</summary>
          <Linii lista={restul} />
        </details>
      )}
    </main>
  );
}

function Rand({ r, eticheta }: { r: Rezumat; eticheta: React.ReactNode }) {
  return (
    <tr>
      <td>{eticheta} <span className="slab">{r.linii} linii</span></td>
      <td className="nr">{r.livrate}</td>
      <td className="nr"><strong>{pr(r.la_timp, r.livrate)}</strong> <span className="slab">{r.la_timp}</span></td>
      <td className="nr">{r.devreme} <span className="slab">{r.devreme ? `· ${zile(r.devreme_zile)} înainte` : ''}</span></td>
      <td className={`nr ${r.intarziate ? 'lipsa' : ''}`}>{r.intarziate} <span className="slab">{r.intarziate ? `· ${zile(r.intarziere_zile)}` : ''}</span></td>
      <td className={`nr ${r.restante ? 'lipsa' : ''}`}>{r.restante}</td>
      <td className="nr"><strong>{pr(r.la_termen, r.cerut)}</strong> <span className="slab">{r.la_termen}/{r.cerut}</span></td>
      <td className="nr">{r.lipsa_inchisa || '—'}</td>
    </tr>
  );
}

function Linii({ lista }: { lista: LinieLivrare[] }) {
  return (
    <div className="tabel-derulant">
      <table className="centralizator">
        <thead>
          <tr><th>Comandă</th><th>Produs</th><th>Cerută la</th><th>Livrată la</th><th className="nr">Față de termen</th>
              <th className="nr">Cerut</th><th className="nr">Intrat</th><th className="nr">La termen</th><th>Nu mai vin</th></tr>
        </thead>
        <tbody>
          {lista.map((l) => (
            <tr key={l.linie_id}>
              <td><Link href={`/depozit/${encodeURIComponent(l.comanda)}`}>{l.comanda}</Link> <span className="slab">{l.tip}</span></td>
              <td>{l.produs}</td>
              <td className="slab">{l.data_ceruta}</td>
              <td className="slab">{l.livrata_la ?? '—'}{l.din_banda && ' · din bandă'}</td>
              <td className={`nr ${(l.restanta_zile ?? l.zile ?? 0) > 0 ? 'lipsa' : ''}`}>
                {l.restanta_zile !== null ? `restantă de ${l.restanta_zile} zile`
                  : l.zile === null ? '—' : l.zile === 0 ? 'în ziua cerută' : l.zile < 0 ? `${-l.zile} zile mai devreme` : `${l.zile} zile întârziere`}
              </td>
              <td className="nr">{l.cerut}</td>
              <td className="nr">{l.intrat || '—'}</td>
              <td className="nr">{l.la_termen || '—'}</td>
              <td className="slab">{l.lipsa_inchisa ? `${l.lipsa_inchisa} buc${l.motive ? ` — ${l.motive}` : ''}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
