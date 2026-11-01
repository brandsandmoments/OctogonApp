import { Fragment } from 'react';
import { rangMarime } from '../lib/format';
import type { ComandaClasificata } from '../lib/magazine';
import Pliere from '../Pliere';

/**
 * Comenzile strânse pe model, apoi pe culoare și mărime — pe coloane: magazin, model,
 * culoare, mărime, apoi la dreapta comenzi, bucăți și stoc. Unde se adună cele mai multe
 * comenzi, acolo e prioritatea (de restoc, de produs, de sunat). Modelele se ordonează
 * după numărul de comenzi, cele mai multe sus; într-un model, pe culori, apoi mărimile
 * de la cea mai mică la cea mai mare.
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
      <p className="filtre"><Pliere semn={semn} /> <span className="slab">clic pe un model îi arată culorile și mărimile</span></p>
      <div className="tabel-derulant">
        <table className="centralizator pe-modele">
          <thead>
            <tr>
              {cuMagazin && <th>Magazin</th>}
              <th>Model</th><th>Culoare</th><th>Mărime</th>
              <th className="nr">Comenzi</th><th className="nr">Bucăți</th><th className="nr">Stoc</th>
              <th>Cea mai veche</th><th>Comenzile</th>
            </tr>
          </thead>
          <tbody>
            {ordonate.map((m) => {
              // Pe culori (cea cu cele mai multe comenzi întâi), iar în fiecare culoare mărimile de la mică la mare.
              const peCuloare = new Map<string, number>();
              for (const v of m.variante.values()) peCuloare.set(v.culoare, (peCuloare.get(v.culoare) ?? 0) + v.comenzi.length);
              const variante = [...m.variante.values()].sort((a, b) => (peCuloare.get(b.culoare)! - peCuloare.get(a.culoare)!)
                || a.culoare.localeCompare(b.culoare, 'ro') || rangMarime(a.marime) - rangMarime(b.marime));
              const toateComenzile = [...new Set(variante.flatMap((v) => v.comenzi))];
              const veche = Math.max(...toateComenzile.map((c) => c.zile));
              const stoc = variante.reduce((s, v) => s + Math.max(v.stoc, 0), 0);
              const culori = new Set(variante.map((v) => v.culoare)).size;
              return (
                <Fragment key={m.cheie}>
                  <tr className="grupa-model">
                    {cuMagazin && <td className="pm-magazin"><span className="eticheta-magazin">{m.magazin}</span></td>}
                    <td className="pm-model"><strong>{m.tip} {m.model}</strong></td>
                    <td className="pm-culoare slab">{culori} {culori === 1 ? 'culoare' : 'culori'}</td>
                    <td className="pm-marime slab">{variante.length} {variante.length === 1 ? 'variantă' : 'variante'}</td>
                    <td className="nr pm-comenzi"><strong>{toateComenzile.length}</strong><span className="pm-unit"> comenzi</span></td>
                    <td className="nr pm-bucati"><strong>{variante.reduce((s, v) => s + v.bucati, 0)}</strong><span className="pm-unit"> buc</span></td>
                    <td className={`nr pm-stoc ${stoc <= 0 ? 'lipsa' : ''}`}><strong>{stoc}</strong><span className="pm-unit"> stoc</span></td>
                    <td className="pm-veche">{varsta(veche)}</td>
                    <td className="pm-lista" />
                  </tr>
                  {variante.map((v, i) => (
                    <tr key={`${v.produs}${v.marime}`} className={`pm-varianta ${i > 0 && variante[i - 1].culoare !== v.culoare ? 'pm-culoare-noua' : ''}`}>
                      {cuMagazin && <td className="pm-magazin" />}
                      <td className="pm-model" />
                      <td className="pm-culoare">{v.culoare}</td>
                      <td className="pm-marime"><span className="eticheta-marime">{v.marime}</span></td>
                      <td className="nr pm-comenzi"><strong>{v.comenzi.length}</strong><span className="pm-unit"> com.</span></td>
                      <td className="nr pm-bucati">{v.bucati}<span className="pm-unit"> buc</span></td>
                      <td className={`nr pm-stoc ${v.stoc <= 0 ? 'lipsa' : ''}`}>{v.stoc}<span className="pm-unit"> stoc</span></td>
                      <td className="pm-veche">{varsta(Math.max(...v.comenzi.map((c) => c.zile)))}</td>
                      <td className="comenzi-varianta pm-lista">
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
