import { rangMarime } from '../lib/format';

export type LinieMarimi<K extends string> = { produs: string; cod_sku: string; marimi: ({ marime: string } & Record<K, number>)[] };

/**
 * O comandă desfăcută pe culori (produse) și mărimi: pe fiecare culoare câte un rând
 * pe măsură (cerut, croit, pe bandă…), mărimile de la cea mai mică la cea mai mare,
 * cu totalul la capăt. Prima măsură e cea îngroșată.
 */
export default function MarimiComanda<K extends string>({ linii, masuri }: { linii: LinieMarimi<K>[]; masuri: [K, string][] }) {
  const marimi = [...new Set(linii.flatMap((l) => l.marimi.map((x) => x.marime)))].sort((a, b) => rangMarime(a) - rangMarime(b));
  return (
    <div className="tabel-derulant">
      <table className="marimi-comanda">
        <thead>
          <tr><th>Culoare</th><th />{marimi.map((x) => <th key={x}>{x}</th>)}<th>Total</th></tr>
        </thead>
        <tbody>
          {linii.map((l) => masuri.map(([k, nume], i) => {
            const total = l.marimi.reduce((t, x) => t + x[k], 0);
            return (
              <tr key={`${l.cod_sku}${k}`} className={`${i === 0 ? 'cerut prima-culoare' : ''}`}>
                {i === 0 && <td className="culoare" rowSpan={masuri.length}>{l.produs} <span className="slab">{l.cod_sku}</span></td>}
                <td className="ce slab">{nume}</td>
                {marimi.map((x) => {
                  const v = l.marimi.find((y) => y.marime === x)?.[k];
                  return <td key={x}>{v ? v : <span className="slab">—</span>}</td>;
                })}
                <td className="total">{total || <span className="slab">—</span>}</td>
              </tr>
            );
          }))}
        </tbody>
      </table>
    </div>
  );
}
