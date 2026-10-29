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
