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

/** Ecranele, cu zona fiecăruia. Pagina principală arată doar ce poate deschide omul. */
export const ECRANE: { href: string; nume: string; ce: string; zona: Zona | Zona[]; nivel?: Nivel }[] = [
  { href: '/centralizator', nume: 'Centralizator', ce: 'toate liniile PSF și PSC: cerut, planificat, croit, bandă, intrat', zona: 'centralizator' },
  { href: '/comenzi/noua', nume: 'Comandă nouă', ce: 'PSF sau PSC, cu grila de mărimi', zona: 'comenzi', nivel: 'modifica' },
  { href: '/comenzi', nume: 'Poziții deschise', ce: 'progresul fiecărei poziții', zona: 'comenzi' },
  { href: '/kam', nume: 'Eficiența KAM', ce: 'săptămânal: PSF-urile fiecărui KAM față de vânzările din Shopify', zona: 'kam' },
  { href: '/planificare', nume: 'Planificare', ce: 'ce intră în producție acum; lansarea spre croit', zona: 'planificare' },
  { href: '/croit', nume: 'Croit', ce: 'toate, croite, rămas de croit; înregistrarea croitului', zona: 'croit' },
  { href: '/banda', nume: 'Bandă', ce: 'loturile croite intră pe bandă; drumul până la depozit', zona: 'banda' },
  { href: '/scanare', nume: 'Recepție', ce: 'scanează eticheta: ce a venit fizic, pe PSF-ul sau PSC-ul lui', zona: 'receptie', nivel: 'modifica' },
  { href: '/stoc', nume: 'Stoc materiale', ce: 'stoc, rezervat, disponibil, de aprovizionat; intrări de la furnizor', zona: 'materiale' },
  { href: '/inventar', nume: 'Inventar', ce: 'numărătoare fizică; diferențele devin ajustări', zona: 'materiale' },
  { href: '/dezvoltare', nume: 'Dezvoltare produs', ce: 'tipare de făcut, în lucru, mostre gata de aprobat', zona: ['dezvoltare', 'comenzi'] },
  { href: '/modele', nume: 'Modele și rețete', ce: 'consumul pe bucată și materialul fiecărei culori', zona: 'necesar' },
  { href: '/materiale', nume: 'Materiale', ce: 'nomenclatorul de materii prime și accesorii', zona: 'necesar' },
  { href: '/oameni', nume: 'Oameni și conturi', ce: 'conturi, drepturi, parole, PIN-uri, tablete de atelier', zona: 'oameni' },
];
