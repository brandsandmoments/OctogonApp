import Link from 'next/link';
import { durata } from '../lib/format';
import type { transeSimple } from '../lib/banda';
import { gataEstimat, type ComandaProd } from '../lib/productieComenzi';
import { dataRo } from '../lib/timp';
import { DIFICULTATI } from '../lib/dificultate';

/** Fazele obișnuite din atelier, sugerate când modelul n-are încă procesul tehnologic trecut. */
const FAZE_OBISNUITE = ['Cusut', 'Surfilat', 'Tighel', 'Butoniere', 'Nasturi', 'Călcat interfazic', 'Control interfazic', 'Călcat final', 'CTC și ambalat'];

/** Posturile fără mașină, cu oamenii lor sub fazele de cusut: întâi cine calcă, apoi cine controlează. */
const POSTURI: [faza: string, titlu: string, functii: string[]][] = [
  ['Călcat', 'Cine calcă', ['calcator_interfazic', 'calcator_final']],
  ['Control', 'Cine controlează', ['control_interfazic', 'ctc_ambalat']],
];

const culoare = (produs: string, model: string) => {
  const m = new Set(model.toLowerCase().split(/[\s,]+/));
  return produs.split(/\s+/).slice(1).filter((w) => !m.has(w.toLowerCase())).join(' ') || produs;
};

/** Comanda deschisă: minute pe bucată, câți oameni (ziua estimată), fazele cu mașina și omul, tranșele în lucru. */
export default function CineLucreaza({ c, m, iese, aici, oameni, masini, orePeZi, zi, transe, timp, aloca, sterge, aIesit, dificultate }: {
  c: ComandaProd; iese: boolean; aici: string; m: boolean; oameni: { id: string; nume: string; functii: string[] }[]; masini: string[];
  orePeZi: number; zi: string; transe: Awaited<ReturnType<typeof transeSimple>>;
  timp: (d: FormData) => Promise<void>; aloca: (d: FormData) => Promise<void>; sterge: (d: FormData) => Promise<void>; aIesit: (d: FormData) => Promise<void>;
  dificultate: (d: FormData) => Promise<void>;
}) {
  const estimat = gataEstimat(c, orePeZi, zi);
  const faze = [...new Set([...c.faze_model, ...FAZE_OBISNUITE])];
  const dinBanda = oameni.filter((o) => !o.functii.some((f) => ['taietor', 'croit_auxiliar', 'sef_croit'].includes(f)));
  const altii = oameni.filter((o) => !dinBanda.includes(o));
  return (
    <section className="cine-lucreaza">
      <h4>Cine lucrează</h4>
      <form action={timp} className="in-rand">
        <input type="hidden" name="comanda" value={c.comanda_id} />
        <input type="hidden" name="numar" value={c.numar} /><input type="hidden" name="inapoi" value={aici} />
        <label><span className="slab">Minute pe bucată</span>
          <input name="minute" inputMode="decimal" className="bucati" defaultValue={c.timp_min_buc ?? ''} placeholder="ex. 38" disabled={!m} /></label>
        <label><span className="slab">Câți oameni</span>
          <input name="oameni" inputMode="numeric" className="bucati" defaultValue={c.oameni ?? ''} placeholder="ex. 6" disabled={!m} /></label>
        {m && <button className="secundar">Salvează</button>}
        <span className="slab">
          {estimat ? <>Estimat gata: <strong>{dataRo(estimat)}</strong> · {c.culori.reduce((s, l) => s + l.cerut, 0) - c.gata} buc rămase</>
            : 'Scrie minutele pe bucată și câți oameni, ca să vezi ziua estimată de gata.'}
        </span>
      </form>

      <table className="marimi-comanda alocari-comanda">
        <thead><tr><th>Fază</th><th>Mașină</th><th>Om</th><th>Dificultate</th><th /></tr></thead>
        <tbody>
          {c.alocari.filter((a) => !POSTURI.some(([f]) => f === a.faza)).map((a) => (
            <tr key={a.id}>
              <td className="ce">{a.faza}</td><td className="ce slab">{a.utilaj ?? '—'}</td><td className="ce">{a.om}</td>
              <td className="ce"><Dificultate a={a} c={c} m={m} aici={aici} actiune={dificultate} /></td>
              <td>{m && (
                <form action={sterge}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="numar" value={c.numar} /><input type="hidden" name="inapoi" value={aici} />
                  <button className="secundar" aria-label={`Scoate ${a.om} de la ${a.faza}`}>×</button></form>
              )}</td>
            </tr>
          ))}
          {m && (
            <tr>
              <td colSpan={5}>
                <form action={aloca} className="in-rand">
                  <input type="hidden" name="comanda" value={c.comanda_id} />
                  <input type="hidden" name="numar" value={c.numar} /><input type="hidden" name="inapoi" value={aici} />
                  <input name="faza" list={`faze-${c.comanda_id}`} placeholder="faza" required aria-label="Faza" />
                  <datalist id={`faze-${c.comanda_id}`}>{faze.map((f) => <option key={f} value={f} />)}</datalist>
                  <select name="utilaj" defaultValue="" aria-label="Mașina">
                    <option value="">mașina</option>
                    {masini.map((x) => <option key={x}>{x}</option>)}
                  </select>
                  <select name="om" defaultValue="" required aria-label="Omul">
                    <option value="">cine?</option>
                    <optgroup label="Producție">{dinBanda.map((o) => <option key={o.id} value={o.id}>{o.nume}</option>)}</optgroup>
                    <optgroup label="Croit">{altii.map((o) => <option key={o.id} value={o.id}>{o.nume}</option>)}</optgroup>
                  </select>
                  <AlegereDificultate />
                  <button className="secundar">+ Adaugă</button>
                </form>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {POSTURI.map(([faza, titlu, functii]) => (
        <Post key={faza} c={c} m={m} aici={aici} faza={faza} titlu={titlu} oameni={oameni} functii={functii} aloca={aloca} sterge={sterge} dificultate={dificultate} />
      ))}

      {transe.length > 0 && (
        <>
          <h4>În lucru acum</h4>
          <table className="marimi-comanda">
            <tbody>
              {transe.map((t) => (
                <tr key={t.id}>
                  <td className="ce"><Link href={`/banda/${t.id}`}>{culoare(t.produs, t.model)}</Link></td>
                  <td className="ce slab">{t.marimi}</td>
                  <td>{t.bucati} buc</td>
                  <td className="ce slab">din {t.intrat_ora} · {durata(t.minute)}</td>
                  <td>{iese && (
                    <form action={aIesit}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="numar" value={c.numar} /><input type="hidden" name="inapoi" value={aici} /><input type="hidden" name="inapoi" value={aici} />
                      <button className="secundar">A ieșit gata</button></form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {iese && transe.length > 1 && (
            <form action={aIesit}>
              {transe.map((t) => <input key={t.id} type="hidden" name="id" value={t.id} />)}
              <input type="hidden" name="numar" value={c.numar} /><input type="hidden" name="inapoi" value={aici} />
              <button className="secundar">Toate au ieșit gata</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Un post fără mașină (călcat, control): cine e pus pe el la comanda asta, cu „×", și „+ Adaugă".
 * În listă, întâi oamenii cu funcția postului (din Oameni producție), apoi ceilalți.
 */
function Post({ c, m, aici, faza, titlu, oameni, functii, aloca, sterge, dificultate }: {
  c: ComandaProd; m: boolean; aici: string; faza: string; titlu: string; oameni: { id: string; nume: string; functii: string[] }[];
  functii: string[]; aloca: (d: FormData) => Promise<void>; sterge: (d: FormData) => Promise<void>; dificultate: (d: FormData) => Promise<void>;
}) {
  const pusi = c.alocari.filter((a) => a.faza === faza);
  const potriviti = oameni.filter((o) => o.functii.some((f) => functii.includes(f)));
  const ceilalti = oameni.filter((o) => !potriviti.includes(o));
  return (
    <div className="post-lucru">
      <h4>{titlu}</h4>
      <div className="in-rand">
        {pusi.length === 0 && <span className="slab">nimeni încă</span>}
        {pusi.map((a) => (
          <span key={a.id} className="om-pus">
            {a.om}
            <Dificultate a={a} c={c} m={m} aici={aici} actiune={dificultate} mic />
            {m && (
              <form action={sterge}>
                <input type="hidden" name="id" value={a.id} /><input type="hidden" name="numar" value={c.numar} /><input type="hidden" name="inapoi" value={aici} />
                <button className="secundar" aria-label={`Scoate ${a.om} de la ${faza.toLowerCase()}`}>×</button>
              </form>
            )}
          </span>
        ))}
        {m && (
          <form action={aloca} className="in-rand">
            <input type="hidden" name="comanda" value={c.comanda_id} />
            <input type="hidden" name="numar" value={c.numar} /><input type="hidden" name="inapoi" value={aici} />
            <input type="hidden" name="faza" value={faza} />
            <select name="om" defaultValue="" required aria-label={titlu}>
              <option value="">cine?</option>
              {potriviti.length > 0 && <optgroup label={titlu.replace('Cine ', 'Cei care ')}>{potriviti.map((o) => <option key={o.id} value={o.id}>{o.nume}</option>)}</optgroup>}
              <optgroup label="Alți oameni din producție">{ceilalti.map((o) => <option key={o.id} value={o.id}>{o.nume}</option>)}</optgroup>
            </select>
            <AlegereDificultate />
            <button className="secundar">+ Adaugă</button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Gradul de dificultate la adăugarea unui om pe fază (pornește de la mediu). */
function AlegereDificultate() {
  return (
    <select name="dificultate" defaultValue="2" aria-label="Gradul de dificultate">
      {([1, 2, 3] as const).map((d) => <option key={d} value={d}>{DIFICULTATI[d].nume}</option>)}
    </select>
  );
}

/** Dificultatea omului pe fază: insigna, iar cine poate modifica o schimbă pe loc. */
function Dificultate({ a, c, m, aici, actiune, mic = false }: {
  a: ComandaProd['alocari'][number]; c: ComandaProd; m: boolean; aici: string; actiune: (d: FormData) => Promise<void>; mic?: boolean;
}) {
  const d = DIFICULTATI[a.dificultate];
  if (!m) return <span className={`insigna ${d.ton}`}>{d.nume}</span>;
  return (
    <form action={actiune} className={`in-rand dificultate-om ${mic ? 'mic' : ''}`}>
      <input type="hidden" name="id" value={a.id} /><input type="hidden" name="numar" value={c.numar} /><input type="hidden" name="inapoi" value={aici} />
      <select name="dificultate" defaultValue={String(a.dificultate)} aria-label={`Dificultatea pentru ${a.om} la ${a.faza}`} className={`ton-${d.ton}`}>
        {([1, 2, 3] as const).map((x) => <option key={x} value={x}>{DIFICULTATI[x].nume}</option>)}
      </select>
      <button className="secundar" aria-label="Salvează dificultatea">✓</button>
    </form>
  );
}
