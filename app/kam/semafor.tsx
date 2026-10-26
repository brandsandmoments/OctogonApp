import type { Praguri } from '../lib/kam';

/** Procentul cu culoarea pragurilor din TINTE: verde, galben sau roșu. */
export function Procent({ v, galben, verde }: { v: number | null; galben: number; verde: number }) {
  if (v === null || !Number.isFinite(v)) return <span className="slab">—</span>;
  const cls = v >= verde ? 'verde' : v >= galben ? 'galben' : 'rosu';
  return <span className={`semafor ${cls}`}>{Math.round(v * 100)}%</span>;
}

export function Acuratete({ v, p }: { v: number | null; p: Praguri }) {
  return <Procent v={v} galben={p.acurateteGalben} verde={p.acurateteVerde} />;
}

/** Ritmul se citește ca acuratețea: aproape de 100% e bine în ambele sensuri. */
export function Ritm({ vandut, tinta, p }: { vandut: number; tinta: number; p: Praguri }) {
  if (tinta <= 0) return <span className="slab">—</span>;
  const r = vandut / tinta;
  const a = Math.max(0, 1 - Math.abs(r - 1));
  const cls = a >= p.acurateteVerde ? 'verde' : a >= p.acurateteGalben ? 'galben' : 'rosu';
  return <span className={`semafor ${cls}`}>{Math.round(r * 100)}%</span>;
}

/** Ce spune abaterea, ca semnalul din KPI_KAM: subestimat cere PSC, supraestimat blochează stoc. */
export function Semnal({ vandut, tinta, p }: { vandut: number; tinta: number; p: Praguri }) {
  if (tinta <= 0) return null;
  if (vandut > tinta * (2 - p.acurateteGalben)) return <span className="rosu">subestimat — riscă lipsă de stoc, PSC?</span>;
  if (vandut < tinta * p.vandutGalben) return <span className="rosu">supraestimat — riscă stoc blocat</span>;
  return <span className="slab">pe drum</span>;
}

export const buc = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ro-RO', { maximumFractionDigits: 1 });
