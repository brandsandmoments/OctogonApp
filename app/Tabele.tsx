'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// Coloanele cu numere (cantități, procente, bucăți) se aliniază la dreapta.
const NUMAR = /^[-+−]?\s?\d[\d\s.,]*(%|\s?(buc|lei|min|zile|z|ron|cm|m))?$/i;

/**
 * Pregătește tabelele din pagină ca să se citească bine pe orice ecran:
 *
 * - fiecare celulă primește numele coloanei (`data-eticheta`), ca pe telefon rândul să
 *   devină o fișă: „Stoc  12", „Comenzi  3";
 * - coloanele cu numere se aliniază la dreapta (`nr-auto`);
 * - un tabel mai lat decât ecranul se derulează în cutia lui, nu toată pagina (`lata`);
 * - codurile și datele cu cratimă rămân pe un rând (`fara-rupere`).
 *
 * Tabelele cu fișa lor proprie pe telefon (`colete`, `pe-modele`) sau marcate
 * `fara-fise` rămân cum sunt. Rulează la fiecare pagină și când se schimbă conținutul.
 */
export default function Tabele() {
  const cale = usePathname();

  useEffect(() => {
    const pregateste = () => {
      for (const t of document.querySelectorAll<HTMLTableElement>('main table')) {
        if (t.matches('.colete, .pe-modele, .fara-fise')) continue;
        t.classList.add('tabel-auto');

        // Numele coloanelor, din ultimul rând al antetului (colspan-ul ocupă mai multe coloane).
        const antet = t.tHead?.rows[t.tHead.rows.length - 1];
        const nume: string[] = [];
        const capete: HTMLTableCellElement[] = [];
        for (const th of antet?.cells ?? []) {
          for (let i = 0; i < th.colSpan; i++) { nume.push(th.innerText.trim()); capete.push(th); }
        }

        const coloane: HTMLTableCellElement[][] = nume.map(() => []);
        for (const corp of [...t.tBodies, ...(t.tFoot ? [t.tFoot] : [])]) {
          for (const tr of corp.rows) {
            tr.classList.toggle('rand-plin', tr.cells.length === 1 && tr.cells[0].colSpan > 1);
            let col = 0;
            for (const td of tr.cells) {
              // Codurile și datele („psf-ms-oct-100", „2026-10-29") nu se rup la cratimă.
              for (const el of td.querySelectorAll<HTMLElement>(':scope > a, :scope > strong, :scope > span')) {
                if (/^[^\s]{3,22}$/.test(el.innerText.trim()) && el.innerText.includes('-')) el.classList.add('fara-rupere');
              }
              if (td.childElementCount === 0 && /^[^\s]{3,22}$/.test(td.innerText.trim()) && td.innerText.includes('-')) td.classList.add('fara-rupere');
              if (nume[col] !== undefined) {
                if (!td.hasAttribute('data-eticheta')) td.setAttribute('data-eticheta', nume[col]);
                if (td.colSpan === 1) coloane[col].push(td);
              }
              col += td.colSpan;
            }
          }
        }

        coloane.forEach((celule, i) => {
          // „—" înseamnă zero sau nimic: nu decide dacă o coloană e cu numere.
          const pline = celule.map((td) => td.innerText.trim()).filter((x) => x && !/^[—–-]$/.test(x));
          const numerica = pline.length >= 2 && pline.filter((x) => NUMAR.test(x)).length / pline.length >= 0.8;
          if (!numerica) return;
          capete[i]?.classList.add('nr-auto');
          for (const td of celule) td.classList.add('nr-auto');
        });

        if (!t.closest('.tabel-derulant')) {
          t.classList.remove('lata');
          const loc = t.parentElement?.clientWidth ?? 0;
          t.classList.toggle('lata', loc > 0 && t.scrollWidth > loc + 2);
        }
      }
    };

    pregateste();
    let asteapta: ReturnType<typeof setTimeout> | undefined;
    const iar = () => { clearTimeout(asteapta); asteapta = setTimeout(pregateste, 120); };
    const urmareste = new MutationObserver(iar);
    urmareste.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', iar);
    return () => { urmareste.disconnect(); window.removeEventListener('resize', iar); clearTimeout(asteapta); };
  }, [cale]);

  return null;
}
