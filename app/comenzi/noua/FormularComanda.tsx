'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { LinieNoua, Nomenclatoare } from '../../lib/comenzi';
import { salveazaComanda } from './actiuni';

// Data locală, nu UTC: după miezul nopții în România, UTC e încă „ieri".
const azi = () => new Date().toLocaleDateString('sv-SE');
const linieGoala = (): LinieNoua => ({ produsId: '', dataCeruta: '', cantitati: {} });

export default function FormularComanda({ branduri, produse, marimi }: Nomenclatoare) {
  const router = useRouter();
  const [seLucreaza, porneste] = useTransition();
  const [eroare, setEroare] = useState<string>();

  const [numar, setNumar] = useState('');
  const [tip, setTip] = useState<'PSF' | 'PSC'>('PSC');
  const [brandId, setBrandId] = useState(branduri.length === 1 ? branduri[0].id : '');
  const [dataLansare, setDataLansare] = useState(azi());
  const [prioritate, setPrioritate] = useState(3);
  const [observatii, setObservatii] = useState('');
  const [linii, setLinii] = useState<LinieNoua[]>([linieGoala()]);

  // Doar produsele brandului ales: o comandă e a unui singur brand.
  const produseBrand = produse.filter((p) => p.brand_id === brandId);

  const schimbaLinie = (i: number, l: Partial<LinieNoua>) =>
    setLinii((ls) => ls.map((x, j) => (j === i ? { ...x, ...l } : x)));

  const totalLinie = (l: LinieNoua) =>
    Object.values(l.cantitati).reduce((s, q) => s + (Number.isInteger(q) && q > 0 ? q : 0), 0);
  const total = linii.reduce((s, l) => s + totalLinie(l), 0);

  function trimite(lanseaza: boolean) {
    setEroare(undefined);
    porneste(async () => {
      const r = await salveazaComanda({
        numar, tip, brandId, dataLansare, prioritate, observatii, lanseaza, linii,
      });
      if (r.ok) router.push(`/necesar/${encodeURIComponent(r.numar)}`);
      else setEroare(r.eroare);
    });
  }

  return (
    <main className="formular">
      <h1>Comandă nouă</h1>

      <section className="antet-comanda">
        <label>
          <span>Număr</span>
          <input value={numar} onChange={(e) => setNumar(e.target.value)} placeholder="psc-oct-26-2" />
        </label>
        <fieldset className="comutator">
          <legend>Tip</legend>
          {(['PSF', 'PSC'] as const).map((t) => (
            <label key={t} className={tip === t ? 'ales' : ''}>
              <input type="radio" name="tip" checked={tip === t} onChange={() => setTip(t)} />
              {t}
            </label>
          ))}
        </fieldset>
        <label>
          <span>Brand</span>
          <select
            value={brandId}
            onChange={(e) => {
              setBrandId(e.target.value);
              setLinii([linieGoala()]);
            }}
          >
            <option value="">—</option>
            {branduri.map((b) => <option key={b.id} value={b.id}>{b.nume}</option>)}
          </select>
        </label>
        <label>
          <span>Data lansării</span>
          <input type="date" value={dataLansare} onChange={(e) => setDataLansare(e.target.value)} />
        </label>
        <label>
          <span>Prioritate</span>
          <select value={prioritate} onChange={(e) => setPrioritate(Number(e.target.value))}>
            <option value={1}>1 — urgent</option>
            <option value={2}>2</option>
            <option value={3}>3 — normal</option>
            <option value={4}>4</option>
            <option value={5}>5 — cea mai mică</option>
          </select>
        </label>
        <label className="lat">
          <span>Observații</span>
          <input value={observatii} onChange={(e) => setObservatii(e.target.value)} />
        </label>
      </section>

      <div className="tabel-derulant">
        <table className="grila">
          <thead>
            <tr>
              <th>Produs</th>
              <th>Cerut în depozit</th>
              {marimi.map((m) => (
                <th key={m.id} className="nr">
                  {m.cod}
                  {m.cod_numeric && <div className="slab">{m.cod_numeric}</div>}
                </th>
              ))}
              <th className="nr">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {linii.map((l, i) => (
              <tr key={i}>
                <td>
                  <select
                    value={l.produsId}
                    disabled={!brandId}
                    onChange={(e) => schimbaLinie(i, { produsId: e.target.value })}
                    aria-label="Produs"
                  >
                    <option value="">{brandId ? '— alege produsul —' : 'alege întâi brandul'}</option>
                    {produseBrand.map((p) => (
                      <option key={p.id} value={p.id}>{p.nume} · {p.cod_sku}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="date"
                    value={l.dataCeruta}
                    onChange={(e) => schimbaLinie(i, { dataCeruta: e.target.value })}
                    aria-label="Data cerută în depozit"
                  />
                </td>
                {marimi.map((m) => (
                  <td key={m.id} className="nr">
                    <input
                      className="bucati"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={l.cantitati[m.id] ?? ''}
                      onChange={(e) =>
                        schimbaLinie(i, { cantitati: { ...l.cantitati, [m.id]: e.target.valueAsNumber } })
                      }
                      aria-label={`Cantitate ${m.cod}`}
                    />
                  </td>
                ))}
                <td className="nr"><strong>{totalLinie(l) || ''}</strong></td>
                <td>
                  {linii.length > 1 && (
                    <button
                      type="button"
                      className="mic"
                      onClick={() => setLinii((ls) => ls.filter((_, j) => j !== i))}
                      aria-label="Șterge linia"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="secundar"
        disabled={!brandId}
        onClick={() =>
          // Data cerută se moștenește de la linia de deasupra: de obicei e aceeași.
          setLinii((ls) => [...ls, { ...linieGoala(), dataCeruta: ls[ls.length - 1]?.dataCeruta ?? '' }])
        }
      >
        + Linie
      </button>

      <p className="sumar">{linii.filter((l) => l.produsId).length} produse · {total} buc</p>
      {eroare && <p className="eroare">{eroare}</p>}

      <div className="actiuni">
        <button type="button" className="principal" disabled={seLucreaza} onClick={() => trimite(true)}>
          {seLucreaza ? 'Se salvează…' : 'Lansează comanda'}
        </button>
        <button type="button" className="secundar" disabled={seLucreaza} onClick={() => trimite(false)}>
          Salvează ca ciornă
        </button>
      </div>
    </main>
  );
}
