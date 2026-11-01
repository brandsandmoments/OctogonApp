import { Fragment } from 'react';
import type { ComandaClasificata } from '../lib/magazine';
import Pliere from '../Pliere';

/**
 * Comenzile strânse pe model, apoi pe culoare și mărime: unde se adună cele mai multe
 * comenzi, acolo e prioritatea (de restoc, de produs, de sunat). Modelele și
 * variantele se ordonează după numărul de comenzi, cele mai multe sus.
 *
 * `doarLipsa`: pe „fără stoc" și „de sunat" contează doar produsele care lipsesc din
 * comandă; altfel, toate produsele ei.
 */
export default function PeModele({ comenzi, doarLipsa, cuMagazin, semn }: {
  comenzi: ComandaClasificata[]; doarLipsa: boolean; cuMagazin: boolean; semn: string;
}) {
  type Varianta = { culoare: string; marime: string; produs: string; stoc: number; bucati: number; comenzi: ComandaClasificata[] };
  type Model = { cheie: string; tip: string; model: string; magazin: string; variante: Map<string, Varianta> };
  const modele = new Map<string, Model>();
  for (const c of comenzi) {
    for (const l of c.linii.filter((x) => !doarLipsa || !x.pe_stoc)) {
      const km = `${cuMagazin ? c.magazin : ''}|${l.tip}|${l.model}`;
      const m = modele.get(km) ?? { cheie: km, tip: l.tip, model: l.model, magazin: c.magazin, variante: new Map() };
      const kv = `${l.produs}|${l.marime}`;
      const v = m.variante.get(kv) ?? { culoare: l.culoare, marime: l.marime, produs: l.produs, stoc: l.stoc, bucati: 0, comenzi: [] };
      v.bucati += l.bucati;
      if (!v.comenzi.includes(c)) v.comenzi.push(c);
      m.variante.set(kv, v);
      modele.set(km, m);
    }
  }
  const nrComenzi = (m: Model) => new Set([...m.variante.values()].flatMap((v) => v.comenzi)).size;
  const ordonate = [...modele.values()].sort((a, b) => nrComenzi(b) - nrComenzi(a) || a.model.localeCompare(b.model, 'ro'));
  if (ordonate.length === 0) return <p className="slab">Nicio comandă aici.</p>;

  return (
    <>
      <p className="filtre"><Pliere semn={semn} /></p>
      <div className="tabel-derulant">
        <table className="centralizator pe-modele">
          <thead>
            <tr><th>Model · culoare · mărime</th><th className="nr">Comenzi</th><th className="nr">Bucăți</th><th className="nr">Stoc</th><th>Cea mai veche</th><th>Comenzile</th></tr>
          </thead>
          <tbody>
            {ordonate.map((m) => {
              const variante = [...m.variante.values()].sort((a, b) => b.comenzi.length - a.comenzi.length || b.bucati - a.bucati);
              const toateComenzile = [...new Set(variante.flatMap((v) => v.comenzi))];
              const veche = Math.max(...toateComenzile.map((c) => c.zile));
              return (
                <Fragment key={m.cheie}>
                  <tr className="grupa-model">
                    <td><strong>{m.tip} · {m.model}</strong>{cuMagazin && <span className="slab"> · {m.magazin}</span>} <span className="slab">{variante.length} variante</span></td>
                    <td className="nr"><strong>{toateComenzile.length}</strong></td>
                    <td className="nr"><strong>{variante.reduce((s, v) => s + v.bucati, 0)}</strong></td>
                    <td />
                    <td>{varsta(veche)}</td>
                    <td />
                  </tr>
                  {variante.map((v) => (
                    <tr key={`${v.produs}${v.marime}`}>
                      <td>{v.culoare} <strong>{v.marime}</strong> <span className="slab">· {v.produs}</span></td>
                      <td className="nr"><strong>{v.comenzi.length}</strong></td>
                      <td className="nr">{v.bucati}</td>
                      <td className={`nr ${v.stoc <= 0 ? 'lipsa' : ''}`}>{v.stoc}</td>
                      <td>{varsta(Math.max(...v.comenzi.map((c) => c.zile)))}</td>
                      <td className="comenzi-varianta">
                        {v.comenzi.sort((a, b) => b.zile - a.zile).map((c) => (
                          <span key={c.id} title={`${c.client ?? ''} · ${c.telefon ?? ''} · ${c.creata_la}`}>{c.nume}{c.dubla?.aceeasi_varianta ? ' ⚠' : ''}</span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function varsta(zile: number) {
  const ton = zile >= 4 ? 'rosu' : zile >= 2 ? 'galben' : 'verde';
  return <span className={`insigna ${ton}`}>{zile <= 0 ? 'azi' : zile === 1 ? 'ieri' : `de ${zile} zile`}</span>;
}
