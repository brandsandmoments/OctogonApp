import type { Metadata, Viewport } from 'next';
import { motiveReceptie } from '../lib/receptie';
import Scanare from './Scanare';
import './scanare.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Recepție · OctogonApp' };

// Pe telefon, în depozit: fără zoom accidental când degetul nimerește lângă buton.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1 };

/**
 * Recepția pe telefon: scanezi eticheta, vezi cerut / intrat / lipsesc,
 * aplicația propune restul. Dacă intră mai puțin, cere motivul din listă.
 *
 * Motivele se încarcă o dată, cu pagina: lista e scurtă și se schimbă rar,
 * iar în depozit semnalul e slab — un drum mai puțin la fiecare colet.
 */
export default async function Pagina() {
  const motive = await motiveReceptie();
  return <Scanare motive={motive} />;
}
