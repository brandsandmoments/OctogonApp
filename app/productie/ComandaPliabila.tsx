'use client';

import { useRouter } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';

/**
 * O comandă din plan care își aduce conținutul abia la deschidere: pagina trimite doar
 * rândurile de sumar (sute de comenzi), iar culorile, mărimile și cine lucrează vin de
 * pe server pentru comanda deschisă (`deschis` în adresă). Deschiderea e tot clicul pe
 * rând, ca la orice listă în cascadă.
 */
export default function ComandaPliabila({ id, href, deschis, sumar, children }: {
  id: string; href: string; deschis: boolean; sumar: ReactNode; children?: ReactNode;
}) {
  const router = useRouter();
  const [seIncarca, porneste] = useTransition();
  return (
    <details key={String(deschis)} id={id} className="comanda-productie" open={deschis}
      onToggle={(e) => { if (e.currentTarget.open && !deschis) porneste(() => router.push(href, { scroll: false })); }}>
      <summary>{sumar}</summary>
      {deschis ? children : seIncarca && <p className="slab se-incarca">Se deschide…</p>}
    </details>
  );
}
