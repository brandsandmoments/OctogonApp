'use client';

import { useState, type ReactNode } from 'react';
import MarimiComanda, { type LinieMarimi } from './MarimiComanda';

/**
 * Un rând de tabel care, la clic, se desface în cascadă: dedesubt apare un rând pe
 * toată lățimea cu detaliile (culorile și mărimile comenzii). Clicul pe un link, un
 * buton sau un câmp din rând nu-l desface — acelea își fac treaba lor.
 */
export default function RandCascada({ celule, detalii, grila, coloane }: {
  celule: ReactNode; coloane: number;
  detalii?: ReactNode;
  // Grila culori × mărimi, ca date: se desenează abia la deschidere — pagina nu mai trimite
  // câte un tabel gata făcut pentru fiecare rând, ci doar numerele.
  grila?: { linii: { produs: string; cod_sku: string; marimi: { marime: string }[] }[]; masuri: [string, string][] };
}) {
  const [deschis, setDeschis] = useState(false);
  return (
    <>
      <tr
        className={`rand-cascada ${deschis ? 'deschis' : ''}`}
        title={deschis ? 'Clic: strânge' : 'Clic: vezi culorile și mărimile'}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label')) return;
          setDeschis(!deschis);
        }}
      >
        {celule}
      </tr>
      {deschis && (
        <tr className="detalii-cascada">
          <td colSpan={coloane}>{grila ? <MarimiComanda linii={grila.linii as unknown as LinieMarimi<string>[]} masuri={grila.masuri} /> : detalii}</td>
        </tr>
      )}
    </>
  );
}
