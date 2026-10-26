import { nomenclatoareComanda } from '../../lib/comenzi';
import { cere } from '../../lib/sesiune';
import FormularComanda from './FormularComanda';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

/**
 * PSF sau PSC nouă: antetul comenzii și, sub el, câte o linie pe produs cu
 * cantitățile pe mărimi — o grilă, ca în sheet, nu șapte câmpuri pe rând.
 */
export default async function ComandaNouaPagina({ searchParams }: { searchParams: Promise<{ tip?: string }> }) {
  const eu = await cere('comenzi', 'modifica');
  const nom = await nomenclatoareComanda();
  const tip = (await searchParams).tip === 'PSF' ? 'PSF' : 'PSC';
  // Cine dă comanda e, de obicei, chiar KAM-ul ei.
  const kamImplicit = eu.roluri.includes('kam') ? eu.id : '';
  return <FormularComanda {...nom} kamImplicit={kamImplicit} tipImplicit={tip} />;
}
