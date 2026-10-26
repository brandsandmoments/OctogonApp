'use server';

import { cere } from '../../lib/sesiune';
import { creeazaComanda, type ComandaNoua, type RezultatComanda } from '../../lib/comenzi';

export async function salveazaComanda(cmd: ComandaNoua): Promise<RezultatComanda> {
  await cere('comenzi', 'modifica');
  return creeazaComanda(cmd);
}
