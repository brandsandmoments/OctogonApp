/**
 * Cine ce poate. Fiecare zonă are două niveluri: „vede" și „modifică" (care îl
 * include pe „vede"). Drepturile sunt pe om (tabela `drept`, 0013); adminul —
 * contul master — poate tot, fără drepturi scrise.
 *
 * Verificarea stă pe server, la fiecare pagină (`cere(zona)`) și la fiecare
 * acțiune (`cere(zona, 'modifica')`), în sesiune.ts. Meniul și butoanele ascunse
 * doar scutesc omul de un clic care oricum ar fi refuzat.
 */

export const ROLURI = {
  kam: 'KAM',
  head_of_sales: 'Head of sales',
  planificator: 'Manager producție',
  croit: 'Șef croit',
  operator_croit: 'Operator croit',
  banda: 'Șef bandă',
  depozit: 'Gestionar depozit',
  dezvoltare: 'Dezvoltare produs',
  admin: 'Admin (cont master)',
} as const;
export type Rol = keyof typeof ROLURI;

export const ZONE = {
  comenzi: 'Comenzi PSF și PSC',
  centralizator: 'Centralizator',
  kam: 'Eficiența KAM',
  necesar: 'Necesar materiale și rețete',
  planificare: 'Planificare',
  croit: 'Croit',
  banda: 'Bandă (alimentare)',
  receptie: 'Recepție în depozit (scanare, etichete)',
  materiale: 'Gestiune materii prime (stoc, intrări, inventar)',
  dezvoltare: 'Dezvoltare produs',
  expediere: 'Expediere',
} as const;
export type Zona = keyof typeof ZONE | 'oameni';
export type Nivel = 'vede' | 'modifica';

export type Drepturi = Partial<Record<keyof typeof ZONE, Nivel>>;

export type Cine = { roluri: readonly string[]; drepturi: Drepturi };

export const esteAdmin = (c: Cine) => c.roluri.includes('admin');

/** Poate omul face asta în zonă? „modifică" îl include pe „vede". */
export function poate(c: Cine, zona: Zona, nivel: Nivel = 'vede'): boolean {
  if (esteAdmin(c)) return true;
  if (zona === 'oameni') return false;
  const are = c.drepturi[zona];
  return are === 'modifica' || (are === 'vede' && nivel === 'vede');
}

export type Ecran = { href: string; nume: string; ce: string; zona: Zona | Zona[]; nivel?: Nivel };

/**
 * Meniul, pe secțiuni — drumul unei comenzi: KAM-ul o dă (Comenzi), producția o
 * face (Asigură stoc: centralizator, planificare, croit, bandă), depozitul o
 * primește (Depozit produse finite). Fiecare secțiune își arată ecranele ca
 * file, ca să nu se umple meniul de taburi.
 *
 * `si` sunt adresele care țin de secțiune fără să fie în file (necesarul unei
 * comenzi, coala de etichete).
 */
export const SECTIUNI: { nume: string; ecrane: Ecran[]; si?: string[] }[] = [
  {
    nume: 'Comenzi',
    ecrane: [
      { href: '/comenzi', nume: 'PSF și PSC', ce: 'comenzile date: punere pe stoc din forecast și din comanda clientului', zona: 'comenzi' },
      { href: '/comenzi/noua', nume: 'Comandă nouă', ce: 'PSF sau PSC, cu grila de mărimi', zona: 'comenzi', nivel: 'modifica' },
    ],
  },
  {
    nume: 'Asigură stoc',
    ecrane: [
      { href: '/centralizator', nume: 'Centralizator', ce: 'toate comenzile și stadiul lor: necroite, croite, în lucru, gata', zona: 'centralizator' },
      { href: '/planificare', nume: 'Planificare', ce: 'necesarul, gruparea pe model și trimiterea la croit', zona: 'planificare' },
      { href: '/croit', nume: 'Croit', ce: 'ce e de croit, ce s-a croit, ce a rămas', zona: 'croit' },
      { href: '/banda', nume: 'Bandă', ce: 'alimentarea benzii; în lucru și terminate', zona: 'banda' },
    ],
    si: ['/necesar'],
  },
  {
    nume: 'Depozit produse finite',
    ecrane: [
      { href: '/depozit', nume: 'Comenzi de stins', ce: 'PSF-urile și PSC-urile așteptate: de stins, finalizate, toate', zona: 'receptie' },
      { href: '/scanare', nume: 'Scanare', ce: 'scanează eticheta: ce a venit fizic, pe PSF-ul sau PSC-ul lui', zona: 'receptie', nivel: 'modifica' },
    ],
    si: ['/etichete'],
  },
  {
    nume: 'Eficiență',
    ecrane: [
      { href: '/kam', nume: 'KAM', ce: 'PSF-urile fiecărui KAM față de vânzările din Shopify: săptămână, lună, trimestru, an', zona: 'kam' },
      { href: '/eficienta/asigura-stoc', nume: 'Asigură stoc', ce: 'livrat la timp, mai devreme, cu întârziere; bucăți la termen și ce nu mai vine', zona: ['centralizator', 'kam'] },
    ],
  },
  {
    nume: 'Dezvoltare produs',
    ecrane: [
      { href: '/dezvoltare', nume: 'Dezvoltare produs', ce: 'tipare de făcut, în lucru, mostre gata de aprobat', zona: ['dezvoltare', 'comenzi'] },
    ],
  },
  {
    nume: 'Materii prime',
    ecrane: [
      { href: '/stoc', nume: 'Stoc', ce: 'stoc, rezervat, disponibil, de aprovizionat; intrări de la furnizor', zona: 'materiale' },
      { href: '/stoc/cumparaturi', nume: 'Lista de cumpărături', ce: 'ce lipsește din stoc, pe furnizori: materii prime și accesorii', zona: ['materiale', 'necesar', 'planificare'] },
      { href: '/inventar', nume: 'Inventar', ce: 'numărătoare fizică; diferențele devin ajustări', zona: 'materiale' },
      { href: '/modele', nume: 'Modele și rețete', ce: 'consumul pe bucată și materialul fiecărei culori', zona: 'necesar' },
      { href: '/materiale', nume: 'Materiale', ce: 'nomenclatorul de materii prime și accesorii', zona: 'necesar' },
    ],
  },
  {
    nume: 'Oameni și conturi',
    ecrane: [
      { href: '/oameni', nume: 'Oameni și conturi', ce: 'conturi, drepturi, parole, PIN-uri, tablete de atelier', zona: 'oameni' },
    ],
  },
];

export const poateDeschide = (c: Cine, e: Ecran) =>
  (Array.isArray(e.zona) ? e.zona : [e.zona]).some((z) => poate(c, z, e.nivel));

/** Meniul omului: doar secțiunile și ecranele pe care le poate deschide. */
export function meniulLui(c: Cine) {
  return SECTIUNI
    .map((s) => ({ ...s, ecrane: s.ecrane.filter((e) => poateDeschide(c, e)) }))
    .filter((s) => s.ecrane.length > 0);
}
