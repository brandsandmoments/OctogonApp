import { zilePanaLa } from './lib/format';

/**
 * Etichetele colorate, aceleași pe toate ecranele, ca roșul să însemne mereu
 * același lucru: întârziat. Galben = termen în cel mult 3 zile, verde = e timp.
 */

/** Termenul, colorat după cât a mai rămas; cu `gata` (a intrat tot) rămâne gri. */
export function Termen({ data, gata = false }: { data: string | null; gata?: boolean }) {
  if (!data) return <span className="slab">—</span>;
  const zile = zilePanaLa(data)!;
  const ton = gata ? 'gri' : zile < 0 ? 'rosu' : zile <= 3 ? 'galben' : 'verde';
  const cat = gata ? '' : zile < 0 ? ` · ${-zile} ${-zile === 1 ? 'zi' : 'zile'} întârziere` : zile === 0 ? ' · azi' : zile <= 3 ? ` · în ${zile} ${zile === 1 ? 'zi' : 'zile'}` : '';
  return <span className={`insigna ${ton}`} title={gata ? 'a intrat tot' : undefined}>{data.slice(5).split('-').reverse().join('.')}{cat}</span>;
}

const TON_STADIU: Record<string, string> = {
  // Liniile din centralizator și comenzi
  necroita: 'gri', croita: 'albastru', in_lucru: 'violet', gata: 'verde',
  // Planificările
  fara_cantitate: 'rosu', blocat_materiale: 'galben', gata_de_lansat: 'albastru',
  lansat_spre_croit: 'albastru', in_croit: 'violet', incheiat: 'verde', anulat: 'gri',
};

/** Stadiul, ca etichetă colorată; `nume` e textul afișat, `cheie` alege culoarea. */
export function Stadiu({ cheie, nume }: { cheie: string; nume: string }) {
  return <span className={`insigna ${TON_STADIU[cheie] ?? 'gri'}`}>{nume}</span>;
}

/** Cât s-a croit (albastru deschis) și cât a intrat în depozit (verde) din cât s-a cerut. */
export function Progres({ cerut, croit, intrat }: { cerut: number; croit: number; intrat: number }) {
  const pc = (n: number) => `${Math.min(100, cerut ? (n / cerut) * 100 : 0)}%`;
  return (
    <span className="progres" title={`cerut ${cerut} · croit ${croit} · intrat ${intrat}`}>
      <span className="progres-bara">
        <span className="croit" style={{ width: pc(croit) }} />
        <span className="intrat" style={{ width: pc(intrat) }} />
      </span>
      <span className="progres-text">croit {croit}/{cerut} · intrat {intrat}</span>
    </span>
  );
}
