'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { aduProduseShopify } from './actiuniShopify';

/** Butonul „Adu produsele noi din Shopify": după el, lista de produse a formularului se reîncarcă (ce e scris rămâne). */
export default function AduDinShopify({ text = 'Adu produsele noi din Shopify' }: { text?: string }) {
  const router = useRouter();
  const [rez, setRez] = useState<{ ok: boolean; mesaj: string } | null>(null);
  const [lucreaza, porneste] = useTransition();
  return (
    <span className="adu-din-shopify">
      <button type="button" className="buton" disabled={lucreaza}
              onClick={() => porneste(async () => { setRez(null); const r = await aduProduseShopify(); setRez(r); router.refresh(); })}>
        {lucreaza ? 'Se citesc magazinele Shopify…' : `↻ ${text}`}
      </button>
      {rez && <span className={rez.ok ? 'mesaj-ok' : 'eroare'}>{rez.mesaj}</span>}
    </span>
  );
}
