import { nomenclatoareComanda } from '../../lib/comenzi';
import FormularComanda from './FormularComanda';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

/**
 * PSF sau PSC nouă: antetul comenzii și, sub el, câte o linie pe produs cu
 * cantitățile pe mărimi — o grilă, ca în sheet, nu șapte câmpuri pe rând.
 */
export default async function ComandaNouaPagina() {
  const nom = await nomenclatoareComanda();
  return <FormularComanda {...nom} />;
}
