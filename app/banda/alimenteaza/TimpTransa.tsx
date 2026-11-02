'use client';

import { useState } from 'react';
import { azi } from '../../lib/format';
import { dataRo, estimeaza, ore, zileLucratoareIntre } from '../../lib/timp';

/**
 * Operatorii și minutele pe bucată ale tranșei, cu estimarea pe loc: câte ore-om, câte
 * zile lucrătoare și ziua de gata dacă intră azi, față de termenul din depozit — și,
 * dacă nu se încadrează, câți operatori ar trebui.
 */
export default function TimpTransa({ bucati, minImplicit, operatoriImpliciti, orePeZi, termen }: {
  bucati: number; minImplicit: number | null; operatoriImpliciti: number; orePeZi: number; termen: string;
}) {
  const [persoane, setPersoane] = useState(String(operatoriImpliciti));
  const [minute, setMinute] = useState(minImplicit ? String(minImplicit) : '');
  const start = azi();
  const e = estimeaza({ minBuc: Number(minute.replace(',', '.')) || 0, bucati, operatori: Number(persoane) || 0, orePeZi, start });
  const zileDisponibile = termen ? zileLucratoareIntre(start, termen) : 0;
  const necesari = e && zileDisponibile > 0 ? Math.ceil(e.oreOm / (zileDisponibile * orePeZi)) : null;
  return (
    <>
      <label><span>Număr de operatori</span><input name="persoane" inputMode="numeric" value={persoane} onChange={(x) => setPersoane(x.target.value)} /></label>
      <label><span>Minute pe bucată</span><input name="timp" inputMode="decimal" value={minute} onChange={(x) => setMinute(x.target.value)} /></label>
      <p className="lat estimare-rezultat">
        {e ? <>{bucati} buc ≈ <strong>{ore(e.oreOm)}</strong>; cu {persoane} operatori ≈ <strong>{e.zile} {e.zile === 1 ? 'zi lucrătoare' : 'zile lucrătoare'}</strong>,
          gata în jur de <strong>{dataRo(e.gata)}</strong>
          {termen && <> (în depozit cerut {dataRo(termen)}{e.gata > termen
            ? <span className="lipsa"> — {termen < start ? 'termenul a trecut' : `nu se încadrează${necesari ? `; ar trebui ≈ ${necesari} operatori` : ''}`}</span>
            : ', se încadrează'})</>}.</>
          : <span className="slab">Scrie operatorii și minutele pe bucată ca să vezi cât durează.</span>}
      </p>
    </>
  );
}
