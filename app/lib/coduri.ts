import bwipjs from 'bwip-js/node';

/**
 * Codul tipărit pe etichetă.
 *
 * Serialul e scurt și opac dinadins: numărul comenzii și SKU-ul se tipăresc
 * alături, cu litere, dar nu intră în codul de bare. `psf-ps-oct-67` a fost
 * renumerotat în `psf-ps-oct-97` după ce pornise producția — dacă numărul ar fi
 * fost în cod, toate etichetele tipărite ar fi devenit mincinoase.
 *
 * Alfabetul sare peste I, O, 0 și 1: pe o etichetă mototolită, citită cu ochiul
 * când scannerul refuză, se confundă între ele.
 */
const ALFABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function serialNou(aleator: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 7; i++) {
    s += ALFABET[Math.floor(aleator() * ALFABET.length)];
  }
  return `OCT-${s}`;
}

/**
 * Zona liberă din jurul codului nu e margine estetică, e parte din cod.
 * Fără ea, decodorul nu găsește unde începe desenul: generat cu padding 0,
 * niciunul din cele șase coduri de test n-a putut fi citit. Cu zona liberă,
 * toate șase se citesc din prima.
 */
const ZONA_LIBERA_1D = { paddingwidth: 12, paddingheight: 6 };
const ZONA_LIBERA_QR = { paddingwidth: 4, paddingheight: 4 };

/** Code 128 — îl citește orice scanner, inclusiv cele vechi cu laser roșu. */
export async function code128(text: string): Promise<string> {
  return bwipjs.toSVG({
    bcid: 'code128',
    text,
    height: 12,
    includetext: false,
    backgroundcolor: 'FFFFFF',
    ...ZONA_LIBERA_1D,
  });
}

/**
 * `eclevel` e o opțiune a simbologiei QR: motorul o acceptă, dar tipurile
 * publicate de bwip-js listează doar opțiunile comune tuturor codurilor.
 * O declarăm aici, îngust, în loc să renunțăm la verificarea de tipuri pe tot
 * obiectul — dacă biblioteca o adaugă în tipurile ei, linia asta devine inutilă
 * și se șterge fără să se schimbe nimic altceva.
 */
type OptiuniQR = Parameters<typeof bwipjs.toSVG>[0] & {
  /** Nivelul de corecție a erorilor: L 7%, M 15%, Q 25%, H 30% din cod poate lipsi. */
  eclevel: 'L' | 'M' | 'Q' | 'H';
};

/**
 * QR — camera telefonului îl prinde din orice unghi, și rezistă la mototolit.
 * Nivelul M suportă pierderea a 15% din simbol: o etichetă îndoită sau pătată
 * într-un colț se citește în continuare.
 */
export async function qr(text: string): Promise<string> {
  const optiuni: OptiuniQR = {
    bcid: 'qrcode',
    text,
    eclevel: 'M',
    backgroundcolor: 'FFFFFF',
    ...ZONA_LIBERA_QR,
  };
  return bwipjs.toSVG(optiuni);
}
