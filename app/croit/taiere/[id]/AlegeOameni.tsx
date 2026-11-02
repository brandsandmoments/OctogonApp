'use client';

import { useState } from 'react';

type Om = { id: string; nume: string };

/**
 * Cine lucrează la o operație de croit: o listă cu un om și „+ Adaugă operator" pentru
 * încă unul — câți e nevoie. Oamenii din producție: întâi cei de la croit, apoi toți
 * ceilalți. Fiecare listă trimite un `operator`; cel de pe server îi pornește pe toți.
 */
export default function AlegeOameni({ croit, altii, ales, dezactivat }: { croit: Om[]; altii: Om[]; ales: string; dezactivat: boolean }) {
  const [liste, setListe] = useState<string[]>([ales]);
  const optiuni = (
    <>
      <option value="">cine?</option>
      <optgroup label="Croit">{croit.map((o) => <option key={o.id} value={o.id}>{o.nume}</option>)}</optgroup>
      {altii.length > 0 && <optgroup label="Alți oameni din producție">{altii.map((o) => <option key={o.id} value={o.id}>{o.nume}</option>)}</optgroup>}
    </>
  );
  return (
    <span className="alege-oameni">
      {liste.map((v, i) => (
        <span key={i} className="in-rand">
          <select name="operator" value={v} required={i === 0} disabled={dezactivat} aria-label="Cine"
                  onChange={(e) => setListe(liste.map((x, j) => (j === i ? e.target.value : x)))}>
            {optiuni}
          </select>
          {i > 0 && <button type="button" className="secundar" aria-label="Scoate" disabled={dezactivat}
                            onClick={() => setListe(liste.filter((_, j) => j !== i))}>×</button>}
        </span>
      ))}
      <button type="button" className="secundar" disabled={dezactivat} onClick={() => setListe([...liste, ''])}>+ Adaugă operator</button>
    </span>
  );
}
