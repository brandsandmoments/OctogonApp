import Link from 'next/link';
import Cauta from '../Cauta';
import { potriveste } from '../lib/format';
import { comenziMagazine, magazine, type ComandaClasificata, type Situatie } from '../lib/magazine';
import { cere, poateModifica } from '../lib/sesiune';
import { esteAdmin } from '../lib/acces';
import Tipareste from '../Tipareste';
import { dinLista, Foaie, LISTE, type Lista } from './Liste';
import PeModele from './PeModele';
import './magazine.css';
import './foaie.css';

export const dynamic = 'force-dynamic';

const SITUATII: Record<Situatie, { nume: string; ton: string; ce: string }> = {
  livrabila: { nume: 'De trimis', ton: 'verde', ce: 'totul e pe stoc: picking și expediere' },
  de_sunat: { nume: 'De sunat', ton: 'galben', ce: 'avem doar o parte: sună clientul, oferă ce avem' },
  fara_stoc: { nume: 'Fără stoc', ton: 'rosu', ce: 'nu avem nimic: alternativă sau restoc' },
};

type Vedere = Situatie | 'duble' | 'toate';
const VEDERI: [Vedere, string][] = [['toate', 'Toate'], ['livrabila', 'De trimis'], ['de_sunat', 'De sunat'], ['fara_stoc', 'Fără stoc'], ['duble', 'Posibile duble']];
const NUME_LISTE: [Lista, string][] = [['single', 'Picking single'], ['multi', 'Picking multi'], ['de_sunat', 'De sunat'], ['fara_stoc', 'Fără stoc']];

const vechime = (zile: number) => {
  const ton = zile >= 4 ? 'rosu' : zile >= 2 ? 'galben' : 'verde';
  return <span className={`insigna ${ton}`}>{zile <= 0 ? 'azi' : zile === 1 ? 'ieri' : `de ${zile} zile`}</span>;
};

function Numere({ lista, href }: { lista: ComandaClasificata[]; href: (v: Vedere) => string }) {
  const n = (s: Situatie) => lista.filter((c) => c.situatie === s);
  return (
    <div className="numere-magazin">
      {(Object.keys(SITUATII) as Situatie[]).map((s) => (
        <Link key={s} href={href(s)} className={`numar-situatie ton-${SITUATII[s].ton}`}>
          <strong>{n(s).length}</strong> {SITUATII[s].nume.toLowerCase()}
          <span className="slab"> · {n(s).reduce((a, c) => a + c.bucati, 0)} buc</span>
        </Link>
      ))}
      {lista.some((c) => c.dubla) && (
        <Link href={href('duble')} className="numar-situatie ton-galben"><strong>{lista.filter((c) => c.dubla).length}</strong> posibile duble</Link>
      )}
      {lista.some((c) => c.zile >= 4) && <span className="numar-situatie ton-rosu"><strong>{lista.filter((c) => c.zile >= 4).length}</strong> așteaptă de 4+ zile</span>}
    </div>
  );
}

/**
 * Comenzile intrate în toate magazinele Shopify, într-un singur loc: ce se poate
 * trimite, ce e de sunat (avem doar o parte), ce a rămas fără stoc și ce pare
 * dublă. „Toate" le arată pe toate magazinele; fiecare magazin are fila lui. Cele
 * mai vechi sus — sunt cele mai urgente.
 */
export default async function Magazine({ searchParams }: { searchParams: Promise<{ magazin?: string; vedere?: string; lista?: string; cauta?: string; grupare?: string }> }) {
  const u = await cere('expediere');
  const f = await searchParams;
  const [toateMagazinele, toate] = await Promise.all([magazine(), comenziMagazine()]);
  const ales = toateMagazinele.find((m) => m.id === f.magazin) ?? null;
  const vedere = (VEDERI.find(([v]) => v === f.vedere)?.[0] ?? 'toate') as Vedere;
  // Pe un magazin, implicit foaia de picking single; „Toate comenzile" e tabelul cu căutare.
  const foaia = ales && !f.vedere ? ((NUME_LISTE.find(([l]) => l === f.lista)?.[0] ?? 'single') as Lista) : null;
  const dinMagazin = toate.filter((c) => !ales || c.magazin_id === ales.id);
  const lista = dinMagazin
    .filter((c) => vedere === 'toate' || (vedere === 'duble' ? c.dubla : c.situatie === vedere))
    .filter((c) => potriveste(f.cauta, c.nume, c.client, c.telefon, c.oras, ...c.linii.map((l) => `${l.produs} ${l.sku ?? ''}`)));
  const adresa = (o: { magazin?: string | null; vedere?: Vedere; lista?: Lista; grupare?: string }) => {
    const q = new URLSearchParams();
    const m = o.magazin === undefined ? ales?.id : o.magazin;
    if (m) q.set('magazin', m);
    if (o.lista) { q.set('lista', o.lista); return `/magazine?${q}`; }
    const v = o.vedere ?? vedere;
    if (v !== 'toate' || (m && !o.lista)) q.set('vedere', v);
    if (f.cauta) q.set('cauta', f.cauta);
    const g = o.grupare === undefined ? f.grupare : o.grupare;
    if (g) q.set('grupare', g);
    return `/magazine${q.size ? `?${q}` : ''}`;
  };
  const peModel = f.grupare === 'model';
  const nelegate = toateMagazinele.filter((m) => !m.legat && !m.sincronizat_la);

  return (
    <main className="lat">
      <h1>Comenzi din magazine</h1>
      <nav className="file">
        <Link href={adresa({ magazin: null, vedere: 'toate' })} className={!ales ? 'activ' : ''}>Toate · {toate.length}</Link>
        {toateMagazinele.map((m) => (
          <Link key={m.id} href={adresa({ magazin: m.id, lista: 'single' })} className={ales?.id === m.id ? 'activ' : ''}>
            {m.brand} · {toate.filter((c) => c.magazin_id === m.id).length}
          </Link>
        ))}
      </nav>

      {nelegate.length > 0 && (
        <p className="slab">
          Nelegate încă: {nelegate.map((m) => m.brand).join(', ')}.{' '}
          {esteAdmin(u) ? <Link href="/magazine/legaturi">Leagă magazinele</Link> : 'Un cont master le poate lega din „Legături Shopify".'}
        </p>
      )}

      {ales ? (
        <>
          <p className="sumar">{ales.domeniu ?? 'nelegat'}{ales.sincronizat_la && ` · sincronizat ${ales.sincronizat_la}`}</p>
          <nav className="file">
            {NUME_LISTE.map(([l, nume]) => (
              <Link key={l} href={adresa({ lista: l })} className={l === foaia ? 'activ' : ''}>
                {nume} · {dinMagazin.filter((c) => dinLista(l, c)).length}
              </Link>
            ))}
            <Link href={adresa({ vedere: 'toate' })} className={!foaia ? 'activ' : ''}>Toate comenzile · {dinMagazin.length}</Link>
          </nav>
        </>
      ) : (
        <div className="pe-magazine">
          {toateMagazinele.map((m) => (
            <section key={m.id}>
              <h2><Link href={adresa({ magazin: m.id, lista: 'single' })}>{m.brand}</Link>
                <span className="slab"> {m.sincronizat_la ? `· sincronizat ${m.sincronizat_la}` : '· nelegat'}</span></h2>
              <Numere lista={toate.filter((c) => c.magazin_id === m.id)} href={(v) => adresa({ magazin: m.id, vedere: v })} />
            </section>
          ))}
        </div>
      )}

      {foaia && ales ? (
        <>
          <div className="liste-actiuni nu-tipari">
            <span className="slab">{LISTE[foaia].ce}</span>
            <span>
              {foaia === 'fara_stoc' && (await poateModifica('comenzi')) && (
                <Link href={`/magazine/psc?magazin=${ales.id}`} className="buton">PSC din ce lipsește →</Link>
              )}{' '}
              <Tipareste />
            </span>
          </div>
          <Foaie lista={foaia} magazin={ales.brand} comenzi={dinMagazin.filter((c) => dinLista(foaia, c))} />
        </>
      ) : (<>
      <nav className="file">
        {VEDERI.map(([v, nume]) => (
          <Link key={v} href={adresa({ vedere: v })} className={v === vedere ? 'activ' : ''}>
            {nume} · {v === 'toate' ? dinMagazin.length : dinMagazin.filter((c) => (v === 'duble' ? c.dubla : c.situatie === v)).length}
          </Link>
        ))}
      </nav>
      {vedere !== 'toate' && vedere !== 'duble' && <p className="slab">{SITUATII[vedere].ce}</p>}
      <p className="filtre">
        <span className="slab">Afișează:</span>
        <Link href={adresa({ grupare: '' })} className={`buton ${!peModel ? 'activ-buton' : ''}`}>pe comenzi, cele mai vechi sus</Link>
        <Link href={adresa({ grupare: 'model' })} className={`buton ${peModel ? 'activ-buton' : ''}`}>pe model, culoare și mărime, cele mai multe comenzi sus</Link>
      </p>
      <Cauta valoare={f.cauta} pastreaza={{ magazin: ales?.id, vedere: vedere === 'toate' ? undefined : vedere, grupare: f.grupare }}
             placeholder="caută: comandă, client, telefon, produs, SKU" />

      {peModel ? (
        <PeModele comenzi={lista} doarLipsa={vedere === 'fara_stoc' || vedere === 'de_sunat'} cuMagazin={!ales}
                  semn={`${ales?.id ?? ''}${vedere}${f.cauta ?? ''}`} />
      ) : lista.length === 0 ? <p className="slab">Nicio comandă aici.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator comenzi-magazin">
            <thead>
              <tr><th>Comandă</th><th>Așteaptă</th><th>Situație</th><th>Client</th><th>Produse · stoc</th><th>Plată</th></tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.nume}</strong>
                    {!ales && <span className="slab"> · {c.magazin}</span>}
                    <div className="slab">{c.creata_la.slice(8)}.{c.creata_la.slice(5, 7)}</div>
                  </td>
                  <td>{vechime(c.zile)}</td>
                  <td>
                    <span className={`insigna ${SITUATII[c.situatie].ton}`}>{SITUATII[c.situatie].nume}</span>
                    {c.dubla && (
                      <div><span className="insigna galben" title={`și ${c.dubla.cu.join(', ')}`}>
                        ⚠ {c.dubla.aceeasi_varianta ? 'dublă: aceeași variantă' : 'același client'} · {c.dubla.cu.join(', ')}
                      </span></div>
                    )}
                  </td>
                  <td className="client">
                    {c.client ?? '—'}
                    <div className="slab">{[c.telefon, c.oras].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>
                    <ul className="linii-magazin">
                      {c.linii.map((l, i) => (
                        <li key={i} className={l.pe_stoc ? '' : 'lipsa-linie'}>
                          <span className="semn">{l.pe_stoc ? '✔' : '✖'}</span>
                          <span>{l.tip} {l.model}</span> <span className="slab">{l.culoare}</span> <strong>{l.marime}</strong>
                          {l.bucati > 1 && <span> × {l.bucati}</span>}
                          <span className="slab"> · stoc {l.stoc}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="slab">{(c.plata ?? '').toLowerCase().replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>)}
    </main>
  );
}
