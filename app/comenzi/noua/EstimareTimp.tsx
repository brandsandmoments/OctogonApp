'use client';

import { useState } from 'react';
import { azi as aziRo } from '../../lib/format';
import { adaugaZileLucratoare, dataRo, estimeaza, ore, zileLucratoareIntre } from '../../lib/timp';

type Linie = { nume: string; minBuc: number | null; bucati: number; termen: string };

/**
 * Cât ar dura comanda, pe măsură ce se scrie: pe fiecare linie, orele-om după
 * minutele pe bucată ale modelului; pentru toată comanda, cu câți operatori alege
 * omul, câte zile lucrătoare și ziua de gata dacă intră în lucru la data aleasă.
 * Operatorii și ziua de intrare le alege doar producția (`alocaOameni`); KAM-ul vede
 * estimarea cu echipa obișnuită, din ziua de azi.
 */
export default function EstimareTimp({ linii, orePeZi, operatori: implicit, costMinut, alocaOameni }: {
  linii: Linie[]; orePeZi: number; operatori: number; costMinut: number; alocaOameni: boolean;
}) {
  const [operatori, setOperatori] = useState(String(implicit));
  const [start, setStart] = useState(aziRo());
  const cuBucati = linii.filter((l) => l.bucati > 0);
  if (cuBucati.length === 0) return null;
  const op = Number(operatori) || 0;
  const pe = cuBucati.map((l) => ({ l, e: l.minBuc ? estimeaza({ minBuc: l.minBuc, bucati: l.bucati, operatori: op, orePeZi, start, costMinut }) : null }));
  const faraTimp = pe.filter((x) => !x.l.minBuc);
  // Orele liniilor (fiecare cu ajustarea ei de lot), împărțite la toți operatorii comenzii.
  const oreOm = pe.reduce((s, x) => s + (x.e?.oreOm ?? 0), 0);
  const zile = oreOm > 0 && op > 0 ? Math.max(1, Math.ceil(oreOm / (op * orePeZi))) : null;
  const gata = zile ? adaugaZileLucratoare(start, zile) : null;
  const termen = cuBucati.map((l) => l.termen).filter(Boolean).sort()[0];
  const zileDisponibile = termen ? zileLucratoareIntre(start, termen) : 0;
  const necesari = zileDisponibile > 0 ? Math.ceil(oreOm / (zileDisponibile * orePeZi)) : null;

  return (
    <section className="estimare-timp">
      <h2>Timp de producție estimat</h2>
      {alocaOameni ? (
        <div className="antet-comanda">
          <label><span>Operatori pe comandă</span><input inputMode="numeric" value={operatori} onChange={(e) => setOperatori(e.target.value)} /></label>
          <label><span>Intră în lucru</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        </div>
      ) : (
        <p className="slab">Estimat cu echipa obișnuită ({implicit} operatori), dacă ar intra în lucru azi. Câți oameni lucrează și când intră în lucru hotărăște producția.</p>
      )}
      <table>
        <thead><tr><th>Produs</th><th className="nr">Bucăți</th><th className="nr">Min/buc</th><th className="nr">Ore-om</th><th className="nr">Zile</th></tr></thead>
        <tbody>
          {pe.map(({ l, e }, i) => (
            <tr key={i}>
              <td>{l.nume}</td>
              <td className="nr">{l.bucati}</td>
              <td className="nr">{l.minBuc ?? <span className="lipsa">lipsă</span>}</td>
              <td className="nr">{e ? e.oreOm.toLocaleString('ro-RO', { maximumFractionDigits: 1 }) : '—'}</td>
              <td className="nr">{e ? e.zile : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {zile && gata && (
        <p className="estimare-rezultat">
          Toată comanda: <strong>{ore(oreOm)}</strong>; cu {op} operatori ≈ <strong>{zile} {zile === 1 ? 'zi lucrătoare' : 'zile lucrătoare'}</strong>,
          gata în jur de <strong>{dataRo(gata)}</strong>
          {termen && <> · termenul cel mai apropiat: {dataRo(termen)}
            {gata > termen && <span className="lipsa"> — {termen < start ? 'termenul a trecut'
              : `nu se încadrează${alocaOameni && necesari ? `; ar trebui ≈ ${necesari} operatori` : alocaOameni ? ', termenul e prea aproape' : ' cu echipa obișnuită'}`}</span>}</>}.
        </p>
      )}
      {faraTimp.length > 0 && <p className="slab">Fără timp în nomenclator: {faraTimp.map((x) => x.l.nume).join(', ')} — nu intră în estimare.</p>}
    </section>
  );
}

