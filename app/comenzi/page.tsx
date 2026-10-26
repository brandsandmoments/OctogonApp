import { interogare, cere } from '../lib/sesiune';

export const dynamic = 'force-dynamic';

type Pozitie = {
  comanda: string;
  tip: string;
  produs: string;
  cod_sku: string;
  marime: string;
  marime_numerica: string | null;
  cerut: number;
  intrat: number;
  cod_eticheta: string | null;
  motiv: string | null;
};

/**
 * Progresul pe fiecare poziție de comandă — adică exact ce se vede după ce se
 * scanează o etichetă. „Cerut 7, intrat 4, lipsesc 3" se calculează din recepții,
 * nu se ține într-o coloană care poate rămâne în urmă.
 */
async function pozitii(): Promise<Pozitie[]> {
  return interogare<Pozitie>(`
    SELECT c.numar                      AS comanda,
           c.tip::text                  AS tip,
           p.denumire                   AS produs,
           p.cod_sku,
           m.cod                        AS marime,
           m.cod_numeric                AS marime_numerica,
           cc.cantitate                 AS cerut,
           coalesce(sum(r.cantitate), 0)::int AS intrat,
           e.cod                        AS cod_eticheta,
           max(mo.nume)                 AS motiv
      FROM comanda_cantitate cc
      JOIN comanda_linie cl ON cl.id = cc.linie_id
      JOIN comanda c        ON c.id  = cl.comanda_id
      JOIN produs p         ON p.id  = cl.produs_id
      JOIN marime m         ON m.id  = cc.marime_id
      LEFT JOIN eticheta e  ON e.linie_id = cl.id AND e.marime_id = cc.marime_id
      LEFT JOIN receptie r  ON r.eticheta_id = e.id
      LEFT JOIN motiv mo    ON mo.id = r.motiv_id
     WHERE c.stare NOT IN ('anulata', 'inchisa')
     GROUP BY c.numar, c.tip, p.denumire, p.cod_sku, m.cod, m.cod_numeric,
              m.ordine, cc.cantitate, e.cod
     ORDER BY c.numar, p.denumire, m.ordine
  `);
}

export default async function Comenzi() {
  await cere('comenzi');
  const randuri = await pozitii();

  if (randuri.length === 0) {
    return (
      <main>
        <h1>Poziții deschise</h1>
        <p>
          Nicio poziție deschisă. Dacă te așteptai la date, verifică întâi că
          <code> FIRMA_ID</code> e setat — fără el baza de date întoarce zero
          rânduri, nu o eroare.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Poziții deschise</h1>
      <p className="sumar">
        {randuri.length} poziții ·{' '}
        {randuri.reduce((s, r) => s + r.cerut, 0)} buc cerute ·{' '}
        {randuri.reduce((s, r) => s + r.intrat, 0)} buc intrate
      </p>
      <table>
        <thead>
          <tr>
            <th>Comandă</th>
            <th>Produs</th>
            <th>Mărime</th>
            <th className="nr">Cerut</th>
            <th className="nr">Intrat</th>
            <th className="nr">Lipsesc</th>
            <th>Etichetă</th>
          </tr>
        </thead>
        <tbody>
          {randuri.map((r, i) => {
            const lipsesc = r.cerut - r.intrat;
            return (
              <tr key={i}>
                <td>
                  {r.comanda} <span className="slab">{r.tip}</span>
                </td>
                <td>
                  {r.produs}
                  <br />
                  <span className="slab">{r.cod_sku}</span>
                </td>
                <td>
                  {r.marime}
                  {r.marime_numerica && <span className="slab"> · {r.marime_numerica}</span>}
                </td>
                <td className="nr">{r.cerut}</td>
                <td className="nr">{r.intrat}</td>
                <td className="nr">
                  {lipsesc > 0 ? <strong>{lipsesc}</strong> : '—'}
                  {r.motiv && <div className="slab">{r.motiv}</div>}
                </td>
                <td className="slab">{r.cod_eticheta ?? 'neemisă'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
