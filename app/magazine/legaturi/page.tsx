import Link from 'next/link';
import { redirect } from 'next/navigation';
import { magazine } from '../../lib/magazine';
import { cere } from '../../lib/sesiune';
import { shopifyConfigurat, sincronizeaza } from '../../lib/shopify';
import '../magazine.css';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

async function sincronizeazaAcum(date: FormData) {
  'use server';
  await cere('oameni');
  const rez = await sincronizeaza(String(date.get('magazin') ?? '') || undefined);
  const erori = rez.filter((r) => r.eroare && r.eroare !== 'nelegat').map((r) => `${r.magazin}: ${r.eroare}`);
  const ok = rez.filter((r) => !r.eroare).map((r) => `${r.magazin}: ${r.variante} variante, ${r.comenzi} comenzi deschise`);
  redirect(`/magazine/legaturi?${erori.length ? `eroare=${encodeURIComponent(erori.join(' · '))}` : `sincronizat=${encodeURIComponent(ok.join(' · ') || 'niciun magazin legat')}`}`);
}

/**
 * Legarea magazinelor Shopify, doar pentru conturile master: pentru fiecare brand se
 * scrie domeniul .myshopify.com și se instalează aplicația Octogon pe magazin.
 * După instalare, comenzile și stocul vin singure (webhook-uri + sincronizare noaptea).
 */
export default async function Legaturi({ searchParams }: { searchParams: Promise<{ eroare?: string; legat?: string; sincronizat?: string }> }) {
  await cere('oameni');
  const f = await searchParams;
  const lista = await magazine();
  const configurat = lista.some((m) => shopifyConfigurat(m.cod));

  return (
    <main className="lat legaturi">
      <p className="slab"><Link href="/magazine">← Comenzi din magazine</Link></p>
      <h1>Legături Shopify</h1>
      <p className="sumar">
        Fiecare brand are magazinul lui. Scrie domeniul .myshopify.com și apasă „Instalează": Shopify cere aprobarea, apoi
        produsele, stocul și comenzile deschise vin în aplicație și rămân la zi singure.
      </p>
      {f.eroare && <p className="eroare">{f.eroare}</p>}
      {f.legat && <p className="mesaj-ok">Legat: {f.legat}. Prima sincronizare s-a făcut.</p>}
      {f.sincronizat && <p className="mesaj-ok">Sincronizat — {f.sincronizat}</p>}
      {!configurat && (
        <p className="eroare">
          Aplicația Shopify nu e configurată încă pe server: lipsesc SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_CHEIE sau
          APP_URL din .env. Vezi docs/shopify.md.
        </p>
      )}
      <div className="tabel-derulant">
        <table>
          <thead><tr><th>Brand</th><th>Magazin</th><th>Stare</th><th>Ultima sincronizare</th><th /></tr></thead>
          <tbody>
            {lista.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.brand}</strong> <span className="slab">{m.cod}</span></td>
                <td>
                  <form action="/shopify/instaleaza" method="get">
                    <input type="hidden" name="magazin" value={m.id} />
                    <input name="domeniu" defaultValue={m.domeniu ?? ''} placeholder="magazin.myshopify.com" required disabled={!shopifyConfigurat(m.cod)} />
                    <button disabled={!shopifyConfigurat(m.cod)}>{m.legat ? 'Reinstalează' : 'Instalează'}</button>
                  </form>
                </td>
                <td>{m.legat ? <span className="insigna verde">legat</span> : m.sincronizat_la ? <span className="insigna albastru">din .env</span> : <span className="insigna gri">nelegat</span>}</td>
                <td className="slab">{m.sincronizat_la ?? '—'}</td>
                <td>
                  <form action={sincronizeazaAcum}>
                    <input type="hidden" name="magazin" value={m.id} />
                    <button>Sincronizează acum</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
