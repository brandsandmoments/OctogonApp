import Link from 'next/link';
import Tipareste from '../../Tipareste';
import { azi } from '../../lib/format';
import { potriveste } from '../../lib/format';
import { cautaColete, livrariPerioada, type Colet } from '../../lib/livrari';
import { comenziMagazine, magazine } from '../../lib/magazine';
import { cere } from '../../lib/sesiune';
import '../magazine.css';
import '../foaie.css';

export const dynamic = 'force-dynamic';

const STARI: Record<string, string> = { awb: 'AWB generat', in_tranzit: 'în tranzit', in_livrare: 'în livrare', livrat: 'livrat', refuzat: 'refuzat', nelivrat: 'nelivrat' };
const ziua = (zi: string, pas: number) => new Date(Date.parse(zi) + pas * 86_400_000).toISOString().slice(0, 10);
const frumos = (zi: string) => new Date(`${zi}T12:00:00`).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' });
const scurt = (zi: string) => `${zi.slice(8)}.${zi.slice(5, 7)}`;
const ziScurt = (zi: string) => `${new Date(`${zi}T12:00:00`).toLocaleDateString('ro-RO', { weekday: 'short' })} ${scurt(zi)}`;
const data = (s?: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s ?? '') ? s! : null);
const PERIOADE: [number, string][] = [[7, 'ultimele 7 zile'], [14, 'ultimele 14 zile'], [30, 'ultimele 30 de zile']];

/**
 * Ce e în colet. Până la trei produse se văd direct; de la patru, primele două și o
 * listă care se deschide la clic („+5 produse · 9 buc"). Pe foaia tipărită apar toate.
 */
function Produse({ text, bucati }: { text: string; bucati?: number }) {
  const linii = text.split(/(?<=×\d+), /);
  if (linii.length <= 3) return <>{text}{bucati && bucati > 1 ? <span className="mic"> · {bucati} buc</span> : null}</>;
  const rest = linii.slice(2);
  return (
    <>
      <span className="doar-tipar">{text}</span>
      <span className="nu-tipari">
        {linii.slice(0, 2).map((l) => <span key={l} className="produs-linie">{l}</span>)}
        <details className="produse-mai-multe">
          <summary>+{rest.length} produse{bucati ? ` · ${bucati} buc în total` : ''}</summary>
          {rest.map((l, i) => <span key={i} className="produs-linie">{l}</span>)}
        </details>
      </span>
    </>
  );
}

/** Telefonul se poate apăsa: pe telefon și pe tabletă sună direct. */
const Telefon = ({ nr }: { nr: string | null }) => (nr ? <a href={`tel:${nr.replace(/[^\d+]/g, '')}`} className="telefon">{nr}</a> : <>—</>);

function Tabel({ lista, cuMagazin, coloana }: { lista: Colet[]; cuMagazin: boolean; coloana: { nume: string; val: (c: Colet) => React.ReactNode } }) {
  if (lista.length === 0) return <p className="foaie-gol">Niciun colet.</p>;
  return (
    <table className="colete">
      <thead><tr>{cuMagazin && <th>Magazin</th>}<th>Comandă</th><th>Client</th><th>Telefon</th><th>Oraș</th><th>Ce a comandat</th><th>Curier · AWB</th><th>{coloana.nume}</th></tr></thead>
      <tbody>
        {lista.map((c) => (
          <tr key={`${c.magazin_id}${c.comanda}${c.awb}`}>
            {cuMagazin && <td className="mic c-mag">{c.magazin}</td>}
            <td className="c-cmd"><strong>{c.comanda}</strong><div className="mic">{c.comandata}</div></td>
            <td className="c-client">{c.client ?? '—'}<div className="mic doar-mobil">{c.telefon && <><Telefon nr={c.telefon} />{c.oras && ' · '}</>}{c.oras}</div></td>
            <td className="c-tel"><Telefon nr={c.telefon} /></td>
            <td className="mic c-oras">{c.oras ?? '—'}</td>
            <td className="produs c-prod"><Produse text={c.produse} bucati={c.bucati} /></td>
            <td className="mic c-awb">{c.curier ?? '—'}{c.awb && <div>{c.urmarire ? <a href={c.urmarire} target="_blank" rel="noreferrer">{c.awb}</a> : c.awb}</div>}</td>
            <td className="c-val">{coloana.val(c)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Situația coletelor la curier, pe zi sau pe o perioadă (ultimele 7, 14, 30 de zile sau
 * oricare de la–până la) și pe magazin: ce a ridicat curierul, ce s-a
 * livrat, ce a fost refuzat și ce nu s-a livrat (retur), cu numărul comenzii, ce a
 * comandat clientul și telefonul — apoi ce e încă pe drum și AWB-urile neridicate.
 * Un clic pe un număr deschide doar lista aceea. Căutarea găsește orice comandă,
 * din orice zi, cu tot drumul coletului — sau arată că încă n-a plecat. Se tipărește pe A4.
 */
type Cheie = 'ridicate' | 'livrate' | 'refuzate' | 'nelivrate' | 'pe_drum' | 'neridicate';

export default async function Livrari({ searchParams }: { searchParams: Promise<{ magazin?: string; zi?: string; de?: string; pana?: string; lista?: string; cauta?: string }> }) {
  await cere('expediere');
  const f = await searchParams;
  // O zi (zi=) sau o perioadă (de= și pana=), niciodată după azi.
  const azia = azi();
  let [de, pana] = data(f.de) && data(f.pana) ? [f.de!, f.pana!] : [data(f.zi) ?? azia, data(f.zi) ?? azia];
  if (de > pana) [de, pana] = [pana, de];
  if (pana > azia) pana = azia;
  if (de > azia) de = azia;
  const zi = pana;
  const perioada = de !== pana;
  const presetare = perioada && pana === azia ? PERIOADE.find(([n]) => ziua(azia, 1 - n) === de) : undefined;
  const eticheta = perioada ? `${presetare ? `${presetare[1]} · ` : ''}${scurt(de)} – ${scurt(pana)}` : frumos(zi);
  const lista = await magazine();
  const ales = lista.find((m) => m.id === f.magazin) ?? null;
  const cauta = f.cauta?.trim() ?? '';
  const [z, gasite, deschise] = await Promise.all([
    livrariPerioada(de, pana, ales?.id),
    cauta ? cautaColete(cauta, ales?.id) : Promise.resolve([]),
    cauta ? comenziMagazine() : Promise.resolve([]),
  ]);
  // Comenzile încă neexpediate care se potrivesc: să se vadă și „n-a plecat încă".
  const neexpediate = deschise.filter((c) => (!ales || c.magazin_id === ales.id)
    && potriveste(cauta, c.nume, c.client, c.telefon?.replace(/\D/g, ''), ...c.linii.map((l) => l.produs))
    && !gasite.some((g) => g.comanda === c.nume && g.magazin_id === c.magazin_id));
  const cuMagazin = !ales;
  const adresa = (o: { magazin?: string | null; zi?: string; de?: string; lista?: Cheie | null }) => {
    const q = new URLSearchParams();
    const m = o.magazin === undefined ? ales?.id : o.magazin;
    if (m) q.set('magazin', m);
    // zi= alege o singură zi; de= (până azi) o perioadă; fără ele rămâne ce e ales.
    const [d1, d2] = o.zi ? [o.zi, o.zi] : o.de ? [o.de, azia] : [de, pana];
    if (d1 !== d2) { q.set('de', d1); q.set('pana', d2); } else if (d1 !== azia) q.set('zi', d1);
    const l = o.lista === undefined ? f.lista : o.lista;
    if (l) q.set('lista', l);
    return `/magazine/livrari${q.size ? `?${q}` : ''}`;
  };
  const buc = (l: Colet[]) => l.reduce((s, c) => s + c.bucati, 0);
  const generat = new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Listele zilei. „Încă pe drum" și „AWB neridicate" sunt situația de acum, nu a zilei alese.
  const LISTE: { cheie: Cheie; titlu: string; ton: string; acum?: boolean; nota?: string; coloana: { nume: string; val: (c: Colet) => React.ReactNode } }[] = [
    { cheie: 'ridicate', titlu: 'Ridicate de curier', ton: '', coloana: { nume: 'Ridicat', val: (c) => <span className="mic">{c.ora}{c.stare !== 'in_tranzit' && ` · acum ${STARI[c.stare]}`}</span> } },
    { cheie: 'livrate', titlu: 'Livrate', ton: 'ton-verde', coloana: { nume: 'Livrat', val: (c) => <span className="mic">{c.ora}{c.zile !== null && ` · în ${c.zile} ${c.zile === 1 ? 'zi' : 'zile'}`}</span> } },
    { cheie: 'refuzate', titlu: 'Refuzate', ton: 'ton-rosu', coloana: { nume: 'Motiv', val: (c) => <span className="rosu-tare">{c.motiv ?? 'refuzat'} · {c.ora}</span> } },
    { cheie: 'nelivrate', titlu: 'Nelivrate (retur)', ton: 'ton-galben', coloana: { nume: 'Motiv', val: (c) => <span className="rosu-tare">{c.motiv ?? 'nelivrat'} · {c.ora}</span> } },
    { cheie: 'pe_drum', titlu: 'Încă pe drum', ton: '', acum: true, nota: 'Ridicate de curier, încă nelivrate. Cele de 4 zile sau mai mult, de urmărit la curier.',
      coloana: { nume: 'La curier', val: (c) => <span className={(c.zile ?? 0) >= 4 ? 'rosu-tare' : 'mic'}>{STARI[c.stare]} · de {c.zile} {c.zile === 1 ? 'zi' : 'zile'}</span> } },
    { cheie: 'neridicate', titlu: 'AWB generat, neridicat de curier', ton: z.neridicate.some((c) => (c.zile ?? 0) >= 1) ? 'ton-rosu' : '', acum: true,
      nota: 'Etichetă făcută, dar curierul n-a scanat coletul. Mai vechi de o zi: verifică dacă a plecat din depozit.',
      coloana: { nume: 'AWB din', val: (c) => <span className={(c.zile ?? 0) >= 1 ? 'rosu-tare' : 'mic'}>{c.awb_la}</span> } },
  ];
  const aleasa = LISTE.find((l) => l.cheie === f.lista) ?? null;
  // Fără o listă aleasă: toată foaia zilei (situația de acum doar pe ziua de azi).
  // Pe o perioadă, foaia întreagă arată rezumatul și listele cu probleme; ridicatele și livratele
  // (mii de rânduri pe o lună) se deschid din numerele lor.
  const lungi: Cheie[] = ['ridicate', 'livrate'];
  const deAratat = aleasa ? [aleasa] : LISTE.filter((l) => (!l.acum || zi === azia) && !(perioada && lungi.includes(l.cheie)));
  // Pe o perioadă: câte pe fiecare zi și, pe „Toate", pe fiecare magazin.
  const EVENIMENTE = ['ridicate', 'livrate', 'refuzate', 'nelivrate'] as const;
  const zile = perioada ? Array.from({ length: Math.round((Date.parse(pana) - Date.parse(de)) / 86_400_000) + 1 }, (_, i) => ziua(pana, -i)) : [];
  const numara = (filtru: (c: Colet) => boolean) => Object.fromEntries(EVENIMENTE.map((e) => [e, z[e].filter(filtru).length])) as Record<typeof EVENIMENTE[number], number>;
  const refuz = (n: Record<typeof EVENIMENTE[number], number>) => {
    const inchise = n.livrate + n.refuzate + n.nelivrate;
    return inchise ? `${Math.round(((n.refuzate + n.nelivrate) / inchise) * 100)}%` : '—';
  };

  return (
    <main className="lat">
      <h1 className="nu-tipari">Livrări la curier</h1>
      <nav className="file">
        <Link href={adresa({ magazin: null })} className={!ales ? 'activ' : ''}>Toate</Link>
        {lista.map((m) => <Link key={m.id} href={adresa({ magazin: m.id })} className={m.id === ales?.id ? 'activ' : ''}>{m.brand}</Link>)}
      </nav>

      <form method="get" className="filtre cauta-colet nu-tipari" key={`c${cauta}`}>
        {ales && <input type="hidden" name="magazin" value={ales.id} />}
        <input name="cauta" defaultValue={cauta} placeholder="caută orice comandă: nume, număr comandă, AWB, telefon, produs" aria-label="Caută colet" />
        <button className="buton">Caută</button>
        {cauta && <Link href={adresa({})} className="buton">× închide căutarea</Link>}
      </form>

      {cauta ? (
        <article className="foaie">
          <header className="foaie-antet">
            <h1>Căutare · „{cauta}"</h1>
            <p className="foaie-sub">{ales ? ales.brand : 'toate magazinele'} · {gasite.length} colete{neexpediate.length ? ` · ${neexpediate.length} comenzi încă neexpediate` : ''}</p>
          </header>
          {gasite.length === 0 && neexpediate.length === 0 && <p className="foaie-gol">Nimic găsit. Caută după numărul comenzii (#25448), nume, telefon sau AWB.</p>}
          {gasite.length > 0 && (
            <table className="colete cautare-colete">
              <thead><tr>{cuMagazin && <th>Magazin</th>}<th>Comandă</th><th>Client · telefon</th><th>Ce a comandat</th><th>Curier · AWB</th><th>Stadiu</th><th>Drumul coletului</th></tr></thead>
              <tbody>
                {gasite.map((c) => (
                  <tr key={`${c.magazin_id}${c.comanda}${c.awb}${c.awb_la}`}>
                    {cuMagazin && <td className="mic c-mag">{c.magazin}</td>}
                    <td className="c-cmd"><strong>{c.comanda}</strong><div className="mic">comandată {c.comandata}</div></td>
                    <td className="c-client">{c.client ?? '—'}<div className="mic">{c.telefon && <><Telefon nr={c.telefon} />{c.oras && ' · '}</>}{c.oras}</div></td>
                    <td className="produs c-prod"><Produse text={c.produse} bucati={c.bucati} /></td>
                    <td className="mic c-awb">{c.curier ?? '—'}{c.awb && <div>{c.urmarire ? <a href={c.urmarire} target="_blank" rel="noreferrer">{c.awb}</a> : c.awb}</div>}</td>
                    <td className="c-val"><span className={`insigna ${({ livrat: 'verde', refuzat: 'rosu', nelivrat: 'rosu', anulat: 'gri', awb: 'galben' } as Record<string, string>)[c.stare] ?? 'albastru'}`}>{STARI[c.stare] ?? c.stare}</span></td>
                    <td className="mic drum c-drum">
                      <div>AWB {c.awb_la}</div>
                      {c.ridicat_la && <div>ridicat {c.ridicat_la}</div>}
                      {c.in_livrare_la && <div>în livrare {c.in_livrare_la}</div>}
                      {c.livrat_la && c.stare === 'livrat' && <div className="verde-tare">livrat {c.livrat_la}</div>}
                      {c.esuat_la && <div className="rosu-tare">{c.motiv ?? 'eșuat'} · {c.esuat_la}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {neexpediate.length > 0 && (
            <section className="foaie-grupa">
              <h2>Încă neexpediate</h2>
              <table className="colete">
                <thead><tr>{cuMagazin && <th>Magazin</th>}<th>Comandă</th><th>Client · telefon</th><th>Ce a comandat</th><th>Situație</th></tr></thead>
                <tbody>
                  {neexpediate.map((c) => (
                    <tr key={c.id}>
                      {cuMagazin && <td className="mic c-mag">{c.magazin}</td>}
                      <td className="c-cmd"><strong>{c.nume}</strong><div className="mic">comandată {c.creata_la.slice(8)}.{c.creata_la.slice(5, 7)}</div></td>
                      <td className="c-client">{c.client ?? '—'}<div className="mic">{c.telefon && <><Telefon nr={c.telefon} />{c.oras && ' · '}</>}{c.oras}</div></td>
                      <td className="produs c-prod"><Produse text={c.linii.map((l) => `${l.produs} ${l.marime} ×${l.bucati}`).join(', ')} bucati={c.bucati} /></td>
                      <td className="c-val"><span className={`insigna ${{ livrabila: 'verde', de_sunat: 'galben', fara_stoc: 'rosu' }[c.situatie]}`}>
                        {{ livrabila: 'de trimis, pe stoc', de_sunat: 'de sunat: avem o parte', fara_stoc: 'fără stoc' }[c.situatie]}</span>
                        <div className="mic">așteaptă de {c.zile} {c.zile === 1 ? 'zi' : 'zile'}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </article>
      ) : (
      <>
      {/* Pe telefon: ziua și perioada într-o singură listă care se deschide. */}
      <details className="alege-perioada nu-tipari">
        <summary><span className="slab">Perioadă:</span> <strong>{perioada ? eticheta : zi === azia ? 'azi' : frumos(zi)}</strong></summary>
        <div className="alege-perioada-corp">
          <div className="filtre">
            <Link href={adresa({ zi: azia })} className={`buton ${!perioada && zi === azia ? 'activ-buton' : ''}`}>azi</Link>
            <Link href={adresa({ zi: ziua(azia, -1) })} className={`buton ${!perioada && zi === ziua(azia, -1) ? 'activ-buton' : ''}`}>ieri</Link>
            {PERIOADE.map(([n, nume]) => (
              <Link key={n} href={adresa({ de: ziua(azia, 1 - n) })} className={`buton ${presetare?.[0] === n ? 'activ-buton' : ''}`}>{nume}</Link>
            ))}
          </div>
          <form method="get" className="perioada-proprie" key={`p${de}${pana}`}>
            {ales && <input type="hidden" name="magazin" value={ales.id} />}
            {f.lista && <input type="hidden" name="lista" value={f.lista} />}
            <label>de la <input type="date" name="de" defaultValue={perioada ? de : ziua(azia, -6)} max={azia} /></label>
            <label>până la <input type="date" name="pana" defaultValue={pana} max={azia} /></label>
            <button className="buton">Arată perioada</button>
          </form>
          {!perioada && (
            <div className="filtre">
              <Link href={adresa({ zi: ziua(zi, -1) })} className="buton">← ziua dinainte</Link>
              {zi < azia && <Link href={adresa({ zi: ziua(zi, 1) })} className="buton">ziua următoare →</Link>}
            </div>
          )}
        </div>
      </details>

      <div className="liste-actiuni perioade nu-tipari">
        <span className="filtre">
          {!perioada && <Link href={adresa({ zi: ziua(zi, -1) })} className="buton">← ziua dinainte</Link>}
          <Link href={adresa({ zi: azia })} className={`buton ${!perioada && zi === azia ? 'activ-buton' : ''}`}>azi</Link>
          {!perioada && zi < azia && <Link href={adresa({ zi: ziua(zi, 1) })} className="buton">ziua următoare →</Link>}
          <form method="get" className="in-rand" key={`z${zi}${perioada}`}>
            {ales && <input type="hidden" name="magazin" value={ales.id} />}
            {f.lista && <input type="hidden" name="lista" value={f.lista} />}
            <input type="date" name="zi" defaultValue={zi} max={azia} aria-label="Ziua" />
            <button className="buton">Arată ziua</button>
          </form>
        </span>
        <Tipareste />
      </div>
      <div className="liste-actiuni perioade nu-tipari">
        <span className="filtre">
          <span className="slab">Perioadă:</span>
          {PERIOADE.map(([n, nume]) => (
            <Link key={n} href={adresa({ de: ziua(azia, 1 - n) })} className={`buton ${presetare?.[0] === n ? 'activ-buton' : ''}`}>{nume}</Link>
          ))}
          <form method="get" className="in-rand" key={`p${de}${pana}`}>
            {ales && <input type="hidden" name="magazin" value={ales.id} />}
            {f.lista && <input type="hidden" name="lista" value={f.lista} />}
            <span className="slab">de la</span>
            <input type="date" name="de" defaultValue={perioada ? de : ziua(azia, -6)} max={azia} aria-label="De la" />
            <span className="slab">până la</span>
            <input type="date" name="pana" defaultValue={pana} max={azia} aria-label="Până la" />
            <button className={`buton ${perioada && !presetare ? 'activ-buton' : ''}`}>Arată perioada</button>
          </form>
        </span>
      </div>

      <div className="numere-magazin nu-tipari">
        <Link href={adresa({ lista: null })} className={`numar-situatie ${!aleasa ? 'activ-numar' : ''}`}><strong>Toate</strong> {perioada ? 'foaia perioadei' : 'foaia zilei'}</Link>
        {LISTE.map((l) => (
          <Link key={l.cheie} href={adresa({ lista: l.cheie })} className={`numar-situatie ${l.ton} ${aleasa?.cheie === l.cheie ? 'activ-numar' : ''}`}>
            <strong>{z[l.cheie].length}</strong> {l.titlu.toLowerCase().replace('awb generat, neridicat de curier', 'AWB neridicate')}
            {(l.cheie === 'ridicate' || l.cheie === 'livrate') && <span className="slab"> · {buc(z[l.cheie])} buc</span>}
          </Link>
        ))}
      </div>

      <article className="foaie">
        <header className="foaie-antet">
          <h1>{aleasa ? `${aleasa.titlu} · ${aleasa.acum ? 'acum' : eticheta}` : `Livrări · ${eticheta}`}</h1>
          <p className="foaie-sub">{ales ? ales.brand : 'toate magazinele'} · coletele la curier, din evenimentele trimise de curier în Shopify</p>
          <p className="foaie-mic">Generat {generat}</p>
          <p className="foaie-rezumat">
            {aleasa ? `${z[aleasa.cheie].length} colete · ${buc(z[aleasa.cheie])} buc`
              : `${z.ridicate.length} ridicate de curier · ${z.livrate.length} livrate · ${z.refuzate.length} refuzate · ${z.nelivrate.length} nelivrate (retur)`
                + (zi === azia ? ` · ${z.pe_drum.length} încă pe drum · ${z.neridicate.length} AWB neridicate` : '')}
          </p>
        </header>
        {perioada && !aleasa && (
          <section className="foaie-grupa">
            <h2>Pe scurt</h2>
            <p className="foaie-mic">Refuz + retur: din coletele care au ajuns la capăt în perioadă (livrate, refuzate, nelivrate), cât nu s-a livrat.</p>
            <table className="pe-scurt">
              <thead><tr><th>{cuMagazin ? 'Magazin / zi' : 'Zi'}</th><th className="c">Rid<span className="ascuns-mobil">icate</span></th><th className="c">Liv<span className="ascuns-mobil">rate</span></th><th className="c">Ref<span className="ascuns-mobil">uzate</span></th><th className="c">Nel<span className="ascuns-mobil">ivrate</span></th><th className="c">Refuz<span className="ascuns-mobil"> + retur</span></th></tr></thead>
              <tbody>
                {[
                  ...(cuMagazin ? lista.map((m) => ({ k: m.id, nume: m.brand, n: numara((c) => c.magazin_id === m.id), tare: false, href: adresa({ magazin: m.id }) })) : []),
                  { k: 'total', nume: cuMagazin ? 'Toate magazinele' : 'Total', n: numara(() => true), tare: true, href: null },
                  ...zile.map((d) => ({ k: d, nume: <><span className="ascuns-mobil">{frumos(d)}</span><span className="doar-mobil-text">{ziScurt(d)}</span></>, n: numara((c) => c.zi === d), tare: false, href: adresa({ zi: d }) })),
                ].map((r) => (
                  <tr key={r.k} className={r.tare ? 'grupa-model' : ''}>
                    <td>{r.href ? <Link href={r.href}>{r.nume}</Link> : <strong>{r.nume}</strong>}</td>
                    {EVENIMENTE.map((e) => <td key={e} className="c">{r.tare ? <strong>{r.n[e]}</strong> : r.n[e] || <span className="mic">0</span>}</td>)}
                    <td className="c">{refuz(r.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {perioada && !aleasa && (
          <p className="foaie-mic nu-tipari">Ridicatele ({z.ridicate.length}) și livratele ({z.livrate.length}) din perioadă se deschid din numerele de sus.</p>
        )}
        {deAratat.map((l, i) => (
          <section key={l.cheie} className="foaie-grupa">
            <h2>{aleasa ? '' : `${i + 1}. `}{l.titlu} · {z[l.cheie].length}</h2>
            {l.nota && <p className="foaie-mic">{l.nota}</p>}
            <Tabel lista={z[l.cheie]} cuMagazin={cuMagazin} coloana={l.coloana} />
          </section>
        ))}
      </article>
      </>
      )}
    </main>
  );
}
