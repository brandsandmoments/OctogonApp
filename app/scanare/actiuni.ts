'use server';

import { cere } from '../lib/sesiune';
import {
  inregistreazaReceptie,
  pozitiaEtichetei,
  type CerereReceptie,
  type PozitieScanata,
  type RezultatReceptie,
} from '../lib/receptie';

export async function cautaEticheta(cod: string): Promise<PozitieScanata | null> {
  await cere('receptie');
  return pozitiaEtichetei(cod);
}

export async function confirmaReceptie(cerere: CerereReceptie): Promise<RezultatReceptie> {
  await cere('receptie', 'modifica');
  return inregistreazaReceptie(cerere);
}
