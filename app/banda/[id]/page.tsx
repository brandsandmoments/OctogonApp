import Link from 'next/link';
import { cere, poateModifica } from '../../lib/sesiune';
import { notFound, redirect } from 'next/navigation';
import { detaliiTransa, ETAPE_BANDA, schimbaEtapa, type EtapaBanda } from '../../lib/banda';
import { cantitate } from '../../lib/format';
import { adaugaAlocare, alocari, FUNCTII, marcheaza, operatiiTransa, personal, stergeAlocare, utilaje } from '../../lib/alocare';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

function inapoi(id: string, eroare: string | null): never {
  redirect(eroare ? `/banda/${id}?eroare=${encodeURIComponent(eroare)}` : `/banda/${id}`);
}

/** Fișa tranșei: bucățile, drumul pe bandă bifat etapă cu etapă, timpul de lucru și data estimată. */
export default async function TransaPagina({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string; faza?: string; utilaj?: string }>;
}) {
  await cere('banda');
  // Cine doar vede are formularele, dar cu câmpurile și butoanele dezactivate.
  const m = await poateModifica('banda');
  const [{ id }, { eroare, faza: fazaAleasa, utilaj: utilajAles }] = await Promise.all([params, searchParams]);
  const d = await detaliiTransa(id);
  if (!d) notFound();
  const [faze, aloc, oameni, masini] = await Promise.all([operatiiTransa(id), alocari(id), personal(), utilaje()]);
  const acum = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Bucharest' }).slice(0, 16).replace(' ', 'T');
  const { transa: t, marimi } = d;
  const total = marimi.reduce((s, m) => s + m.cantitate, 0);

  async function aloca(date: FormData) {
    'use server';
    await cere('banda', 'modifica');
    inapoi(id, await adaugaAlocare(id, date));
  }

  async function marcheazaAlocare(date: FormData) {
    'use server';
    await cere('banda', 'modifica');
    const ce = String(date.get('ce'));
    if (ce === 'sterge') { await stergeAlocare(String(date.get('alocare'))); inapoi(id, null); }
    inapoi(id, await marcheaza(String(date.get('alocare')), ce === 'incepe' ? 'incepe' : 'gata'));
  }

  async function etapa(date: FormData) {
    'use server';
    await cere('banda', 'modifica');
    inapoi(id, await schimbaEtapa(id, String(date.get('etapa')) as EtapaBanda, date.get('bifat') === '1'));
  }

  return (
    <main className="formular">
      <p className="slab"><Link href="/banda?vedere=pe_banda">← Bandă</Link></p>
      <h1>{t.cod}</h1>
      <p className="sumar">
        {t.produs} · {t.cod_sku} · P{t.prioritate} · cerut în depozit {t.data_ceruta} · alimentat {t.alimentat_la}
        {t.responsabil && ` · ${t.responsabil}`} · <Link href={`/croit/${t.lot_id}`}>lotul croit</Link>
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      <table className="grila">
        <thead><tr>{marimi.map((m) => <th key={m.marime} className="nr">{m.marime}</th>)}<th className="nr">Total</th></tr></thead>
        <tbody><tr>{marimi.map((m) => <td key={m.marime} className="nr">{m.cantitate}</td>)}<td className="nr"><strong>{total}</strong></td></tr></tbody>
      </table>

      <dl className="cifre-birou">
        <div><dt>Estimat în depozit</dt><dd>{t.eta ?? '—'}</dd></div>
        <div className={t.marja_zile !== null && t.marja_zile < 0 ? 'lipsa' : ''}>
          <dt>Marjă față de termen</dt>
          <dd>{t.marja_zile === null ? '—' : `${t.marja_zile > 0 ? '+' : ''}${t.marja_zile}`} <span>zile</span></dd>
        </div>
        <div><dt>Ore de lucru</dt><dd>{t.ore_om ? cantitate(t.ore_om) : '—'}</dd></div>
        <div><dt>Operatori</dt><dd>{t.persoane ?? '—'} <span>{t.alocati ? 'alocați acum' : t.persoane ? 'de la alimentare' : ''}</span></dd></div>
      </dl>
      {t.responsabil && <p className="slab">Lucrează: {t.responsabil}</p>}
      {!t.eta && <p className="slab">Fără numărul de operatori și minutele pe bucată nu se estimează data în depozit.</p>}
      <p className="slab">Operatorii estimării sunt oamenii alocați mai jos, în „Cine lucrează", care n-au ieșit încă gata
        {t.alocati ? '' : ' — fără nicio alocare, numărul scris la alimentare'}. Data se recalculează la fiecare alocare.</p>

      <h2>Pe bandă</h2>
      <ol className="etape">
        {ETAPE_BANDA.map(([k, nume]) => (
          <li key={k} className={t[k] ? 'bifat' : ''}>
            <form action={etapa}><fieldset disabled={!m} className="fara-chenar">
              <input type="hidden" name="etapa" value={k} />
              <input type="hidden" name="bifat" value={t[k] ? '0' : '1'} />
              <button className="bifa-etapa" aria-pressed={Boolean(t[k])}
                aria-label={`${t[k] ? 'Debifează' : 'Bifează'} ${nume}`}>{t[k] ? '✓' : ''}</button>
            </fieldset></form>
            <span>{nume}</span>
            {t[k] && <span className="slab">{t[k]}</span>}
          </li>
        ))}
      </ol>

      <h2 id="oameni">Cine lucrează</h2>
      {faze.length === 0 ? (
        <p className="slab">Modelul n-are încă procesul tehnologic (fazele). Se adaugă din Modele și rețete; până atunci faza se scrie de mână.</p>
      ) : (
        <table className="faze-alocare">
          <thead><tr><th className="nr">#</th><th>Faza</th><th>Utilaj</th><th className="nr">Min/buc</th><th>Oameni</th><th /></tr></thead>
          <tbody>
            {faze.map((o) => {
              const ai = aloc.filter((a) => a.operatie_id === o.id);
              return (
                <tr key={o.id} className={ai.length ? '' : 'fara-om'}>
                  <td className="nr">{o.ordine}</td>
                  <td>{o.denumire}</td>
                  <td className="slab">{o.utilaj ?? '—'}</td>
                  <td className="nr">{cantitate(o.timp_min)}</td>
                  <td>{ai.length ? ai.map((a) => (
                    <span key={a.id} className={`insigna ${a.gata_la ? 'verde' : a.incepe_la ? 'albastru' : ''}`}>{a.om}{a.gata_la ? ' ✓' : ''}</span>
                  )) : <span className="insigna galben">fără om</span>}</td>
                  <td>{m && <a href={`?faza=${encodeURIComponent(o.denumire)}&utilaj=${encodeURIComponent(o.utilaj ?? '')}#aloca`} className="buton mic-buton">Alocă</a>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <datalist id="lista-oameni">
        {oameni.map((o) => (
          <option key={o.id} value={o.nume} label={`${o.functii.map((f) => FUNCTII[f] ?? f).join(', ')}${o.ocupat ? ` · lucrează la ${o.ocupat}` : ' · liber'}`} />
        ))}
      </datalist>
      <datalist id="lista-utilaje">{masini.map((u) => <option key={u.nume} value={u.nume} />)}</datalist>
      <datalist id="lista-faze">{faze.map((o) => <option key={o.id} value={o.denumire} label={[o.utilaj, `${cantitate(o.timp_min)} min/buc`].filter(Boolean).join(' · ')} />)}</datalist>

      {m && (
        <form action={aloca} id="aloca" className="antet-comanda alocare" key={`${fazaAleasa ?? ''}${utilajAles ?? ''}`}>
          <label className="lat-2"><span>Faza</span><input name="faza" list="lista-faze" defaultValue={fazaAleasa ?? ''} placeholder="scrie sau alege faza" required autoComplete="off" /></label>
          <label><span>Utilaj</span><input name="utilaj" list="lista-utilaje" defaultValue={utilajAles ?? ''} placeholder="mașina sau postul" autoComplete="off" /></label>
          <label><span>Om</span><input name="om" list="lista-oameni" placeholder="scrie numele…" required autoComplete="off" autoFocus={Boolean(fazaAleasa)} /></label>
          <label><span>Începe</span><input name="incepe" type="datetime-local" defaultValue={acum} /></label>
          <label><span>Gata</span><input name="gata" type="datetime-local" /></label>
          <label className="lat"><span>Observații</span><input name="observatii" placeholder="opțional" /></label>
          <div className="lat"><button>Alocă omul</button></div>
        </form>
      )}

      {aloc.length > 0 && (
        <table className="alocari">
          <thead><tr><th>Faza</th><th>Utilaj</th><th>Om</th><th>Început</th><th>Gata</th><th className="nr">Durată</th><th /></tr></thead>
          <tbody>
            {aloc.map((a) => (
              <tr key={a.id}>
                <td>{a.faza}{a.observatii && <div className="slab">{a.observatii}</div>}</td>
                <td className="slab">{a.utilaj ?? '—'}</td>
                <td><strong>{a.om}</strong></td>
                <td>{a.incepe_la ?? '—'}</td>
                <td>{a.gata_la ?? (a.incepe_la ? <span className="insigna albastru">în lucru</span> : '—')}</td>
                <td className="nr">{a.minute != null && a.incepe_la ? `${Math.floor(a.minute / 60)}h ${String(a.minute % 60).padStart(2, '0')}m` : '—'}</td>
                <td>
                  {m && (
                    <form action={marcheazaAlocare} className="in-rand actiuni-alocare">
                      <input type="hidden" name="alocare" value={a.id} />
                      {!a.incepe_la && <button name="ce" value="incepe" className="mic-buton">Începe acum</button>}
                      {!a.gata_la && <button name="ce" value="gata" className="mic-buton">Gata acum</button>}
                      <button name="ce" value="sterge" className="mic-buton slab">Șterge</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
