'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ProdusOptiune } from '../../lib/comenzi';

/** „Rochie Sophie Negru" → „rochie sophie negru": fără diacritice și majuscule, ca „sofie" să nu rateze „Sophie" din cauza unui ș. */
const simplu = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const MAXIM = 30;

/**
 * Câmpul de produs: scrii câteva litere și apar doar produsele potrivite.
 * Fiecare cuvânt scris trebuie să apară undeva în denumire sau în SKU, în orice
 * ordine — „sophie neg" găsește Rochie Sophie Negru. Săgeți și Enter din
 * tastatură, sau clic. Se arată cel mult 30 de potriviri: mai multe înseamnă că
 * trebuie scris încă un cuvânt, nu derulat.
 */
export default function CautaProdus({
  produse,
  valoare,
  dezactivat,
  onAlege,
}: {
  produse: ProdusOptiune[];
  valoare: string;
  dezactivat: boolean;
  onAlege: (id: string) => void;
}) {
  const ales = produse.find((p) => p.id === valoare);
  const [text, setText] = useState('');
  const [deschis, setDeschis] = useState(false);
  const [activ, setActiv] = useState(0);
  const lista = useId();
  const intrare = useRef<HTMLInputElement>(null);
  const listaEl = useRef<HTMLUListElement>(null);
  // Lista se poziționează față de ecran: tabelul liniilor derulează orizontal, iar
  // un container cu derulare ar tăia o listă poziționată în interiorul lui.
  const [loc, setLoc] = useState<{ left: number; top: number; width: number } | null>(null);
  const masoara = () => {
    const r = intrare.current?.getBoundingClientRect();
    if (r) setLoc({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 320) });
  };
  useEffect(() => {
    if (!deschis) return;
    // Derularea paginii mută câmpul, deci lista se închide; derularea prin listă, nu.
    const inchide = (e: Event) => {
      if (e.target instanceof Node && listaEl.current?.contains(e.target)) return;
      setDeschis(false);
    };
    window.addEventListener('scroll', inchide, true);
    window.addEventListener('resize', inchide);
    return () => { window.removeEventListener('scroll', inchide, true); window.removeEventListener('resize', inchide); };
  }, [deschis]);

  const potrivite = useMemo(() => {
    const cuvinte = simplu(text).split(/\s+/).filter(Boolean);
    if (cuvinte.length === 0) return produse.slice(0, MAXIM);
    return produse
      .filter((p) => {
        const unde = simplu(`${p.nume} ${p.cod_sku}`);
        return cuvinte.every((c) => unde.includes(c));
      })
      .slice(0, MAXIM + 1);
  }, [produse, text]);
  const prea = potrivite.length > MAXIM;
  const vizibile = potrivite.slice(0, MAXIM);

  function alege(p: ProdusOptiune) {
    onAlege(p.id);
    setText('');
    setDeschis(false);
  }

  return (
    <div className="cauta-produs">
      <input
        ref={intrare}
        role="combobox"
        aria-expanded={deschis}
        aria-controls={lista}
        aria-autocomplete="list"
        aria-activedescendant={deschis && vizibile[activ] ? `${lista}-${activ}` : undefined}
        aria-label="Produs"
        disabled={dezactivat}
        placeholder={dezactivat ? 'alege întâi brandul' : 'scrie denumirea sau SKU-ul'}
        // Cât nu se scrie nimic, câmpul arată produsul ales; la tastare devine căutare.
        value={deschis ? text : ales ? `${ales.nume} · ${ales.cod_sku}` : text}
        onFocus={() => { masoara(); setDeschis(true); setActiv(0); }}
        onBlur={() => setTimeout(() => setDeschis(false), 150)}
        onChange={(e) => { setText(e.target.value); masoara(); setDeschis(true); setActiv(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActiv((a) => Math.min(a + 1, vizibile.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActiv((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (vizibile[activ]) alege(vizibile[activ]); }
          else if (e.key === 'Escape') { setDeschis(false); intrare.current?.blur(); }
        }}
      />
      {deschis && !dezactivat && loc && (
        <ul id={lista} ref={listaEl} role="listbox" className="lista-produse"
          style={{ left: loc.left, top: loc.top, width: loc.width }}>
          {vizibile.length === 0 && <li className="slab">Niciun produs nu se potrivește.</li>}
          {vizibile.map((p, i) => (
            <li
              key={p.id}
              id={`${lista}-${i}`}
              role="option"
              aria-selected={i === activ}
              className={i === activ ? 'activ' : ''}
              // mousedown, nu click: altfel câmpul pierde focusul și lista se închide înainte de alegere.
              onMouseDown={(e) => { e.preventDefault(); alege(p); }}
              onMouseEnter={() => setActiv(i)}
            >
              {p.nume} <span className="slab">{p.cod_sku}{!p.activ && ' · inactiv'}</span>
            </li>
          ))}
          {prea && <li className="slab">… mai sunt potriviri: scrie încă un cuvânt.</li>}
        </ul>
      )}
    </div>
  );
}
