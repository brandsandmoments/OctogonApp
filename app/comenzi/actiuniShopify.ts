'use server';

import { cere, interogare } from '../lib/sesiune';
import { sincronizeaza } from '../lib/shopify';

/**
 * „Adu produsele noi din Shopify", la un clic, din Comenzi: citește produsele (active și ciorne)
 * din toate magazinele și creează în catalog ce lipsește, ca să se poată da PSF/PSC pe ele.
 */
export async function aduProduseShopify(): Promise<{ ok: boolean; mesaj: string }> {
  await cere('comenzi', 'modifica');
  const numara = async () => (await interogare<{ n: number }>(`SELECT count(*)::int AS n FROM produs`))[0].n;
  const inainte = await numara();
  const rez = await sincronizeaza(undefined, ['produse']);
  const noi = (await numara()) - inainte;
  const erori = rez.filter((r) => r.eroare && r.eroare !== 'nelegat').map((r) => `${r.magazin}: ${r.eroare}`);
  if (erori.length) return { ok: false, mesaj: `Nu s-au putut citi toate magazinele — ${erori.join(' · ')}` };
  if (!rez.some((r) => !r.eroare)) return { ok: false, mesaj: 'Niciun magazin Shopify nu e legat (Magazine → Legături).' };
  const variante = rez.reduce((s, r) => s + (r.variante ?? 0), 0);
  return {
    ok: true,
    mesaj: `${noi ? `${noi} ${noi === 1 ? 'produs nou adus' : 'produse noi aduse'}` : 'Niciun produs nou'} din Shopify (${variante} variante verificate în ${rez.filter((r) => !r.eroare).length} magazine).`,
  };
}
