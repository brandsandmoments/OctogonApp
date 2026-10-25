'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { CerereReceptie, Motiv, PozitieScanata } from '../lib/receptie';
import { cautaEticheta, confirmaReceptie } from './actiuni';

/**
 * BarcodeDetector e în Chrome pe Android, nu și în Safari pe iPhone. Tipurile
 * TypeScript nu-l cunosc încă, așa că îl declarăm aici doar cât îl folosim.
 * Unde lipsește, rămâne câmpul de text — în care scrie și un scanner de mână
 * conectat ca tastatură.
 */
type Detector = { detect(sursa: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type ConstructorDetector = new (o: { formats: string[] }) => Detector;

function detectorDisponibil(): ConstructorDetector | null {
  return (globalThis as { BarcodeDetector?: ConstructorDetector }).BarcodeDetector ?? null;
}

type Stare =
  | { pas: 'scan'; mesaj?: string }
  | { pas: 'pozitie'; p: PozitieScanata; eroare?: string }
  | { pas: 'gata'; p: PozitieScanata; cantitate: number };

export default function Scanare({ motive }: { motive: Motiv[] }) {
  const [stare, setStare] = useState<Stare>({ pas: 'scan' });
  const [seLucreaza, porneste] = useTransition();

  function cauta(cod: string) {
    porneste(async () => {
      const p = await cautaEticheta(cod);
      setStare(p ? { pas: 'pozitie', p } : { pas: 'scan', mesaj: `Nu găsesc eticheta ${cod.trim()}.` });
    });
  }

  return (
    <main className="scanare">
      {stare.pas === 'scan' && (
        <PasScan onCod={cauta} mesaj={stare.mesaj} seLucreaza={seLucreaza} />
      )}
      {stare.pas === 'pozitie' && (
        <PasPozitie
          key={stare.p.cod + stare.p.intrat}
          p={stare.p}
          motive={motive}
          eroare={stare.eroare}
          seLucreaza={seLucreaza}
          onRenunta={() => setStare({ pas: 'scan' })}
          onConfirma={(cerere) =>
            porneste(async () => {
              const r = await confirmaReceptie({ cod: stare.p.cod, ...cerere });
              if (r.ok) setStare({ pas: 'gata', p: r.pozitie, cantitate: cerere.cantitate });
              else setStare({ pas: 'pozitie', p: r.pozitie ?? stare.p, eroare: r.eroare });
            })
          }
        />
      )}
      {stare.pas === 'gata' && (
        <PasGata p={stare.p} cantitate={stare.cantitate} onUrmatoarea={() => setStare({ pas: 'scan' })} />
      )}
    </main>
  );
}

function PasScan({
  onCod,
  mesaj,
  seLucreaza,
}: {
  onCod: (cod: string) => void;
  mesaj?: string;
  seLucreaza: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<'pornita' | 'lipsa' | 'refuzata' | 'asteapta'>('asteapta');
  const [cod, setCod] = useState('');
  const gasit = useRef(false);
  // `onCod` e o funcție nouă la fiecare randare; camera nu trebuie repornită pentru asta.
  const laCod = useRef(onCod);
  laCod.current = onCod;

  useEffect(() => {
    const Ctor = detectorDisponibil();
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setCamera('lipsa');
      return;
    }
    const detector = new Ctor({ formats: ['qr_code', 'code_128'] });
    let flux: MediaStream | null = null;
    let ceas: ReturnType<typeof setInterval> | undefined;
    let oprit = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (f) => {
        if (oprit) return f.getTracks().forEach((t) => t.stop());
        flux = f;
        const v = video.current!;
        v.srcObject = f;
        await v.play();
        if (oprit) return;
        setCamera('pornita');
        // De patru ori pe secundă e destul: eticheta stă în fața camerei
        // mai mult de un sfert de secundă, iar bateria contează pe o tură întreagă.
        ceas = setInterval(async () => {
          if (gasit.current || v.readyState < 2) return;
          const [primul] = await detector.detect(v).catch(() => []);
          if (primul?.rawValue && !gasit.current) {
            gasit.current = true;
            navigator.vibrate?.(60);
            laCod.current(primul.rawValue);
            // Dacă eticheta nu se găsește, ecranul rămâne aici; după o pauză
            // camera citește din nou, fără să bombardeze serverul cu același cod.
            setTimeout(() => (gasit.current = false), 2000);
          }
        }, 250);
      })
      .catch(() => setCamera('refuzata'));

    return () => {
      oprit = true;
      clearInterval(ceas);
      flux?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <>
      <h1>Recepție</h1>
      {camera !== 'lipsa' && camera !== 'refuzata' && (
        <div className="camera">
          <video ref={video} muted playsInline />
          <div className="vizor" />
        </div>
      )}
      {camera === 'lipsa' && (
        <p className="slab">Browserul ăsta nu citește coduri din cameră. Scrie codul de pe etichetă.</p>
      )}
      {camera === 'refuzata' && (
        <p className="slab">Camera nu e permisă. Scrie codul de pe etichetă sau permite camera din setări.</p>
      )}

      <form
        className="cod-manual"
        onSubmit={(e) => {
          e.preventDefault();
          if (cod.trim()) onCod(cod);
        }}
      >
        <input
          value={cod}
          onChange={(e) => setCod(e.target.value)}
          placeholder="OCT-…"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-label="Codul etichetei"
        />
        <button disabled={seLucreaza || !cod.trim()}>Caută</button>
      </form>

      {seLucreaza && <p className="slab">Caut…</p>}
      {mesaj && <p className="eroare">{mesaj}</p>}
    </>
  );
}

function Antet({ p }: { p: PozitieScanata }) {
  return (
    <header className="antet">
      <h1>{p.produs}</h1>
      <p className="slab">{p.cod_sku}</p>
      <p>
        Mărimea <strong>{p.marime}</strong>
        {p.marime_numerica && <span className="slab"> · {p.marime_numerica}</span>}
      </p>
      <p className="slab">
        {p.comanda} {p.tip} · poziția {p.pozitie} · {p.cod}
      </p>
    </header>
  );
}

function Cifre({ p }: { p: PozitieScanata }) {
  return (
    <dl className="cifre">
      <div><dt>Cerut</dt><dd>{p.cerut}</dd></div>
      <div><dt>Intrat</dt><dd>{p.intrat}</dd></div>
      {p.peste > 0 ? (
        <div className="plus"><dt>Peste</dt><dd>+{p.peste}</dd></div>
      ) : (
        <div className={p.lipsesc > 0 ? 'lipsa' : ''}><dt>Lipsesc</dt><dd>{p.lipsesc}</dd></div>
      )}
    </dl>
  );
}

function PasPozitie({
  p,
  motive,
  eroare,
  seLucreaza,
  onRenunta,
  onConfirma,
}: {
  p: PozitieScanata;
  motive: Motiv[];
  eroare?: string;
  seLucreaza: boolean;
  onRenunta: () => void;
  onConfirma: (c: Omit<CerereReceptie, 'cod'>) => void;
}) {
  // Propunerea e restul: în cele mai multe cazuri coletul e complet și omul
  // doar apasă „Confirm". Pe o poziție deja completă formularul stă ascuns:
  // acolo, cel mai probabil, eticheta a fost scanată a doua oară.
  const completa = p.lipsesc === 0;
  const [inPlus, setInPlus] = useState(false);
  const [cantitate, setCantitate] = useState(completa ? 1 : p.lipsesc);
  const [motivId, setMotivId] = useState<string | null>(null);
  const [inchide, setInchide] = useState(false);
  const [observatii, setObservatii] = useState('');

  const formular = !p.inchisa && (!completa || inPlus);
  const valida = Number.isInteger(cantitate) && cantitate >= 0;
  const sub = valida && cantitate < p.lipsesc;
  const peste = valida ? Math.max(0, p.intrat + cantitate - p.cerut) - p.peste : 0;
  const zero = valida && cantitate === 0;
  // Pe zero, închiderea nu e o alegere: o recepție de zero bucăți care lasă
  // poziția deschisă n-ar spune nimic.
  const seInchide = sub && (inchide || zero);
  const poateConfirma =
    formular && valida && !seLucreaza &&
    (!sub || motivId !== null) &&
    (!zero || observatii.trim() !== '');

  let eticheta = `Confirm ${valida ? cantitate : ''} buc`;
  if (zero) eticheta = 'Închide poziția pe zero';
  else if (peste > 0) eticheta = `Confirm ${cantitate} buc — ${peste} peste cerut`;
  else if (seInchide) eticheta = `Confirm ${cantitate} buc și închide`;

  return (
    <>
      <Antet p={p} />
      <Cifre p={p} />

      {p.inchisa && (
        <p className="eroare">
          Poziția e închisă{p.motiv_inchidere ? ` — ${p.motiv_inchidere}` : ''}. Nu mai primește marfă.
        </p>
      )}
      {!p.inchisa && completa && !inPlus && (
        <>
          <p className="ok">Poziția e completă. Nu mai lipsește nimic.</p>
          <button type="button" className="secundar" onClick={() => setInPlus(true)}>
            Au venit bucăți în plus
          </button>
        </>
      )}

      {formular && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (poateConfirma) {
              onConfirma({ cantitate, motivId: sub ? motivId : null, inchide: seInchide, observatii });
            }
          }}
        >
          <p className="eticheta-camp">Intră acum</p>
          <div className="cantitate">
            <button type="button" onClick={() => setCantitate((n) => Math.max(0, (n || 0) - 1))} aria-label="Mai puțin">−</button>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={Number.isNaN(cantitate) ? '' : cantitate}
              onChange={(e) => setCantitate(e.target.valueAsNumber)}
              aria-label="Bucăți care intră acum"
            />
            <button type="button" onClick={() => setCantitate((n) => (n || 0) + 1)} aria-label="Mai mult">+</button>
          </div>

          {peste > 0 && (
            <p className="atentie">
              {peste} {peste === 1 ? 'bucată' : 'bucăți'} peste cerut. Verifică întâi că eticheta n-a fost deja scanată.
            </p>
          )}

          {sub && (
            <fieldset className="motive">
              <legend>
                {zero ? 'Nu intră nimic.' : `Intră ${cantitate} din ${p.lipsesc}.`} De ce lipsesc{' '}
                {p.lipsesc - cantitate}?
              </legend>
              {motive.map((m) => (
                <label key={m.id} className={motivId === m.id ? 'ales' : ''}>
                  <input
                    type="radio"
                    name="motiv"
                    checked={motivId === m.id}
                    onChange={() => setMotivId(m.id)}
                  />
                  {m.nume}
                </label>
              ))}
              <label className="inchide">
                <input
                  type="checkbox"
                  checked={seInchide}
                  disabled={zero}
                  onChange={(e) => setInchide(e.target.checked)}
                />
                Restul nu mai vine — închide poziția
              </label>
            </fieldset>
          )}

          {(sub || peste > 0) && (
            <label className="observatii">
              <span className="eticheta-camp">Observații{zero ? ' — obligatoriu pe zero' : ''}</span>
              <textarea
                rows={2}
                value={observatii}
                onChange={(e) => setObservatii(e.target.value)}
                placeholder={zero ? 'Ce s-a întâmplat cu poziția?' : 'Opțional'}
              />
            </label>
          )}

          {eroare && <p className="eroare">{eroare}</p>}

          <button className="confirma" disabled={!poateConfirma}>
            {seLucreaza ? 'Se salvează…' : eticheta}
          </button>
        </form>
      )}

      {!formular && eroare && <p className="eroare">{eroare}</p>}

      <button type="button" className="secundar" onClick={onRenunta}>
        {formular ? 'Renunță' : 'Scanează altă etichetă'}
      </button>
    </>
  );
}

function PasGata({
  p,
  cantitate,
  onUrmatoarea,
}: {
  p: PozitieScanata;
  cantitate: number;
  onUrmatoarea: () => void;
}) {
  return (
    <>
      <p className="ok mare">
        {cantitate === 0 ? 'Nimic intrat.' : `Intrat ${cantitate} buc.`}{' '}
        {p.inchisa
          ? 'Poziția s-a închis.'
          : p.peste > 0
            ? `Poziția e completă, cu ${p.peste} peste cerut.`
            : p.lipsesc === 0
              ? 'Poziția e completă.'
              : `Mai lipsesc ${p.lipsesc}.`}
      </p>
      <Antet p={p} />
      <Cifre p={p} />
      <button className="confirma" onClick={onUrmatoarea} autoFocus>
        Scanează următoarea
      </button>
    </>
  );
}
