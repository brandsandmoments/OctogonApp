'use client';

import { useState, type ReactNode } from 'react';

/**
 * Un rând de tabel care, la clic, se desface în cascadă: dedesubt apare un rând pe
 * toată lățimea cu detaliile (culorile și mărimile comenzii). Clicul pe un link, un
 * buton sau un câmp din rând nu-l desface — acelea își fac treaba lor.
 */
export default function RandCascada({ celule, detalii, coloane }: { celule: ReactNode; detalii: ReactNode; coloane: number }) {
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
      {deschis && <tr className="detalii-cascada"><td colSpan={coloane}>{detalii}</td></tr>}
    </>
  );
}
