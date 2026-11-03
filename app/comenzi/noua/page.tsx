import { nomenclatoareComanda } from '../../lib/comenzi';
import { propunere } from '../../lib/acoperire';
import { lipsuriPentruPsc } from '../../lib/magazine';
import { cere } from '../../lib/sesiune';
import { poate } from '../../lib/acces';
import FormularComanda from './FormularComanda';
import AduDinShopify from '../AduDinShopify';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

/**
 * PSF sau PSC nouă: antetul comenzii și, sub el, câte o linie pe produs cu
 * cantitățile pe mărimi — o grilă, ca în sheet, nu șapte câmpuri pe rând.
 */
export default async function ComandaNouaPagina({ searchParams }: { searchParams: Promise<{ tip?: string; din_magazin?: string; model?: string; din_produs?: string }> }) {
  const eu = await cere('comenzi', 'modifica');
  const nom = await nomenclatoareComanda();
  const q = await searchParams;
  const tip = q.tip === 'PSF' ? 'PSF' : 'PSC';
  // Cine dă comanda e, de obicei, chiar KAM-ul ei.
  const kamImplicit = eu.roluri.includes('kam') ? eu.id : '';
  // PSC din ce lipsește ca să plece comenzile deschise ale unui magazin Shopify.
  const lipsuri = q.din_magazin ? await lipsuriPentruPsc(q.din_magazin, q.model) : null;
  // Pornit din produse sau din alerte: PSF = o lună de vânzări, PSC = ce așteaptă clienții,
  // în ambele cazuri minus stoc și ce e pe drum.
  const psf = !lipsuri && q.din_produs ? await propunere(q.din_produs, q.tip === 'PSC' ? 'PSC' : 'PSF') : null;
  const azi = new Date().toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest' });
  return (
    <>
    {/* Produsul nou din Shopify (și ciornele) se aduce de aici, fără să se piardă ce e scris în formular. */}
    <p className="slab sus-comanda">Nu găsești produsul? <AduDinShopify text="Adu-l din Shopify" /></p>
    <FormularComanda {...nom} kamImplicit={kamImplicit}
      // Câți oameni lucrează alege producția (admin, șef și manager de producție), nu KAM-ul.
      alocaOameni={poate(eu, 'banda', 'modifica') || poate(eu, 'planificare', 'modifica')} tipImplicit={lipsuri ? 'PSC' : psf ? psf.tip : tip}
      brandImplicit={lipsuri?.brand_id ?? psf?.brand_id} liniiInitiale={lipsuri?.linii ?? (psf ? [psf.linie] : undefined)}
      observatiiImplicite={lipsuri
        ? `Din comenzile ${lipsuri.brand} care așteaptă stoc, ${azi}: ${lipsuri.bucati} buc${lipsuri.necunoscute ? ` (+${lipsuri.necunoscute} buc pe variante fără produs în catalog)` : ''}. Scăzut ce e deja în producție sau de aprobat.`
        : psf ? `${psf.tip} din produse/alerte, ${azi}. ${psf.rezumat}` : undefined} />
    </>
  );
}
