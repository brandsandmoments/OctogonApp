/**
 * Perioadele după care se grupează listele: săptămână (luni–duminică), lună,
 * trimestru, an. Zilele sunt text YYYY-MM-DD, calculate la prânz UTC, ca o oră de
 * vară să nu mute ziua.
 */

/** Lunea săptămânii unei date, ca text YYYY-MM-DD. */
export function luni(zi: string): string {
  const d = new Date(`${zi}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function adaugaZile(zi: string, n: number): string {
  const d = new Date(`${zi}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const PERIOADE = { saptamana: 'Săptămână', luna: 'Lună', trimestru: 'Trimestru', an: 'An' } as const;
export type TipPerioada = keyof typeof PERIOADE;
export type Perioada = { tip: TipPerioada; de_la: string; pana_la: string; nume: string };

const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august',
  'septembrie', 'octombrie', 'noiembrie', 'decembrie'];

/** Perioada de tipul ales care conține ziua, cu un nume de citit. */
export function perioada(tip: TipPerioada, zi: string): Perioada {
  if (tip === 'saptamana') {
    const l = luni(zi);
    return { tip, de_la: l, pana_la: adaugaZile(l, 6), nume: `${l} – ${adaugaZile(l, 6)}` };
  }
  const [an, luna] = zi.split('-').map(Number);
  const prima = tip === 'an' ? 1 : tip === 'trimestru' ? Math.floor((luna - 1) / 3) * 3 + 1 : luna;
  const cate = tip === 'an' ? 12 : tip === 'trimestru' ? 3 : 1;
  const de_la = `${an}-${String(prima).padStart(2, '0')}-01`;
  const urm = new Date(Date.UTC(an, prima - 1 + cate, 1, 12));
  const pana_la = adaugaZile(urm.toISOString().slice(0, 10), -1);
  const nume = tip === 'an' ? String(an)
    : tip === 'trimestru' ? `T${(prima - 1) / 3 + 1} ${an}`
    : `${LUNI[prima - 1]} ${an}`;
  return { tip, de_la, pana_la, nume };
}

/** Perioada dinainte (-1) sau următoare (+1). */
export const vecina = (p: Perioada, pas: -1 | 1) =>
  perioada(p.tip, pas < 0 ? adaugaZile(p.de_la, -1) : adaugaZile(p.pana_la, 1));


export type Grupa<T> = { perioada: Perioada; randuri: T[] };

/**
 * Împarte o listă pe perioade, după ziua fiecărui rând; cele mai noi perioade sus.
 * Rândurile fără zi ajung la coadă, într-o grupă „fără dată".
 */
export function grupeaza<T>(lista: T[], zi: (r: T) => string | null, tip: TipPerioada): Grupa<T>[] {
  const pe = new Map<string, Grupa<T>>();
  const fara: T[] = [];
  for (const r of lista) {
    const z = zi(r);
    if (!z) { fara.push(r); continue; }
    const p = perioada(tip, z.slice(0, 10));
    const g = pe.get(p.de_la) ?? { perioada: p, randuri: [] };
    g.randuri.push(r);
    pe.set(p.de_la, g);
  }
  const grupe = [...pe.values()].sort((a, b) => b.perioada.de_la.localeCompare(a.perioada.de_la));
  if (fara.length) grupe.push({ perioada: { tip, de_la: '', pana_la: '', nume: 'fără dată' }, randuri: fara });
  return grupe;
}

/**
 * Gruparea din adresă: `?grupare=luna`; `?grupare=fara` înseamnă fără grupare.
 * Fără parametru, gruparea implicită a listei — unele liste pornesc grupate.
 */
export const grupareDinAdresa = (g?: string, implicit: TipPerioada | '' = ''): TipPerioada | '' =>
  g === undefined || g === '' ? implicit : g in PERIOADE ? (g as TipPerioada) : '';
