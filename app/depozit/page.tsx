import Link from 'next/link';
import { Fragment } from 'react';
import Grupare from '../Grupare';
import { comenziDepozit, type ComandaDepozit, type VedereDepozit } from '../lib/depozit';
import { grupareDinAdresa, grupeaza } from '../lib/perioade';
import { cere } from '../lib/sesiune';

export const dynamic = 'force-dynamic';

const VEDERI: [VedereDepozit, string][] = [
  ['de_stins', 'De stins'],
  ['finalizate', 'Finalizate'],
  ['toate', 'Toate'],
];

/**
 * Depozitul de produse finite: PSF-urile și PSC-urile care se așteaptă. „De stins"
 * sunt cele la care mai lipsește ceva; o comandă iese de aici când intră tot sau
 * când se stinge, cu observații. Se grupează pe termen (de stins) sau pe ziua
 * ultimei intrări (finalizate).
 */
export default async function Depozit({ searchParams }: { searchParams: Promise<{ vedere?: string; grupare?: string; tip?: string }> }) {
  await cere('receptie');
  const f = await searchParams;
  const vedere = (VEDERI.find(([v]) => v === f.vedere)?.[0] ?? 'de_stins') as VedereDepozit;
  const g = grupareDinAdresa(f.grupare);
  const lista = (await comenziDepozit(vedere)).filter((c) => !f.tip || c.tip === f.tip);
  const zi = (c: ComandaDepozit) => (c.finalizata ? c.ultima_intrare ?? c.termen : c.termen);
  const grupe = g ? grupeaza(lista, zi, g) : [{ perioada: null, randuri: lista }];
  const adresa = (v: string) => `/depozit?vedere=${v}${g ? `&grupare=${g}` : ''}${f.tip ? `&tip=${f.tip}` : ''}`;

  return (
    <main className="lat">
      <h1>Depozit produse finite</h1>
      <nav className="file">
        {VEDERI.map(([v, nume]) => <Link key={v} href={adresa(v)} className={v === vedere ? 'activ' : ''}>{nume}</Link>)}
      </nav>
      <div className="filtre">
        <Grupare ales={g} pastreaza={{ vedere, tip: f.tip }} />
        <form className="filtre">
          <input type="hidden" name="vedere" value={vedere} />
          {g && <input type="hidden" name="grupare" value={g} />}
          <select name="tip" defaultValue={f.tip ?? ''} aria-label="Tip">
            <option value="">PSF + PSC</option><option>PSF</option><option>PSC</option>
          </select>
          <button>Filtrează</button>
        </form>
        <Link href="/scanare" className="buton">Scanează</Link>
      </div>
      <p className="sumar">
        {lista.length} comenzi · cerut {lista.reduce((s, c) => s + c.cerut, 0)} · intrat {lista.reduce((s, c) => s + c.intrat, 0)} ·
        lipsesc {lista.reduce((s, c) => s + c.lipsesc, 0)} buc
      </p>
      <div className="tabel-derulant">
        <table className="centralizator">
          <thead>
            <tr><th>Comandă</th><th>KAM</th><th>Termen</th><th className="nr">Cerut</th><th className="nr">Intrat</th>
                <th className="nr">Lipsesc</th><th>Poziții stinse</th><th>Ultima intrare</th></tr>
          </thead>
          <tbody>
            {grupe.map((gr) => (
              <Fragment key={gr.perioada?.de_la ?? 'toate'}>
                {gr.perioada && (
                  <tr className="grupa-model">
                    <td colSpan={3}><strong>{gr.perioada.nume}</strong> <span className="slab">{gr.randuri.length} comenzi</span></td>
                    <td className="nr"><strong>{gr.randuri.reduce((s, c) => s + c.cerut, 0)}</strong></td>
                    <td className="nr"><strong>{gr.randuri.reduce((s, c) => s + c.intrat, 0)}</strong></td>
                    <td className="nr"><strong>{gr.randuri.reduce((s, c) => s + c.lipsesc, 0)}</strong></td>
                    <td colSpan={2} />
                  </tr>
                )}
                {gr.randuri.map((c) => (
                  <tr key={c.numar}>
                    <td><Link href={`/depozit/${encodeURIComponent(c.numar)}`}>{c.numar}</Link> <span className="slab">{c.tip} · {c.brand}</span></td>
                    <td>{c.kam ?? <span className="slab">—</span>}</td>
                    <td className="slab">{c.termen ?? '—'}</td>
                    <td className="nr">{c.cerut}</td>
                    <td className="nr">{c.intrat || '—'}</td>
                    <td className="nr">{c.finalizata ? <span className="slab">stinsă</span> : c.lipsesc ? <strong>{c.lipsesc}</strong> : '—'}</td>
                    <td className="slab">{c.pozitii_stinse}/{c.pozitii}</td>
                    <td className="slab">{c.ultima_intrare ?? '—'}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
