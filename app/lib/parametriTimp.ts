import { interogare } from './sesiune';

export type ParametriTimp = { orePeZi: number; operatori: number; costMinut: number };

/** Parametrii estimării de timp (din `parametru`): ore pe zi, operatori impliciți, costul unui minut-om. */
export async function parametriTimp(): Promise<ParametriTimp> {
  const r = await interogare<{ cheie: string; valoare: number }>(
    `SELECT cheie, valoare::float AS valoare FROM parametru WHERE cheie IN ('ore_pe_zi', 'operatori_impliciti', 'cost_minut_om')`);
  const p = (k: string, d: number) => r.find((x) => x.cheie === k)?.valoare ?? d;
  return { orePeZi: p('ore_pe_zi', 8), operatori: p('operatori_impliciti', 6), costMinut: p('cost_minut_om', 0) };
}
