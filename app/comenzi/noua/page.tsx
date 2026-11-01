import { nomenclatoareComanda } from '../../lib/comenzi';
import { lipsuriPentruPsc } from '../../lib/magazine';
import { cere } from '../../lib/sesiune';
import FormularComanda from './FormularComanda';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

/**
 * PSF sau PSC nouă: antetul comenzii și, sub el, câte o linie pe produs cu
 * cantitățile pe mărimi — o grilă, ca în sheet, nu șapte câmpuri pe rând.
 */
export default async function ComandaNouaPagina({ searchParams }: { searchParams: Promise<{ tip?: string; din_magazin?: string }> }) {
  const eu = await cere('comenzi', 'modifica');
  const nom = await nomenclatoareComanda();
  const q = await searchParams;
  const tip = q.tip === 'PSF' ? 'PSF' : 'PSC';
  // Cine dă comanda e, de obicei, chiar KAM-ul ei.
  const kamImplicit = eu.roluri.includes('kam') ? eu.id : '';
  // PSC din ce lipsește ca să plece comenzile deschise ale unui magazin Shopify.
  const lipsuri = q.din_magazin ? await lipsuriPentruPsc(q.din_magazin) : null;
  const azi = new Date().toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest' });
  return (
    <FormularComanda {...nom} kamImplicit={kamImplicit} tipImplicit={lipsuri ? 'PSC' : tip}
      brandImplicit={lipsuri?.brand_id} liniiInitiale={lipsuri?.linii}
      observatiiImplicite={lipsuri ? `Din comenzile ${lipsuri.brand} care așteaptă stoc, ${azi}: ${lipsuri.bucati} buc${lipsuri.necunoscute ? ` (+${lipsuri.necunoscute} buc pe variante fără produs în catalog)` : ''}.` : undefined} />
  );
}
