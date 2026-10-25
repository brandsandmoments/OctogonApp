'use server';

import { creeazaComanda, type ComandaNoua, type RezultatComanda } from '../../lib/comenzi';

export async function salveazaComanda(cmd: ComandaNoua): Promise<RezultatComanda> {
  return creeazaComanda(cmd);
}
