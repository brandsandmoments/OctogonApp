'use client';

import { useState } from 'react';

/**
 * Variațiile unei mostre: același produs în mai multe culori, fiecare cu bucățile ei pe
 * mărimi. „+ Adaugă culoare" mai pune un rând; fiecare rând trimite `cul:N` și `q:N:mărime`.
 */
export default function VariatiiMostra({ marimi }: { marimi: { id: string; cod: string }[] }) {
  const [randuri, setRanduri] = useState<number[]>([0]);
  return (
    <div className="variatii-mostra">
      <div className="tabel-derulant">
        <table className="marimi-comanda">
          <thead>
            <tr><th>Culoare</th>{marimi.map((x) => <th key={x.id}>{x.cod}</th>)}<th /></tr>
          </thead>
          <tbody>
            {randuri.map((n, i) => (
              <tr key={n}>
                <td className="ce">
                  <input name={`cul:${n}`} placeholder={i === 0 ? 'ex. Negru (dacă nu e în denumire)' : 'ex. Roșu'} aria-label={`Culoarea ${i + 1}`} />
                </td>
                {marimi.map((x) => (
                  <td key={x.id}><input name={`q:${n}:${x.id}`} inputMode="numeric" className="bucati" placeholder="0" aria-label={`Culoarea ${i + 1}, bucăți ${x.cod}`} /></td>
                ))}
                <td>
                  {randuri.length > 1 && (
                    <button type="button" className="secundar" aria-label={`Scoate culoarea ${i + 1}`}
                            onClick={() => setRanduri(randuri.filter((x) => x !== n))}>×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="secundar" onClick={() => setRanduri([...randuri, Math.max(...randuri) + 1])}>+ Adaugă culoare (variație)</button>
    </div>
  );
}
