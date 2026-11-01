'use server';

import { poate } from '../../lib/acces';
import { cere } from '../../lib/sesiune';
import { creeazaComanda, type ComandaNoua, type RezultatComanda } from '../../lib/comenzi';

export async function salveazaComanda(cmd: ComandaNoua): Promise<RezultatComanda> {
  const u = await cere('comenzi', 'modifica');
  // PSF-ul unui KAM fără drept de aprobare așteaptă un responsabil; PSC-ul pleacă direct.
  return creeazaComanda({ ...cmd, deAprobat: cmd.tip === 'PSF' && !poate(u, 'aprobare', 'modifica') });
}
