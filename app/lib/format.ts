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
