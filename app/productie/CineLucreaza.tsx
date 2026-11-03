import Link from 'next/link';
import { durata } from '../lib/format';
import type { transeSimple } from '../lib/banda';
import { gataEstimat, type ComandaProd } from '../lib/productieComenzi';
import { dataRo } from '../lib/timp';

/** Fazele obișnuite din atelier, sugerate când modelul n-are încă procesul tehnologic trecut. */
const FAZE_OBISNUITE = ['Cusut', 'Surfilat', 'Tighel', 'Butoniere', 'Nasturi', 'Călcat interfazic', 'Control interfazic', 'Călcat final', 'CTC și ambalat'];

const culoare = (produs: string, model: string) => {
  const m = new Set(model.toLowerCase().split(/[\s,]+/));
  return produs.split(/\s+/).slice(1).filter((w) => !m.has(w.toLowerCase())).join(' ') || produs;
};

/** Comanda deschisă: minute pe bucată, câți oameni (ziua estimată), fazele cu mașina și omul, tranșele în lucru. */
export default function CineLucreaza({ c, m, iese, aici, oameni, masini, orePeZi, zi, transe, timp, aloca, sterge, aIesit }: {
  c: ComandaProd; iese: boolean; aici: string; m: boolean; oameni: { id: string; nume: string; functii: string[] }[]; masini: string[];
  orePeZi: number; zi: string; transe: Awaited<ReturnType<typeof transeSimple>>;
  timp: (d: FormData) => Promise<void>; aloca: (d: FormData) => Promise<void>; sterge: (d: FormData) => Promise<void>; aIesit: (d: FormData) => Promise<void>;
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
        <thead><tr><th>Fază</th><th>Mașină</th><th>Om</th><th /></tr></thead>
        <tbody>
          {c.alocari.map((a) => (
            <tr key={a.id}>
              <td className="ce">{a.faza}</td><td className="ce slab">{a.utilaj ?? '—'}</td><td className="ce">{a.om}</td>
              <td>{m && (
                <form action={sterge}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="numar" value={c.numar} /><input type="hidden" name="inapoi" value={aici} /><input type="hidden" name="inapoi" value={aici} />
                  <button className="secundar" aria-label={`Scoate ${a.om} de la ${a.faza}`}>×</button></form>
              )}</td>
            </tr>
          ))}
          {m && (
            <tr>
              <td colSpan={4}>
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
                  <button className="secundar">+ Adaugă</button>
                </form>
              </td>
            </tr>
          )}
        </tbody>
      </table>

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
