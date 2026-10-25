'use server';

import {
  inregistreazaReceptie,
  pozitiaEtichetei,
  type CerereReceptie,
  type PozitieScanata,
  type RezultatReceptie,
} from '../lib/receptie';

export async function cautaEticheta(cod: string): Promise<PozitieScanata | null> {
  return pozitiaEtichetei(cod);
}

export async function confirmaReceptie(cerere: CerereReceptie): Promise<RezultatReceptie> {
  return inregistreazaReceptie(cerere);
}
