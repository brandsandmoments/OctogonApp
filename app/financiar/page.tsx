import Link from 'next/link';
import { redirect } from 'next/navigation';
import Cauta from '../Cauta';
import Tipareste from '../Tipareste';
import { esteAdmin } from '../lib/acces';
import { azi, potriveste } from '../lib/format';
import { card, colete, LIMITA, rezumat, surse, viramente, viramenteCard, type Colet, type Filtru, type Vedere } from '../lib/financiar';
import { banca, importaExtras } from '../lib/extras';
import { magazine } from '../lib/magazine';
import { cere, poateModifica } from '../lib/sesiune';
import '../magazine/magazine.css';
import '../magazine/foaie.css';
import './financiar.css';

export const dynamic = 'force-dynamic';

type Fila = 'rezumat' | Vedere | 'incasat' | 'banca';
const FILE: [Fila, string][] = [
  ['rezumat', 'Pe scurt'], ['nefacturate', 'Livrate fără factură'], ['de_stornat', 'De stornat'],
  ['neincasat', 'Ramburs neîncasat'], ['incasat', 'Încasat'], ['retururi', 'Retururi și schimburi primite'], ['expediate', 'Toate coletele trimise'], ['banca', 'Bancă'],
];
const DESPRE: Record<Fila, string> = {
  rezumat: 'pe fiecare brand: câte colete au plecat, câte au factură, ce e de stornat și ce bani nu au venit încă',
  nefacturate: 'colete livrate fără factură (nici validă, nici stornată): comenzi nefacturate și colete făcute direct în selfAWB / MyGLS, de obicei schimburi sau retrimiteri',
  de_stornat: 'refuzate sau returnate, cu factură care n-a fost stornată',
  neincasat: 'livrate cu ramburs, pentru care curierul n-a virat încă banii — cele mai vechi sus. GLS nu raportează viramentele prin API.',
  incasat: 'banii intrați: rambursurile virate de Fan Courier și plățile cu cardul din Shopify Payments, cu viramentele lor',
  expediate: 'toate coletele trimise clienților în perioadă, de la curier, cu comanda și factura lor',
  retururi: 'coletele venite de la clienți (retururi, schimburi), ridicate de curier: comanda lor și dacă factura e încă nestornată',
  banca: 'extrasele de cont: banii veniți de la Fan Courier și Shopify Payments, potriviți cu loturile de ramburs și viramentele card',
};
const NUME_SURSA: Record<string, string> = { fan: 'Fan Courier (ramburs)', shopify: 'Shopify Payments (card, prin Stripe)', gls: 'GLS' };
const STARI: Record<string, [string, string]> = {
  creat: ['AWB, neridicat', 'galben'], in_tranzit: ['pe drum', 'albastru'], livrat: ['livrat', 'verde'],
  refuzat: ['refuzat', 'rosu'], returnat: ['returnat', 'rosu'],
};
const PERIOADE: [number, string][] = [[7, '7 zile'], [14, '14 zile'], [30, '30 de zile'], [60, '60 de zile']];
const ziua = (z: string, pas: number) => new Date(Date.parse(`${z}T12:00:00Z`) + pas * 86_400_000).toISOString().slice(0, 10);
const scurt = (z: string | null) => (z ? `${z.slice(8, 10)}.${z.slice(5, 7)}` : '—');
const data = (s?: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s ?? '') ? s! : null);
const lei = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lei`);
const SURSE: Record<string, string> = { gls: 'GLS (MyGLS)' };
const numeSursa = (s: string, fan: Map<string, string>) =>
  s.startsWith('card:') ? `Shopify Payments · ${s.slice(5).replace('_', ' ').toLowerCase()}` : s.startsWith('xc:') ? `xConnector · ${s.slice(3).replace('_', ' ').toLowerCase()}` : s.startsWith('fan:') ? `Fan · ${fan.get(s.slice(4)) ?? s.slice(4)}` : SURSE[s] ?? s;

const STARE_VIRAMENT: Record<string, string> = { PAID: 'în cont', IN_TRANSIT: 'pe drum spre bancă', SCHEDULED: 'programat', FAILED: 'eșuat', CANCELED: 'anulat' };

function TabelCard({ carduri, tot }: { carduri: Awaited<ReturnType<typeof card>>; tot: { brut: number; rambursari: number; comision: number; net: number; plati: number } }) {
  if (carduri.length === 0) return <p className="foaie-gol">Nicio plată cu cardul în perioadă (sau Shopify Payments nu e încă legat).</p>;
  return (
    <table>
      <thead><tr><th>Brand</th><th className="c">Plăți</th><th className="c">Încasat brut</th><th className="c">Rambursări</th><th className="c">Comision Shopify</th><th className="c">Net</th></tr></thead>
      <tbody>
        {carduri.map((x) => (
          <tr key={x.magazin ?? '-'}>
            <td><strong>{x.magazin}</strong></td>
            <td className="c">{x.plati}</td>
            <td className="c">{lei(x.brut)}</td>
            <td className="c">{lei(x.rambursari)}</td>
            <td className="c">{lei(x.comision)}</td>
            <td className="c"><strong>{lei(x.net)}</strong></td>
          </tr>
        ))}
        {carduri.length > 1 && (
          <tr className="grupa-model"><td><strong>Total</strong></td><td className="c"><strong>{tot.plati}</strong></td><td className="c"><strong>{lei(tot.brut)}</strong></td>
            <td className="c"><strong>{lei(tot.rambursari)}</strong></td><td className="c"><strong>{lei(tot.comision)}</strong></td><td className="c"><strong>{lei(tot.net)}</strong></td></tr>
        )}
      </tbody>
    </table>
  );
}

/**
 * Financiar: coletele trimise prin Fan Courier și GLS, așa cum le știu curierii (și
 * cele făcute direct în selfAWB / MyGLS), cu comanda și factura lor din xConnector,
 * și banii: ramburs neîncasat, ramburs virat, plăți cu cardul (Shopify Payments). Doar citire — facturarea și stornarea
 * vin în etapa următoare.
 */
export default async function Financiar({ searchParams }: {
  searchParams: Promise<{ fila?: string; magazin?: string; curier?: string; de?: string; pana?: string; cauta?: string; ok?: string; eroare?: string }>;
}) {
  const u = await cere('financiar');
  const f = await searchParams;
  const azia = azi();
  const fila = (FILE.find(([k]) => k === f.fila)?.[0] ?? 'rezumat') as Fila;
  let [de, pana] = data(f.de) && data(f.pana) ? [f.de!, f.pana!] : [ziua(azia, -29), azia];
  if (de > pana) [de, pana] = [pana, de];
  const curier = f.curier === 'fan' || f.curier === 'gls' ? f.curier : undefined;
  const lista = await magazine();
  const ales = lista.find((m) => m.id === f.magazin) ?? null;
  const filtru: Filtru = { de, pana, magazinId: ales?.id, curier };
  const presetare = pana === azia ? PERIOADE.find(([n]) => ziua(azia, 1 - n) === de) : undefined;

  const [rez, sursele, randuri, vir, carduri, virCard, bnc, daModifica] = await Promise.all([
    rezumat(filtru), surse(),
    fila !== 'rezumat' && fila !== 'incasat' && fila !== 'banca' ? colete(filtru, fila) : Promise.resolve([] as Colet[]),
    fila === 'incasat' || fila === 'rezumat' ? viramente(filtru) : Promise.resolve([]),
    fila === 'incasat' || fila === 'rezumat' ? card(filtru) : Promise.resolve([]),
    fila === 'incasat' ? viramenteCard(filtru) : Promise.resolve([]),
    fila === 'banca' ? banca(de, pana) : Promise.resolve(null),
    poateModifica('financiar'),
  ]);

  async function incarcaExtras(fd: FormData) {
    'use server';
    await cere('financiar', 'modifica');
    const fisier = fd.get('extras');
    if (!(fisier instanceof File) || fisier.size === 0) redirect('/financiar?fila=banca&eroare=' + encodeURIComponent('Alege fișierul PDF al extrasului.'));
    let mesaj: string;
    try {
      const r = await importaExtras(new Uint8Array(await fisier.arrayBuffer()));
      if (r.tranzactii.length === 0) throw new Error('Nu am găsit tranzacții. E un extras Banca Transilvania, în PDF?');
      mesaj = `Extras ${r.cont}, ${r.de?.split('-').reverse().join('.')} – ${r.pana?.split('-').reverse().join('.')}: ${r.tranzactii.length} tranzacții, ${r.noi} noi; `
        + `${r.zileVerificate} din ${r.zile} zile se potrivesc la ban cu rulajul băncii; ${r.potrivite} încasări potrivite acum.`
        + (r.diferente.length ? ` Zile de verificat: ${r.diferente.join('; ')}.` : '');
    } catch (e) {
      redirect('/financiar?fila=banca&eroare=' + encodeURIComponent((e as Error).message));
    }
    redirect('/financiar?fila=banca&ok=' + encodeURIComponent(mesaj));
  }
  const totCard = carduri.reduce((s, x) => ({ brut: s.brut + x.brut, rambursari: s.rambursari + x.rambursari, comision: s.comision + x.comision,
    net: s.net + x.net, plati: s.plati + x.plati }), { brut: 0, rambursari: 0, comision: 0, net: 0, plati: 0 });
  const gasite = randuri.filter((c) => potriveste(f.cauta, c.awb, c.comanda, c.destinatar, c.telefon?.replace(/\D/g, ''), c.oras, c.referinta, ...c.facturi));
  const clientFan = new Map<string, string>([['7370637', 'Maison Loulou'], ['7370638', 'Parseea'], ['7388539', 'Sleevy']]);

  const adresa = (o: { fila?: Fila; magazin?: string | null; curier?: string | null; de?: string; pana?: string }) => {
    const q = new URLSearchParams();
    const fl = o.fila ?? fila;
    if (fl !== 'rezumat') q.set('fila', fl);
    const m = o.magazin === undefined ? ales?.id : o.magazin;
    if (m) q.set('magazin', m);
    const c = o.curier === undefined ? curier : o.curier;
    if (c) q.set('curier', c);
    const [d1, d2] = o.de ? [o.de, o.pana ?? azia] : [de, pana];
    if (!(d1 === ziua(azia, -29) && d2 === azia)) { q.set('de', d1); q.set('pana', d2); }
    if (f.cauta) q.set('cauta', f.cauta);
    return `/financiar${q.size ? `?${q}` : ''}`;
  };
  const tot = rez.reduce((s, r) => ({
    colete: s.colete + r.colete, nefacturate: s.nefacturate + r.nefacturate, de_stornat: s.de_stornat + r.de_stornat,
    neincasat_nr: s.neincasat_nr + r.neincasat_nr, neincasat: s.neincasat + r.neincasat, ramburs: s.ramburs + r.ramburs, retururi: s.retururi + r.retururi,
  }), { colete: 0, nefacturate: 0, de_stornat: 0, neincasat_nr: 0, neincasat: 0, ramburs: 0, retururi: 0 });
  const incasat = vir.reduce((s, v) => s + v.suma, 0);
  const numar: Partial<Record<Fila, string>> = {
    nefacturate: String(tot.nefacturate), de_stornat: String(tot.de_stornat), neincasat: String(tot.neincasat_nr),
    incasat: lei(incasat + (curier ? 0 : totCard.net)), expediate: String(tot.colete), retururi: String(tot.retururi),
  };
  const probleme = sursele.filter((s) => s.eroare);

  return (
    <main className="lat">
      <h1 className="nu-tipari">Financiar</h1>
      <nav className="file">
        <Link href={adresa({ magazin: null })} className={!ales ? 'activ' : ''}>Toate</Link>
        {lista.map((m) => <Link key={m.id} href={adresa({ magazin: m.id })} className={m.id === ales?.id ? 'activ' : ''}>{m.brand}</Link>)}
      </nav>

      {sursele.length === 0 ? (
        <p className="goluri nu-tipari">Nimic citit încă de la curieri și xConnector. {esteAdmin(u) ? 'Prima citire pornește după ce datele de acces sunt puse pe server.' : ''}</p>
      ) : probleme.length > 0 && (
        <div className="goluri nu-tipari">
          <h2>Surse care nu s-au putut citi</h2>
          <ul>{probleme.map((s) => <li key={s.sursa}><strong>{numeSursa(s.sursa, clientFan)}</strong>: {s.eroare}</li>)}</ul>
        </div>
      )}

      <div className="liste-actiuni perioade nu-tipari">
        <span className="filtre">
          <span className="slab">Perioadă:</span>
          {PERIOADE.map(([n, nume]) => (
            <Link key={n} href={adresa({ de: ziua(azia, 1 - n) })} className={`buton ${presetare?.[0] === n ? 'activ-buton' : ''}`}>{nume}</Link>
          ))}
          <form method="get" className="in-rand" key={`p${de}${pana}`}>
            {fila !== 'rezumat' && <input type="hidden" name="fila" value={fila} />}
            {ales && <input type="hidden" name="magazin" value={ales.id} />}
            {curier && <input type="hidden" name="curier" value={curier} />}
            <span className="slab">de la</span>
            <input type="date" name="de" defaultValue={de} max={azia} aria-label="De la" />
            <span className="slab">până la</span>
            <input type="date" name="pana" defaultValue={pana} max={azia} aria-label="Până la" />
            <button className={`buton ${!presetare ? 'activ-buton' : ''}`}>Arată</button>
          </form>
        </span>
        <span className="filtre">
          <span className="slab">Curier:</span>
          {([[null, 'toți'], ['fan', 'Fan Courier'], ['gls', 'GLS']] as const).map(([c, nume]) => (
            <Link key={nume} href={adresa({ curier: c })} className={`buton ${(curier ?? null) === c ? 'activ-buton' : ''}`}>{nume}</Link>
          ))}
          <Tipareste />
        </span>
      </div>

      <div className="numere-magazin nu-tipari">
        {FILE.map(([k, nume]) => (
          <Link key={k} href={adresa({ fila: k })} className={`numar-situatie ${k === fila ? 'activ-numar' : ''} ${
            k === 'nefacturate' && tot.nefacturate ? 'ton-galben' : k === 'de_stornat' && tot.de_stornat ? 'ton-rosu' : k === 'neincasat' && tot.neincasat_nr ? 'ton-galben' : k === 'incasat' ? 'ton-verde' : ''}`}>
            {numar[k] && <strong>{numar[k]}</strong>} {nume.toLowerCase()}
          </Link>
        ))}
      </div>

      <article className="foaie foaie-lata">
        <header className="foaie-antet">
          <h1>{FILE.find(([k]) => k === fila)![1]} · {presetare ? `ultimele ${presetare[1]} · ` : ''}{scurt(de)} – {scurt(pana)}</h1>
          <p className="foaie-sub">{ales ? ales.brand : 'toate brandurile'}{curier ? ` · ${curier === 'fan' ? 'Fan Courier' : 'GLS'}` : ''} · {DESPRE[fila]}</p>
          {sursele.length > 0 && (
            <p className="foaie-mic">Citit: {sursele.map((s) => `${numeSursa(s.sursa, clientFan)} ${s.citit_la ?? '—'}`).join(' · ')}</p>
          )}
        </header>

        {fila === 'rezumat' && (
          <>
            <section className="foaie-grupa">
              <h2>Pe branduri</h2>
              <table>
                <thead><tr><th>Brand</th><th className="c">Colete</th><th className="c">Livrate</th><th className="c">Refuzate / returnate</th><th className="c">Pe drum</th>
                  <th className="c">Facturate</th><th className="c">Livrate fără factură</th><th className="c">De stornat</th><th className="c">Ramburs de încasat</th><th className="c">Ramburs total</th><th className="c">Retururi primite</th></tr></thead>
                <tbody>
                  {rez.map((r) => (
                    <tr key={r.magazin ?? '-'}>
                      <td><strong>{r.magazin ?? 'nepotrivite'}</strong>{!r.magazin && <div className="mic">colete fără brand sau comandă găsită</div>}</td>
                      <td className="c">{r.colete}</td>
                      <td className="c">{r.livrate}</td>
                      <td className="c">{r.refuzate + r.returnate}</td>
                      <td className="c">{r.pe_drum}</td>
                      <td className="c">{r.cu_factura}<div className="mic">{r.colete ? Math.round((r.cu_factura / r.colete) * 100) : 0}%</div></td>
                      <td className={`c ${r.nefacturate ? 'galben-tare' : ''}`}>{r.nefacturate}</td>
                      <td className={`c ${r.de_stornat ? 'rosu-tare' : ''}`}>{r.de_stornat}</td>
                      <td className="c">{lei(r.neincasat)}<div className="mic">{r.neincasat_nr} colete</div></td>
                      <td className="c">{lei(r.ramburs)}</td>
                      <td className="c">{r.retururi}{r.retururi_schimb > 0 && <div className="mic">{r.retururi_schimb} schimburi</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            {!curier && (
              <section className="foaie-grupa">
                <h2>Încasat cu cardul · Shopify Payments · {lei(totCard.net)} net</h2>
                <TabelCard carduri={carduri} tot={totCard} />
              </section>
            )}
            <section className="foaie-grupa">
              <h2>Încasat de la Fan Courier · {lei(incasat)}</h2>
              {vir.length === 0 ? <p className="foaie-gol">Niciun virament în perioadă.</p> : (
                <p className="foaie-mic">{vir.length} viramente pe {new Set(vir.map((v) => v.virat_zi)).size} zile · detaliile în „Încasat".</p>
              )}
            </section>
          </>
        )}

        {fila === 'incasat' && !curier && (
          <section className="foaie-grupa">
            <h2>Card · Shopify Payments · {lei(totCard.net)} net</h2>
            <p className="foaie-mic">Plățile cu cardul din perioadă (după ziua plății) și viramentele Shopify către bancă (după ziua viramentului).</p>
            <TabelCard carduri={carduri} tot={totCard} />
            {virCard.length > 0 && (
              <table>
                <thead><tr><th>Virament card</th><th>Brand</th><th>Stare</th><th className="c">Brut</th><th className="c">Comision</th><th className="c">Net în cont</th></tr></thead>
                <tbody>
                  {virCard.map((v, i) => (
                    <tr key={i}>
                      <td>{new Date(`${v.data}T12:00:00`).toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'long' })}</td>
                      <td>{v.magazin}</td>
                      <td><span className={`insigna ${v.stare === 'PAID' ? 'verde' : v.stare === 'FAILED' ? 'rosu' : 'albastru'}`}>{STARE_VIRAMENT[v.stare] ?? v.stare}</span></td>
                      <td className="c">{lei(v.brut)}</td>
                      <td className="c">{lei(v.comision)}</td>
                      <td className="c"><strong>{lei(v.net)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {fila === 'incasat' && <h2 className="foaie-capitol">Ramburs · virat de Fan Courier · {lei(incasat)}</h2>}
        {fila === 'incasat' && (
          vir.length === 0 ? <p className="foaie-gol">Niciun virament de ramburs în perioadă.</p> : (
            <table>
              <thead><tr><th>Ziua viramentului</th><th>Brand</th><th className="c">Colete</th><th className="c">Suma</th></tr></thead>
              <tbody>
                {vir.map((v) => (
                  <tr key={`${v.virat_zi}${v.magazin}`}>
                    <td>{new Date(`${v.virat_zi}T12:00:00`).toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'long' })}</td>
                    <td>{v.magazin ?? '—'}</td>
                    <td className="c">{v.colete}</td>
                    <td className="c"><strong>{lei(v.suma)}</strong></td>
                  </tr>
                ))}
                <tr className="grupa-model"><td><strong>Total</strong></td><td /><td className="c"><strong>{vir.reduce((s, v) => s + v.colete, 0)}</strong></td><td className="c"><strong>{lei(incasat)}</strong></td></tr>
              </tbody>
            </table>
          )
        )}

        {fila !== 'rezumat' && fila !== 'incasat' && fila !== 'banca' && (
          <>
            <div className="nu-tipari">
              <Cauta valoare={f.cauta} pastreaza={{ fila, magazin: ales?.id, curier, de: f.de, pana: f.pana }}
                     placeholder="caută: AWB, comandă, client, telefon, oraș, factură" />
            </div>
            <p className="foaie-rezumat">
              {gasite.length} colete{randuri.length === LIMITA ? ` (primele ${LIMITA}: caută sau alege o perioadă mai scurtă pentru restul)` : ''} · ramburs {lei(gasite.reduce((s, c) => s + c.ramburs, 0))}
            </p>
            {gasite.length === 0 ? <p className="foaie-gol">Nimic aici în perioada aleasă.</p> : (
              <table>
                <thead>
                  <tr>{!ales && <th>Brand</th>}<th>AWB</th><th>Comandă</th><th>Client</th><th>Stadiu</th>
                    <th className="c">Ramburs</th><th>Factură</th>{fila === 'retururi' && <th>Ce e</th>}{fila === 'neincasat' && <th className="c">Așteaptă</th>}{fila === 'expediate' && <th>Încasat</th>}</tr>
                </thead>
                <tbody>
                  {gasite.map((c) => (
                    <tr key={`${c.curier}${c.awb}`}>
                      {!ales && <td className="mic">{c.magazin ?? '—'}</td>}
                      <td><strong>{c.awb}</strong><div className="mic">{c.curier === 'fan' ? 'Fan' : 'GLS'} · {scurt(c.creat_zi)}</div></td>
                      <td>{c.comanda ?? <span className="insigna galben">fără comandă</span>}
                        {c.potrivire === 'telefon' && <div className="mic">după telefon{c.sens === 'iese' ? ' · probabil schimb' : ''}</div>}
                        {c.potrivire === 'referinta' && c.referinta && <div className="mic">{c.referinta}</div>}
                        {!c.comanda && c.referinta && <div className="mic">{c.referinta}</div>}</td>
                      <td>{c.destinatar ?? '—'}<div className="mic">{[c.telefon, c.oras].filter(Boolean).join(' · ')}</div></td>
                      <td><span className={`insigna ${STARI[c.stare]?.[1] ?? ''}`}>{STARI[c.stare]?.[0] ?? c.stare}</span>
                        {c.stare_la && <div className="mic">{c.stare_la}</div>}</td>
                      <td className="c">{c.ramburs ? lei(c.ramburs) : <span className="mic">plătit / fără</span>}</td>
                      <td>{c.facturi.length ? c.facturi.join(', ') : c.stornari.length ? <span className="insigna">stornată</span> : <span className="insigna galben">fără factură</span>}
                        {c.stornari.length > 0 && <div className="mic">stornare: {c.stornari.join(', ')}</div>}</td>
                      {fila === 'retururi' && <td>{/schimb/i.test(c.referinta ?? '') ? <span className="insigna albastru">schimb</span> : <span className="insigna galben">retur</span>}</td>}
                      {fila === 'neincasat' && <td className={`c ${(c.zile ?? 0) > 7 ? 'rosu-tare' : ''}`}>{c.zile} zile</td>}
                      {fila === 'expediate' && <td className="mic">{c.virat ? `${lei(c.virat)} · ${scurt(c.virat_zi)}` : c.ramburs ? '—' : ''}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        {fila === 'banca' && bnc && (
          <>
            {f.ok && <p className="mesaj-ok nu-tipari">{f.ok}</p>}
            {f.eroare && <p className="lipsa nu-tipari">{f.eroare}</p>}
            {daModifica && (
              <form action={incarcaExtras} className="filtre nu-tipari">
                <span className="slab">Extras de cont Banca Transilvania (PDF):</span>
                <input type="file" name="extras" accept="application/pdf,.pdf" required />
                <button className="buton">Încarcă și potrivește</button>
              </form>
            )}
            <p className="foaie-mic">
              {bnc.extrase.length === 0 ? 'Niciun extras încărcat încă.' : `Extrase încărcate: ${bnc.extrase.map((e) => `${e.cont} ${e.de} – ${e.pana} (${e.tranzactii} tranzacții)`).join(' · ')}`}
            </p>

            <section className="foaie-grupa">
              <h2>Banii ajunși în bancă, pe sursă</h2>
              {bnc.surse.length === 0 ? <p className="foaie-gol">Nicio încasare de la curieri sau Shopify în perioadă, în extrasele încărcate.</p> : (
                <table>
                  <thead><tr><th>De la</th><th className="c">Încasări</th><th className="c">Suma în bancă</th><th className="c">Potrivite</th><th className="c">Nepotrivite</th><th className="c">Reținut / restituit</th></tr></thead>
                  <tbody>
                    {bnc.surse.map((x) => (
                      <tr key={x.sursa}>
                        <td><strong>{NUME_SURSA[x.sursa] ?? x.sursa}</strong></td>
                        <td className="c">{x.incasari}</td>
                        <td className="c"><strong>{lei(x.suma)}</strong></td>
                        <td className="c">{x.potrivite}<div className="mic">{lei(x.suma_potrivita)}</div></td>
                        <td className={`c ${x.incasari - x.potrivite ? 'galben-tare' : ''}`}>{x.incasari - x.potrivite}<div className="mic">{lei(x.suma - x.suma_potrivita)}</div></td>
                        <td className="c">{x.retinut || x.restituit ? <>{lei(x.retinut)}<div className="mic">restituit {lei(x.restituit)}</div></> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {bnc.retineri.length > 0 && (
              <section className="foaie-grupa">
                <h2>Loturi Fan virate în parte · reținut {lei(bnc.retineri.reduce((s, x) => s + x.diferenta, 0))}</h2>
                <p className="foaie-mic">Fan a virat mai puțin decât lotul și a reținut diferența; o dă înapoi ca „restituire reținere"
                  (în perioadă: {lei(bnc.surse.find((x) => x.sursa === 'fan')?.restituit ?? 0)}).</p>
                <table>
                  <thead><tr><th>În bancă</th><th>Lot</th><th className="c">Lotul</th><th className="c">Primit</th><th className="c">Reținut</th></tr></thead>
                  <tbody>
                    {bnc.retineri.map((x) => (
                      <tr key={x.lot}><td>{scurt(x.zi)}</td><td className="mic">{x.lot}</td><td className="c">{lei(x.suma + x.diferenta)}</td>
                        <td className="c">{lei(x.suma)}</td><td className="c rosu-tare">{lei(x.diferenta)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <section className="foaie-grupa">
              <h2>Încasări fără pereche · {bnc.nepotrivite.length}</h2>
              <p className="foaie-mic">Bani veniți de la curieri sau Stripe care nu corespund unui lot de ramburs sau unui virament card.</p>
              {bnc.nepotrivite.length === 0 ? <p className="foaie-gol">Toate încasările au pereche.</p> : (
                <table>
                  <thead><tr><th>Ziua</th><th>De la</th><th className="c">Suma</th><th>Descriere</th></tr></thead>
                  <tbody>
                    {bnc.nepotrivite.map((x, i) => (
                      <tr key={i}><td>{scurt(x.zi)}</td><td>{NUME_SURSA[x.sursa] ?? x.sursa}</td><td className="c"><strong>{lei(x.suma)}</strong></td><td className="mic">{x.descriere}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="foaie-grupa">
              <h2>Virate, dar neajunse în extrase · {bnc.neajunse.length}</h2>
              <p className="foaie-mic">Loturi de ramburs Fan și viramente Shopify Payments din perioadă care nu apar în extrasele încărcate (până la ultima zi a extraselor). Fie au ajuns în alt cont, fie lipsesc.</p>
              {bnc.neajunse.length === 0 ? <p className="foaie-gol">Toate au ajuns.</p> : (
                <table>
                  <thead><tr><th>Virat</th><th>De la</th><th>Lot / virament</th><th className="c">Suma</th></tr></thead>
                  <tbody>
                    {bnc.neajunse.map((x) => (
                      <tr key={x.cheie}><td>{scurt(x.zi)}</td><td>{NUME_SURSA[x.sursa] ?? x.sursa}{x.magazin && <div className="mic">{x.magazin}</div>}</td>
                        <td className="mic">{x.sursa === 'fan' ? `lot ${x.cheie}` : x.cheie.replace(/^gid:\/\/shopify\/ShopifyPaymentsPayout\//, 'payout ')}</td><td className="c"><strong>{lei(x.suma)}</strong></td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </article>
    </main>
  );
}
