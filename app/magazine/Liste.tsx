import { Fragment } from 'react';
import { rangMarime } from '../lib/format';
import type { ComandaClasificata, LinieClasificata } from '../lib/magazine';

/**
 * Cele patru liste ale unui magazin, așezate ca foile din depozit (A4, pe alb):
 *
 * - single: comenzile cu un singur produs, livrabile — pe model, apoi culoare și
 *   mărime, cu toate comenzile aceleiași variante pe un rând;
 * - multi: comenzile cu mai multe produse, livrabile integral — câte un bloc pe
 *   comandă, culese împreună;
 * - de sunat: avem doar o parte — fiecare produs cu ✔ de trimis sau ✖ lipsă;
 * - fără stoc: nimic de trimis — single pe model, multi la final.
 *
 * Aceeași foaie se vede în aplicație și se tipărește.
 */

export type Lista = 'single' | 'multi' | 'de_sunat' | 'fara_stoc';

export const LISTE: Record<Lista, { titlu: string; ce: string }> = {
  single: { titlu: 'Picking list · single-produs', ce: 'comenzi cu 1 produs · livrabile din stoc' },
  multi: { titlu: 'Picking list · multi-produs', ce: 'comenzi cu >1 produs · livrabile integral din stoc' },
  de_sunat: { titlu: 'Comenzi de sunat · expediere parțială', ce: 'multi-produs · avem o parte în stoc' },
  fara_stoc: { titlu: 'Comenzi fără stoc · de contactat', ce: 'nu avem nimic de trimis · alternativă / restoc' },
};

export function dinLista(lista: Lista, c: ComandaClasificata): boolean {
  if (lista === 'single') return c.situatie === 'livrabila' && !c.multi;
  if (lista === 'multi') return c.situatie === 'livrabila' && c.multi;
  if (lista === 'de_sunat') return c.situatie === 'de_sunat';
  return c.situatie === 'fara_stoc';
}

const dupaModel = (a: LinieClasificata, b: LinieClasificata) =>
  a.model.localeCompare(b.model, 'ro') || a.tip.localeCompare(b.tip, 'ro');
const dupaVarianta = (a: LinieClasificata, b: LinieClasificata) =>
  a.culoare.localeCompare(b.culoare, 'ro') || rangMarime(a.marime) - rangMarime(b.marime);

/** Liniile comenzilor single, grupate pe tip · model, apoi pe variantă. */
function peModel(comenzi: ComandaClasificata[]) {
  const randuri = comenzi.map((c) => ({ c, l: c.linii[0] })).sort((a, b) => dupaModel(a.l, b.l) || dupaVarianta(a.l, b.l)
    || a.c.creata_la.localeCompare(b.c.creata_la));
  const grupe = new Map<string, { tip: string; model: string; randuri: typeof randuri }>();
  for (const r of randuri) {
    const k = `${r.l.tip}|${r.l.model}`;
    const g = grupe.get(k) ?? { tip: r.l.tip, model: r.l.model, randuri: [] };
    g.randuri.push(r);
    grupe.set(k, g);
  }
  return [...grupe.values()];
}

function Antet({ lista, magazin, generat, rezumat }: { lista: Lista; magazin: string; generat: string; rezumat: string }) {
  return (
    <header className="foaie-antet">
      <h1>{LISTE[lista].titlu}</h1>
      <p className="foaie-sub">{magazin} · {LISTE[lista].ce}</p>
      <p className="foaie-mic">nelivrate · neanulate · nerambursate · Generat {generat}</p>
      <p className="foaie-rezumat">{rezumat}</p>
    </header>
  );
}

function Duble({ comenzi }: { comenzi: ComandaClasificata[] }) {
  const vazute = new Set<string>();
  const randuri = comenzi.filter((c) => c.dubla).flatMap((c) => {
    const toate = [c.nume, ...c.dubla!.cu].sort();
    const k = toate.join(',');
    if (vazute.has(k)) return [];
    vazute.add(k);
    const altele = comenzi.filter((x) => toate.includes(x.nume));
    const variante = altele.flatMap((x) => x.linii.map((l) => `${l.culoare} ${l.marime}`));
    return [{ c, toate, variante }];
  });
  if (randuri.length === 0) return null;
  return (
    <section className="foaie-duble">
      <h2>⚠ Posibile comenzi duble — verifică înainte de expediere</h2>
      <table>
        <thead><tr><th>Client</th><th>Produs</th><th>Comenzi</th><th>Situație</th></tr></thead>
        <tbody>
          {randuri.map(({ c, toate, variante }) => (
            <tr key={toate.join()}>
              <td>{c.client}<div>{c.telefon}</div></td>
              <td>{[...new Set(c.linii.map((l) => l.produs))].join(', ')}</td>
              <td><strong>{toate.join(', ')}</strong></td>
              <td className="rosu-tare">{c.dubla!.aceeasi_varianta ? `aceeași variantă (${variante.join(', ')})` : 'același client, produse diferite'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const telefon = (t: string | null) => (t ? `☎ ${t}` : '');

function Single({ comenzi }: { comenzi: ComandaClasificata[] }) {
  return peModel(comenzi).map((g) => {
    // Aceeași variantă (culoare + mărime) pe un singur rând, cu toate comenzile ei.
    const peVarianta = new Map<string, typeof g.randuri>();
    for (const r of g.randuri) {
      const k = `${r.l.culoare}|${r.l.marime}|${r.l.produs}`;
      peVarianta.set(k, [...(peVarianta.get(k) ?? []), r]);
    }
    return (
      <section key={`${g.tip}${g.model}`} className="foaie-grupa">
        <h2>{g.tip} · {g.model}</h2>
        <table>
          <thead><tr><th>Culoare</th><th className="c">Măr.</th><th className="c">Buc</th><th>Comenzi · dată · client · telefon</th><th className="c">Stoc</th><th>Produs</th></tr></thead>
          <tbody>
            {[...peVarianta.values()].map((rs) => (
              <tr key={`${rs[0].l.culoare}${rs[0].l.marime}${rs[0].l.produs}`}>
                <td>{rs[0].l.culoare}</td>
                <td className="c">{rs[0].l.marime}</td>
                <td className="c">{rs.reduce((s, r) => s + r.l.bucati, 0)}</td>
                <td className="comenzi-cel">
                  {rs.map(({ c }) => (
                    <div key={c.id}>
                      {c.nume} · {c.creata_la} · {c.client} · {c.telefon}
                      {c.dubla?.aceeasi_varianta && <span className="rosu-tare"> ⚠ DUBLĂ</span>}
                    </div>
                  ))}
                </td>
                <td className="c stoc">{rs[0].l.stoc}</td>
                <td className="produs">{rs[0].l.produs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  });
}

function BlocComanda({ c, lista }: { c: ComandaClasificata; lista: Lista }) {
  const sunat = lista === 'de_sunat';
  return (
    <section className="foaie-comanda">
      <div className="foaie-comanda-antet">
        <span>{c.nume} · {c.creata_la} · {c.client}{sunat ? c.oras && ` · ${c.oras}` : c.telefon && ` · ${telefon(c.telefon)}`}</span>
        <span className="dreapta">
          {sunat ? telefon(c.telefon) : `${c.bucati} bucăți · ${c.linii.length} produse · plată: ${(c.plata ?? '—').toLowerCase()}`}
        </span>
      </div>
      <table>
        <thead>
          <tr>{sunat && <th>Status</th>}<th>Model</th><th>Culoare</th><th className="c">Măr.</th><th className="c">Buc</th>{!sunat && <th className="c">Stoc</th>}<th>Produs</th></tr>
        </thead>
        <tbody>
          {c.linii.map((l, i) => (
            <tr key={i}>
              {sunat && <td className={l.pe_stoc ? 'verde-tare' : 'rosu-tare'}>{l.pe_stoc ? '✔ DE TRIMIS' : '✖ LIPSĂ'}</td>}
              <td><strong>{l.model}</strong></td>
              <td>{l.culoare}</td>
              <td className="c">{l.marime}</td>
              <td className="c">{l.bucati}</td>
              {!sunat && <td className={`c stoc${l.stoc <= 0 ? ' zero' : ''}`}>{l.stoc}</td>}
              <td className="produs">{l.produs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FaraStoc({ comenzi }: { comenzi: ComandaClasificata[] }) {
  const single = comenzi.filter((c) => !c.multi);
  const multi = comenzi.filter((c) => c.multi);
  return (
    <>
      {peModel(single).map((g) => (
        <section key={`${g.tip}${g.model}`} className="foaie-grupa">
          <h2>{g.tip} · {g.model}</h2>
          <table>
            <thead><tr><th>Culoare</th><th className="c">Măr.</th><th>Comandă</th><th>Data</th><th>Client</th><th>Telefon</th><th>Produs</th></tr></thead>
            <tbody>
              {g.randuri.map(({ c, l }) => (
                <tr key={c.id}>
                  <td>{l.culoare}</td>
                  <td className="c">{l.marime}</td>
                  <td>{c.nume}{c.dubla?.aceeasi_varianta && <span className="rosu-tare"> ⚠</span>}</td>
                  <td className="mic">{c.creata_la}</td>
                  <td>{c.client}</td>
                  <td>{c.telefon}</td>
                  <td className="produs">{l.produs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {multi.length > 0 && (
        <>
          <h2 className="foaie-capitol">Comenzi multi-produs fără stoc</h2>
          {multi.map((c) => <BlocComanda key={c.id} c={c} lista="multi" />)}
        </>
      )}
    </>
  );
}

/** Foaia unei liste pentru un magazin; `comenzi` sunt deja cele ale listei, cele mai vechi întâi. */
export function Foaie({ lista, magazin, comenzi }: { lista: Lista; magazin: string; comenzi: ComandaClasificata[] }) {
  const generat = new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const bucati = comenzi.reduce((s, c) => s + c.bucati, 0);
  const rezumat =
    lista === 'single' ? `${comenzi.length} comenzi · ${bucati} bucăți de cules · ${new Set(comenzi.map((c) => `${c.linii[0].produs}|${c.linii[0].marime}`)).size} poziții unice`
    : lista === 'multi' ? `${comenzi.length} comenzi · ${bucati} bucăți de cules`
    : lista === 'de_sunat' ? `${comenzi.length} comenzi de contactat · sună clientul și oferă expedierea a ceea ce avem`
    : `${comenzi.filter((c) => !c.multi).length} comenzi single-produs (grupate pe model) + ${comenzi.filter((c) => c.multi).length} comenzi multi-produs`;
  return (
    <article className="foaie">
      <Antet lista={lista} magazin={magazin} generat={generat} rezumat={rezumat} />
      {comenzi.length === 0 ? <p className="foaie-gol">Nicio comandă în lista asta acum.</p> : (
        <>
          {(lista === 'single' || lista === 'fara_stoc') && <Duble comenzi={comenzi} />}
          {lista === 'single' && <Single comenzi={comenzi} />}
          {(lista === 'multi' || lista === 'de_sunat') && comenzi.map((c) => <Fragment key={c.id}><BlocComanda c={c} lista={lista} /></Fragment>)}
          {lista === 'fara_stoc' && <FaraStoc comenzi={comenzi} />}
          <p className="foaie-nota">
            {lista === 'single' && 'Sortat pe model → culoare → mărime. „Stoc" = stoc fizic în magazin.'}
            {lista === 'multi' && 'Culege toate articolele unei comenzi împreună.'}
            {lista === 'de_sunat' && 'Verde = avem pe stoc. Roșu = lipsă. Confirmă cu clientul expedierea parțială.'}
            {lista === 'fara_stoc' && 'Contactează clientul: alternativă sau așteaptă restocul.'}
          </p>
        </>
      )}
    </article>
  );
}
