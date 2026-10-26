import { redirect } from 'next/navigation';
import { adaugaReferinta, referinte, stergeReferinta } from '../lib/fisa';
import { cere } from '../lib/sesiune';

const inapoi = (id: string, e?: string | null): never =>
  redirect(`/dezvoltare/${id}${e ? `?eroare=${encodeURIComponent(e)}` : ''}#referinte`);

/**
 * Referințele cererii de tipar: linkuri de Drive (clipuri, foldere), observații,
 * poze. O poză cu culoarea aleasă e poza produsului în culoarea aceea și intră în
 * fișa de produs; fără culoare, e o referință (inspirație, detaliu, schiță).
 */
export default async function Referinte({ id, culori, poateAdauga }: { id: string; culori: string[]; poateAdauga: boolean }) {
  const lista = await referinte(id);

  async function link(f: FormData) {
    'use server';
    await cere(['dezvoltare', 'comenzi'], 'modifica');
    inapoi(id, await adaugaReferinta(id, { tip: 'link', url: String(f.get('url') ?? ''), text: String(f.get('text') ?? '') }));
  }
  async function nota(f: FormData) {
    'use server';
    await cere(['dezvoltare', 'comenzi'], 'modifica');
    inapoi(id, await adaugaReferinta(id, { tip: 'nota', text: String(f.get('text') ?? '') }));
  }
  async function poze(f: FormData) {
    'use server';
    await cere(['dezvoltare', 'comenzi'], 'modifica');
    for (const fisier of f.getAll('poza')) {
      if (!(fisier instanceof File) || fisier.size === 0) continue;
      const e = await adaugaReferinta(id, {
        tip: 'poza', fisier: Buffer.from(await fisier.arrayBuffer()), mime: fisier.type,
        text: String(f.get('text') ?? ''), culoare: String(f.get('culoare') ?? ''),
      });
      if (e) inapoi(id, `${fisier.name}: ${e}`);
    }
    inapoi(id);
  }
  async function sterge(f: FormData) {
    'use server';
    await cere(['dezvoltare', 'comenzi'], 'modifica');
    await stergeReferinta(String(f.get('ref')));
    inapoi(id);
  }

  const Sterge = ({ refId }: { refId: string }) => poateAdauga ? (
    <form action={sterge} className="in-rand"><input type="hidden" name="ref" value={refId} /><button aria-label="Șterge">×</button></form>
  ) : null;

  return (
    <section id="referinte">
      <h2>Referințe</h2>
      {lista.length === 0 && <p className="slab">Nicio referință încă: linkuri de Drive, observații, poze.</p>}
      <div className="poze">
        {lista.filter((r) => r.tip === 'poza').map((r) => (
          <figure key={r.id}>
            <a href={`/dezvoltare/poza/${r.id}`} target="_blank" rel="noreferrer">
              {/* Pozele vin din bază, prin rută: next/image n-ar avea ce optimiza. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/dezvoltare/poza/${r.id}`} alt={r.text ?? r.culoare ?? 'referință'} loading="lazy" />
            </a>
            <figcaption>
              {r.culoare ? <strong>{r.culoare}</strong> : <span className="slab">referință</span>}
              {r.text && <span className="slab"> · {r.text}</span>} <Sterge refId={r.id} />
            </figcaption>
          </figure>
        ))}
      </div>
      <ul className="referinte">
        {lista.filter((r) => r.tip !== 'poza').map((r) => (
          <li key={r.id}>
            {r.tip === 'link'
              ? <a href={r.url!} target="_blank" rel="noreferrer">{r.text || r.url}</a>
              : <span>{r.text}</span>}
            <span className="slab"> · {r.cine ?? '—'}, {r.creat_la}</span> <Sterge refId={r.id} />
          </li>
        ))}
      </ul>

      {poateAdauga && (
        <details>
          <summary>Adaugă referințe</summary>
          <form action={link} className="antet-comanda">
            <label><span>Link (Drive, clip video)</span><input name="url" type="url" placeholder="https://drive.google.com/…" required /></label>
            <label><span>Ce e</span><input name="text" placeholder="ex. clip cu mișcarea fustei" /></label>
            <div className="actiuni"><button className="secundar">Adaugă linkul</button></div>
          </form>
          <form action={nota} className="antet-comanda">
            <label className="lat"><span>Observație</span><textarea name="text" rows={2} required /></label>
            <div className="actiuni"><button className="secundar">Adaugă observația</button></div>
          </form>
          <form action={poze} className="antet-comanda">
            <label><span>Poze (până la 8 MB fiecare)</span><input name="poza" type="file" accept="image/*" multiple required /></label>
            <label>
              <span>Poza produsului în culoarea</span>
              <select name="culoare" defaultValue="">
                <option value="">— doar referință —</option>
                {culori.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label><span>Descriere</span><input name="text" placeholder="opțional" /></label>
            <div className="actiuni"><button className="secundar">Încarcă pozele</button></div>
          </form>
        </details>
      )}
    </section>
  );
}
