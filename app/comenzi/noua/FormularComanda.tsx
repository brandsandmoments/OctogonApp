'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { LinieNoua, Nomenclatoare } from '../../lib/comenzi';
import { salveazaComanda } from './actiuni';
import CautaProdus from './CautaProdus';

// Data locală, nu UTC: după miezul nopții în România, UTC e încă „ieri".
const azi = () => new Date().toLocaleDateString('sv-SE');
const linieGoala = (): LinieNoua => ({ produsId: '', dataCeruta: '', vanzareDeLa: '', vanzarePanaLa: '', cantitati: {} });

export default function FormularComanda({
  branduri, produse, marimi, kami, kamImplicit, tipImplicit,
}: Nomenclatoare & { kamImplicit: string; tipImplicit: 'PSF' | 'PSC' }) {
  const router = useRouter();
  const [seLucreaza, porneste] = useTransition();
  const [eroare, setEroare] = useState<string>();

  const [tip, setTip] = useState<'PSF' | 'PSC'>(tipImplicit);
  const [brandId, setBrandId] = useState(branduri.length === 1 ? branduri[0].id : '');
  const [kamId, setKamId] = useState(kamImplicit);
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
        tip, brandId, kamId, dataLansare, prioritate, observatii, lanseaza, linii,
      });
      if (r.ok) router.push(`/necesar/${encodeURIComponent(r.numar)}`);
      else setEroare(r.eroare);
    });
  }

  return (
    <main className="formular">
      <h1>Comandă nouă</h1>

      <section className="antet-comanda">
        <p className="slab lat">Numărul îl dă aplicația la salvare: {tip.toLowerCase()}-brand-an-lună-nr., ex. {tip.toLowerCase()}-ms-26-noi-4.</p>
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
          <span>KAM{tip === 'PSF' && ' *'}</span>
          <select value={kamId} onChange={(e) => setKamId(e.target.value)}>
            <option value="">—</option>
            {kami.map((k) => <option key={k.id} value={k.id}>{k.nume}</option>)}
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
              {tip === 'PSF' && <th>Se vinde de la</th>}
              {tip === 'PSF' && <th>până la</th>}
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
                  <CautaProdus
                    produse={produseBrand}
                    valoare={l.produsId}
                    dezactivat={!brandId}
                    onAlege={(id) => schimbaLinie(i, { produsId: id })}
                  />
                </td>
                <td>
                  <input
                    type="date"
                    value={l.dataCeruta}
                    onChange={(e) => schimbaLinie(i, { dataCeruta: e.target.value })}
                    aria-label="Data cerută în depozit"
                  />
                </td>
                {tip === 'PSF' && (
                  <>
                    <td>
                      <input type="date" value={l.vanzareDeLa}
                        onChange={(e) => schimbaLinie(i, { vanzareDeLa: e.target.value })}
                        aria-label="Se vinde de la" />
                    </td>
                    <td>
                      <input type="date" value={l.vanzarePanaLa} min={l.vanzareDeLa || undefined}
                        onChange={(e) => schimbaLinie(i, { vanzarePanaLa: e.target.value })}
                        aria-label="Se vinde până la" />
                    </td>
                  </>
                )}
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
          // Datele se moștenesc de la linia de deasupra: de obicei sunt aceleași.
          setLinii((ls) => {
            const sus = ls[ls.length - 1];
            return [...ls, { ...linieGoala(), dataCeruta: sus?.dataCeruta ?? '',
                             vanzareDeLa: sus?.vanzareDeLa ?? '', vanzarePanaLa: sus?.vanzarePanaLa ?? '' }];
          })
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
