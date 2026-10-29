'use client';

import { useEffect, useId, useRef, useState } from 'react';

type Material = { id: string; denumire: string; cod: string; unitate: string; furnizor: string | null; pret: string | null };

/**
 * Câmpul de material din nomenclator: scrii câteva litere („tafta roșu") și apar
 * materialele potrivite, căutate pe server. Alegerea ajunge în formular ca un câmp
 * ascuns `nume`; gol înseamnă niciun material ales.
 */
export default function CautaMaterial({
  nume, tip, ales, eticheta, placeholder = 'scrie ca să cauți în nomenclator',
}: {
  nume: string; tip?: string; ales?: { id: string; denumire: string } | null; eticheta?: string; placeholder?: string;
}) {
  const [id, setId] = useState(ales?.id ?? '');
  const [text, setText] = useState(ales?.denumire ?? '');
  const [lista, setLista] = useState<Material[]>([]);
  const [deschis, setDeschis] = useState(false);
  const [activ, setActiv] = useState(0);
  const idLista = useId();
  const cerere = useRef(0);

  useEffect(() => {
    if (!deschis) return;
    const nr = ++cerere.current;
    const t = setTimeout(async () => {
      const r = await fetch(`/materiale/cauta?${new URLSearchParams({ q: text, ...(tip ? { tip } : {}) })}`);
      if (r.ok && nr === cerere.current) { setLista(await r.json()); setActiv(0); }
    }, 150);
    return () => clearTimeout(t);
  }, [text, tip, deschis]);

  const alege = (m: Material | null) => {
    setId(m?.id ?? '');
    setText(m?.denumire ?? '');
    setDeschis(false);
  };

  return (
    <span className="cauta-material">
      <input type="hidden" name={nume} value={id} />
      <input
        value={text}
        placeholder={placeholder}
        aria-label={eticheta ?? 'Material din nomenclator'}
        role="combobox"
        aria-expanded={deschis}
        aria-controls={idLista}
        autoComplete="off"
        onFocus={() => setDeschis(true)}
        onBlur={() => setTimeout(() => setDeschis(false), 150)}
        onChange={(e) => { setText(e.target.value); setId(''); setDeschis(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActiv((a) => Math.min(a + 1, lista.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActiv((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && deschis && lista[activ]) { e.preventDefault(); alege(lista[activ]); }
          else if (e.key === 'Escape') setDeschis(false);
        }}
      />
      {id && <button type="button" className="mic" onClick={() => alege(null)} aria-label="Golește">×</button>}
      {deschis && lista.length > 0 && (
        <ul id={idLista} role="listbox" className="lista-cauta">
          {lista.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === activ} className={i === activ ? 'activ' : ''}
                onMouseDown={(e) => { e.preventDefault(); alege(m); }}>
              {m.denumire} <span className="slab">{m.cod} · {m.unitate}{m.furnizor ? ` · ${m.furnizor}` : ''}{m.pret ? ` · ${m.pret} lei` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
