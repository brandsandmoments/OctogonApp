'use client';

import { useEffect, useState } from 'react';

const randurile = (cap: Element) => {
  const lista: HTMLElement[] = [];
  for (let r = cap.nextElementSibling; r && !r.classList.contains('grupa-model'); r = r.nextElementSibling) {
    lista.push(r as HTMLElement);
  }
  return lista;
};

/**
 * Grupele unei liste (rândurile `tr.grupa-model`) se strâng: la început se văd
 * doar perioadele cu totalurile lor, iar un clic pe una îi desface rândurile.
 * `semn` se schimbă odată cu filtrele, ca lista nouă să pornească tot strânsă.
 */
export default function Pliere({ semn }: { semn: string }) {
  const [deschise, setDeschise] = useState(false);

  useEffect(() => {
    const capete = [...document.querySelectorAll('main tr.grupa-model')];
    const pune = (cap: Element, deschis: boolean) => {
      cap.classList.toggle('deschis', deschis);
      for (const r of randurile(cap)) r.hidden = !deschis;
    };
    const asculta = capete.map((cap) => {
      cap.classList.add('pliabil');
      pune(cap, false);
      const clic = (e: Event) => {
        // Un link sau un buton din capul grupei își face treaba lui.
        if ((e.target as HTMLElement).closest('a, button, input, select, label, form')) return;
        pune(cap, !cap.classList.contains('deschis'));
      };
      cap.addEventListener('click', clic);
      return () => cap.removeEventListener('click', clic);
    });
    setDeschise(false);
    return () => asculta.forEach((f) => f());
  }, [semn]);

  const toate = (deschis: boolean) => {
    for (const cap of document.querySelectorAll('main tr.grupa-model')) {
      cap.classList.toggle('deschis', deschis);
      for (const r of randurile(cap)) r.hidden = !deschis;
    }
    setDeschise(deschis);
  };

  return (
    <button type="button" className="buton" onClick={() => toate(!deschise)}>
      {deschise ? 'Strânge toate' : 'Desface toate'}
    </button>
  );
}
