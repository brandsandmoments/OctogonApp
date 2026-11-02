/**
 * Calculatorul de timp de producție — aceeași regulă ca estimarea benzii (banda.ts):
 *
 *   ore-om = bucăți × minute pe bucată (un om) / 60, ajustat după lot:
 *            sub 50 de bucăți +20% (pornirea cântărește mai mult), peste 200 −15%;
 *   zile   = ore-om / (operatori × ore pe zi), rotunjit în sus, în zile lucrătoare
 *            (luni–vineri); data de gata = ziua de început + atâtea zile lucrătoare.
 *
 * Fără nicio dependență de server: se folosește și în formularele din browser.
 */

export const factorLot = (bucati: number) => (bucati < 50 ? 1.2 : bucati > 200 ? 0.85 : 1);

/** Ziua după n zile lucrătoare de la `zi` (AAAA-LL-ZZ); sâmbăta și duminica nu se numără. */
export function adaugaZileLucratoare(zi: string, n: number): string {
  const d = new Date(`${zi}T12:00:00Z`);
  for (let ramase = Math.max(0, Math.ceil(n)); ramase > 0;) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) ramase--;
  }
  return d.toISOString().slice(0, 10);
}

/** Câte zile lucrătoare sunt după `de` până la `pana` inclusiv. */
export function zileLucratoareIntre(de: string, pana: string): number {
  let n = 0;
  for (let d = new Date(`${de}T12:00:00Z`), t = Date.parse(`${pana}T12:00:00Z`); ;) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getTime() > t) return n;
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
}

export type Estimare = { oreOm: number; zile: number; gata: string; manopera: number | null; factor: number };

export function estimeaza(o: { minBuc: number; bucati: number; operatori: number; orePeZi: number; start: string; costMinut?: number | null }): Estimare | null {
  if (!(o.minBuc > 0 && o.bucati > 0 && o.operatori > 0 && o.orePeZi > 0)) return null;
  const factor = factorLot(o.bucati);
  const oreOm = (o.bucati * o.minBuc / 60) * factor;
  const zile = Math.max(1, Math.ceil(oreOm / (o.operatori * o.orePeZi)));
  return { oreOm, zile, gata: adaugaZileLucratoare(o.start, zile), factor,
           manopera: o.costMinut ? o.bucati * o.minBuc * o.costMinut : null };
}

/** Câți operatori trebuie ca lotul să iasă gata până la termen (în zile lucrătoare de la start). */
export function operatoriNecesari(o: { minBuc: number; bucati: number; orePeZi: number; start: string; termen: string }): number | null {
  const zile = zileLucratoareIntre(o.start, o.termen);
  if (!(o.minBuc > 0 && o.bucati > 0) || zile <= 0) return null;
  return Math.ceil(((o.bucati * o.minBuc / 60) * factorLot(o.bucati)) / (zile * o.orePeZi));
}

export const ore = (h: number) => `${h.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} ore-om`;
export const dataRo = (zi: string) => new Date(`${zi}T12:00:00`).toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'long' });
