'use server';

import { poate } from '../../lib/acces';
import { cere } from '../../lib/sesiune';
import { creeazaComanda, type ComandaNoua, type RezultatComanda } from '../../lib/comenzi';

export async function salveazaComanda(cmd: ComandaNoua): Promise<RezultatComanda> {
  const u = await cere('comenzi', 'modifica');
  // PSF-ul sau PSC-ul dat de cineva fără drept de aprobare așteaptă un responsabil (cine are
  // dreptul „Aprobare PSF/PSC"); cine are dreptul îl lansează direct.
  return creeazaComanda({ ...cmd, deAprobat: !poate(u, 'aprobare', 'modifica') });
}
