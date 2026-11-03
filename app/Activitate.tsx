'use client';

import { useEffect, useState } from 'react';

/**
 * Semnul că aplicația lucrează: o bară subțire sus cât se încarcă o pagină sau se salvează
 * o acțiune (cererile Next ale routerului și ale acțiunilor de server). Cât o acțiune e în
 * drum, un al doilea clic pe un buton de trimis e ignorat — nu se salvează nimic de două ori
 * (de ex. „Dă în lucru" apăsat de două ori).
 */
export default function Activitate() {
  const [vizibil, setVizibil] = useState(false);
  useEffect(() => {
    let inDrum = 0;
    let actiuni = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const anunta = () => {
      clearTimeout(t);
      if (inDrum > 0) t = setTimeout(() => setVizibil(true), 150);   // ce vine repede nu clipește
      else setVizibil(false);
    };
    const original = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const h = new Headers(args[1]?.headers ?? (args[0] instanceof Request ? args[0].headers : undefined));
      const next = (h.has('rsc') || h.has('next-action')) && !h.has('next-router-prefetch');
      if (!next) return original(...args);
      const actiune = h.has('next-action');
      inDrum++; if (actiune) actiuni++;
      anunta();
      let gata = false;
      const termina = () => { if (gata) return; gata = true; inDrum--; if (actiune) actiuni--; anunta(); };
      try {
        const r = await original(...args);
        // Antetele vin repede, pagina curge după: se socotește terminat abia la capătul răspunsului
        // (citit dintr-o copie, ca Next să primească răspunsul neatins).
        if (r.body) r.clone().body!.pipeTo(new WritableStream()).catch(() => {}).finally(termina);
        else termina();
        return r;
      } catch (e) { termina(); throw e; }
    };
    const laTrimitere = (e: SubmitEvent) => {
      if (actiuni > 0) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    document.addEventListener('submit', laTrimitere, true);
    return () => { window.fetch = original; document.removeEventListener('submit', laTrimitere, true); clearTimeout(t); };
  }, []);
  return <div className={`activitate ${vizibil ? 'activ' : ''}`} role="progressbar" aria-hidden={!vizibil} aria-label="Se încarcă" />;
}
