/**
 * Gradul de dificultate, pe trei niveluri, cu ponderea lui în clasament: o bucată grea contează
 * dublu față de una ușoară. Se pune pe taiere (croit) și pe omul de pe o fază a comenzii (producție).
 */
export type Dificultate = 1 | 2 | 3;
export const DIFICULTATI: Record<Dificultate, { nume: string; pondere: number; ton: string }> = {
  1: { nume: 'Ușor', pondere: 1, ton: 'verde' },
  2: { nume: 'Mediu', pondere: 1.5, ton: 'galben' },
  3: { nume: 'Greu', pondere: 2, ton: 'rosu' },
};
export const dificultateDin = (v: unknown): Dificultate => (v === '1' || v === 1 ? 1 : v === '3' || v === 3 ? 3 : 2);
/** Ponderile, ca expresie SQL pe o coloană de dificultate (pentru clasament). */
export const PONDERE_SQL = (col: string) => `(CASE ${col} WHEN 1 THEN 1 WHEN 3 THEN 2 ELSE 1.5 END)::numeric`;
