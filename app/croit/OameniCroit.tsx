'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AlegeOameni from './taiere/[id]/AlegeOameni';

type Om = { id: string; nume: string };

/**
 * Oamenii de la croit (și ceilalți din producție), trimiși o singură dată pe pagină: listele
 * „cine a lucrat" de pe fiecare model îi iau de aici, în loc să-i poarte fiecare în parte.
 */
const Oameni = createContext<{ croit: Om[]; altii: Om[] }>({ croit: [], altii: [] });

export function OameniCroit({ croit, altii, children }: { croit: Om[]; altii: Om[]; children: ReactNode }) {
  return <Oameni.Provider value={{ croit, altii }}>{children}</Oameni.Provider>;
}

export const useOameniCroit = () => useContext(Oameni);

/**
 * „Cine a lucrat" pe un model din „Rămas de croit": listele apar când se începe lucrul pe
 * model — un clic într-o căsuță a lui sau pe „Alege cine a lucrat". Până atunci pagina nu
 * poartă sute de liste de oameni.
 */
export function CineCroieste({ formular, operatii, dezactivat }: {
  formular: string; operatii: [string, string, boolean][]; dezactivat: boolean;
}) {
  const { croit, altii } = useOameniCroit();
  const [deschis, setDeschis] = useState(false);
  useEffect(() => {
    if (deschis) return;
    const laFocus = (e: FocusEvent) => { if ((e.target as HTMLElement | null)?.getAttribute?.('form') === formular) setDeschis(true); };
    document.addEventListener('focusin', laFocus);
    return () => document.removeEventListener('focusin', laFocus);
  }, [deschis, formular]);
  if (!deschis) {
    return <button type="button" className="secundar" disabled={dezactivat} onClick={() => setDeschis(true)}>Alege cine a lucrat</button>;
  }
  return (
    <span className="cine-operatii">
      {operatii.map(([op, nume, obligatoriu]) => (
        <label key={op}>
          <span>{nume}</span>
          <AlegeOameni nume={`om:${op}`} form={formular} croit={croit} altii={altii} ales="" dezactivat={dezactivat} obligatoriu={obligatoriu} />
        </label>
      ))}
    </span>
  );
}
