/** 14.700 → „14,7"; 42.000 → „42". Zecimalele inutile doar încurcă la citit. */
export function cantitate(text: string | number): string {
  return Number(text).toLocaleString('ro-RO', { maximumFractionDigits: 3 });
}

/** Text din formular → număr; acceptă virgula românească. Gol → null. */
export function numarDinFormular(v: FormDataEntryValue | null): number | null {
  const t = String(v ?? '').trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const simplu = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Caută pe cuvinte, fără diacritice: „sophie neg" se potrivește cu „Rochie Sophie Negru · psf-ps-26-noi-2". */
export function potriveste(cauta: string | undefined, ...campuri: (string | null | undefined)[]): boolean {
  const cuvinte = simplu(cauta ?? '').split(/\s+/).filter(Boolean);
  if (cuvinte.length === 0) return true;
  const unde = simplu(campuri.filter(Boolean).join(' '));
  return cuvinte.every((w) => unde.includes(w));
}

/** Ziua de azi la București, „YYYY-MM-DD": termenele se socotesc în zile calendaristice de aici. */
export const azi = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' });

/** Câte zile mai sunt până la o dată „YYYY-MM-DD": 0 = azi, negativ = trecută. Fără dată → null. */
export function zilePanaLa(data: string | null | undefined): number | null {
  if (!data) return null;
  return Math.round((Date.parse(data.slice(0, 10)) - Date.parse(azi())) / 86_400_000);
}

const ORDINE_MARIMI = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL'];
const SINONIME: Record<string, string> = { '3XS': 'XXXS', '2XS': 'XXS', '2XL': 'XXL', '3XL': 'XXXL', XXXXL: '4XL' };

/**
 * Locul unei mărimi, de la cea mai mică la cea mai mare: XXS (sau 2XS), XS, S, M, L, XL,
 * XXL (sau 2XL)…; mărimile cu cifre (36, 38) vin după, crescător; restul, la urmă.
 */
export function rangMarime(m: string): number {
  const t = m.trim().toUpperCase();
  const i = ORDINE_MARIMI.indexOf(SINONIME[t] ?? t);
  if (i >= 0) return i;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && t !== '' ? 100 + n : 10_000;
}
