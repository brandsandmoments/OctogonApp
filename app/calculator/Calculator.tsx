'use client';

import { useMemo, useState } from 'react';
import { dataRo, estimeaza, operatoriNecesari, ore } from '../lib/timp';

export type ModelTimp = { id: string; nume: string; brand: string | null; minute: number | null };

const LOTURI: [string, number, number][] = [['1', 1, 1], ['10–30', 10, 30], ['25–50', 25, 50], ['50–100', 50, 100], ['150–200', 150, 200]];
const lei = (n: number) => `${n.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} lei`;

/**
 * Calculatorul de timp: alegi modelul (sau scrii minutele), câte bucăți, câți
 * operatori — și vezi orele-om, zilele lucrătoare, ziua de gata și manopera. Plus
 * invers: câți operatori trebuie ca să fie gata până la un termen.
 */
export default function Calculator({ modele, orePeZi: oreImplicite, operatori: operatoriImpliciti, costMinut, azi }: {
  modele: ModelTimp[]; orePeZi: number; operatori: number; costMinut: number; azi: string;
}) {
  const [cauta, setCauta] = useState('');
  const [minuteScrise, setMinuteScrise] = useState('');
  const [bucati, setBucati] = useState('100');
  const [operatori, setOperatori] = useState(String(operatoriImpliciti));
  const [orePeZi, setOrePeZi] = useState(String(oreImplicite));
  const [start, setStart] = useState(azi);
  const [termen, setTermen] = useState('');

  const eticheta = (m: ModelTimp) => `${m.nume}${m.brand ? ` · ${m.brand}` : ''}`;
  const model = modele.find((m) => eticheta(m).toLowerCase() === cauta.trim().toLowerCase() || m.nume.toLowerCase() === cauta.trim().toLowerCase());
  const minBuc = Number(minuteScrise.replace(',', '.')) || model?.minute || 0;
  const n = (s: string) => Number(s.replace(',', '.')) || 0;
  const e = useMemo(() => estimeaza({ minBuc, bucati: n(bucati), operatori: n(operatori), orePeZi: n(orePeZi), start, costMinut }),
    [minBuc, bucati, operatori, orePeZi, start, costMinut]);
  const necesari = termen ? operatoriNecesari({ minBuc, bucati: n(bucati), orePeZi: n(orePeZi), start, termen }) : null;

  return (
    <div className="calculator">
      <datalist id="modele-timp">
        {modele.map((m) => <option key={m.id} value={eticheta(m)} label={m.minute ? `${m.minute} min/buc` : 'fără timp'} />)}
      </datalist>
      <div className="antet-comanda">
        <label className="lat-2"><span>Model</span>
          <input list="modele-timp" value={cauta} onChange={(x) => setCauta(x.target.value)} placeholder="scrie numele modelului…" autoComplete="off" /></label>
        <label><span>Minute pe bucată (1 om)</span>
          <input inputMode="decimal" value={minuteScrise} onChange={(x) => setMinuteScrise(x.target.value)}
                 placeholder={model?.minute ? `${model.minute} din nomenclator` : 'scrie minutele'} /></label>
        <label><span>Bucăți</span><input inputMode="numeric" value={bucati} onChange={(x) => setBucati(x.target.value)} /></label>
        <label><span>Operatori</span><input inputMode="numeric" value={operatori} onChange={(x) => setOperatori(x.target.value)} /></label>
        <label><span>Ore lucrătoare / zi</span><input inputMode="decimal" value={orePeZi} onChange={(x) => setOrePeZi(x.target.value)} /></label>
        <label><span>Intră în lucru</span><input type="date" value={start} onChange={(x) => setStart(x.target.value)} /></label>
      </div>
      {cauta && !model && !minuteScrise && <p className="slab">Alege modelul din listă sau scrie minutele pe bucată.</p>}
      {model && !model.minute && !minuteScrise && <p className="lipsa">Modelul n-are încă timpul trecut în nomenclator: scrie minutele pe bucată.</p>}

      {e && (
        <>
          <dl className="cifre-birou">
            <div><dt>Ore de lucru</dt><dd>{ore(e.oreOm)}</dd></div>
            <div><dt>Zile lucrătoare</dt><dd>{e.zile} <span>{e.zile === 1 ? 'zi' : 'zile'}</span></dd></div>
            <div><dt>Gata în jur de</dt><dd>{dataRo(e.gata)}</dd></div>
            {e.manopera != null && <div><dt>Manoperă estimată</dt><dd>{lei(e.manopera)}</dd></div>}
          </dl>
          <p className="slab">
            {minBuc} min/buc × {n(bucati)} buc{e.factor !== 1 ? ` × ${e.factor} (${e.factor > 1 ? 'lot mic, sub 50 buc: +20%' : 'lot mare, peste 200 buc: −15%'})` : ''}
            {' '}= {ore(e.oreOm)}, împărțite la {n(operatori)} operatori × {n(orePeZi)} ore pe zi. Fără sâmbete și duminici.
          </p>
        </>
      )}

      <div className="antet-comanda">
        <label><span>Trebuie gata până la</span><input type="date" value={termen} onChange={(x) => setTermen(x.target.value)} min={start} /></label>
        <div className="lat-2 raspuns-termen">
          {termen && (necesari ? <p><strong>{necesari} operatori</strong> ca să iasă gata până {dataRo(termen)} (începând {dataRo(start)}).</p>
            : <p className="slab">Alege modelul, bucățile și un termen după ziua de început.</p>)}
        </div>
      </div>

      {minBuc > 0 && (
        <>
          <h2>Pe mărimi de lot, cu {n(operatori) || '—'} operatori</h2>
          <table>
            <thead><tr><th>Lot</th><th className="nr">Ore-om</th><th className="nr">Zile lucrătoare</th><th className="nr">Manoperă</th></tr></thead>
            <tbody>
              {LOTURI.map(([nume, a, b]) => {
                const [x, y] = [a, b].map((q) => estimeaza({ minBuc, bucati: q, operatori: n(operatori), orePeZi: n(orePeZi), start, costMinut }));
                const interval = (f: (v: NonNullable<typeof x>) => string) => (x && y ? (f(x) === f(y) ? f(x) : `${f(x)} – ${f(y)}`) : '—');
                return (
                  <tr key={nume}>
                    <td>{nume} buc</td>
                    <td className="nr">{interval((v) => v.oreOm.toLocaleString('ro-RO', { maximumFractionDigits: 1 }))}</td>
                    <td className="nr">{interval((v) => String(v.zile))}</td>
                    <td className="nr">{interval((v) => lei(v.manopera ?? 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
