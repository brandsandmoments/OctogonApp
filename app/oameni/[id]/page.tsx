import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ROLURI, ZONE, type Drepturi } from '../../lib/acces';
import { actualizeazaOm, oameni, seteazaDrepturi, seteazaParola, seteazaPin } from '../../lib/oameni';
import { cere } from '../../lib/sesiune';
import '../../formulare.css';

export const dynamic = 'force-dynamic';

function inapoi(id: string, eroare: string | null, ok?: string): never {
  const q = eroare ? `?eroare=${encodeURIComponent(eroare)}` : ok ? `?ok=${encodeURIComponent(ok)}` : '';
  redirect(`/oameni/${id}${q}`);
}

/**
 * Un om: datele, rolurile, parola și PIN-ul. Parola și PIN-ul se scriu, nu se
 * citesc — aplicația nu le vede niciodată, nici adminul.
 */
export default async function OmPagina({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eroare?: string; ok?: string }>;
}) {
  await cere('oameni');
  const [{ id }, { eroare, ok }] = await Promise.all([params, searchParams]);
  const o = (await oameni()).find((x) => x.id === id);
  if (!o) notFound();

  async function date(f: FormData) {
    'use server';
    const eu = await cere('oameni', 'modifica');
    const e = await actualizeazaOm(eu.id, id, {
      nume: String(f.get('nume') ?? ''), email: String(f.get('email') ?? ''),
      roluri: f.getAll('rol').map(String), activ: f.get('activ') === '1',
    });
    if (!e) {
      const drepturi: Drepturi = {};
      for (const z of Object.keys(ZONE) as (keyof typeof ZONE)[]) {
        const v = f.get(`drept:${z}`);
        if (v === 'vede' || v === 'modifica') drepturi[z] = v;
      }
      await seteazaDrepturi(id, drepturi);
    }
    inapoi(id, e, 'Salvat.');
  }
  async function parola(f: FormData) {
    'use server';
    await cere('oameni', 'modifica');
    inapoi(id, await seteazaParola(id, String(f.get('parola') ?? '')), 'Parola e setată. Sesiunile vechi s-au închis.');
  }
  async function pin(f: FormData) {
    'use server';
    await cere('oameni', 'modifica');
    inapoi(id, await seteazaPin(id, String(f.get('pin') ?? '')), 'PIN-ul e setat.');
  }

  return (
    <main className="formular">
      <p className="slab"><Link href="/oameni">← Oameni</Link></p>
      <h1>{o.nume}</h1>
      <p className="sumar">
        {[o.are_parola && 'intră cu parolă', o.are_pin && 'intră cu PIN'].filter(Boolean).join(' · ') || 'fără cont'}
        {o.blocat && ' · blocat după încercări greșite (se deblochează la o parolă/PIN nou sau după 15 minute)'}
        {o.sesiuni > 0 && ` · ${o.sesiuni} sesiuni deschise`}
      </p>
      {eroare && <p className="eroare">{eroare}</p>}
      {ok && <p className="ok">{ok}</p>}

      <form action={date} className="antet-comanda">
        <label><span>Nume</span><input name="nume" defaultValue={o.nume} required /></label>
        <label><span>Email</span><input name="email" type="email" defaultValue={o.email ?? ''} /></label>
        <fieldset className="lat roluri">
          <legend>Roluri</legend>
          {Object.entries(ROLURI).map(([k, v]) => (
            <label key={k}><input type="checkbox" name="rol" value={k} defaultChecked={o.roluri.includes(k)} /> {v}</label>
          ))}
        </fieldset>
        <label className="lat bifa-linie"><input type="checkbox" name="activ" value="1" defaultChecked={o.activ} /> Activ (un om dezactivat nu mai poate intra)</label>
        <fieldset className="lat drepturi">
          <legend>Drepturi {o.roluri.includes('admin') && <span className="slab">— contul master poate tot, oricum</span>}</legend>
          <table>
            <thead><tr><th>Zonă</th><th>Nimic</th><th>Vede</th><th>Modifică</th></tr></thead>
            <tbody>
              {Object.entries(ZONE).map(([z, nume]) => {
                const are = o.drepturi[z as keyof typeof ZONE] ?? '';
                return (
                  <tr key={z}>
                    <td>{nume}</td>
                    {['', 'vede', 'modifica'].map((n) => (
                      <td key={n}><input type="radio" name={`drept:${z}`} value={n} defaultChecked={are === n}
                        aria-label={`${nume}: ${n || 'nimic'}`} /></td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </fieldset>
        <div className="actiuni"><button className="principal">Salvează</button></div>
      </form>

      <h2>Parolă (birou)</h2>
      <form action={parola} className="antet-comanda">
        <label><span>Parolă nouă, cel puțin 10 caractere</span><input name="parola" type="password" autoComplete="new-password" minLength={10} required /></label>
        <div className="actiuni"><button className="secundar">Setează parola</button></div>
      </form>
      {!o.email && <p className="slab">Pentru parolă, omul are nevoie întâi de email: cu parolă se intră pe email.</p>}

      <h2>PIN (atelier)</h2>
      <form action={pin} className="antet-comanda">
        <label><span>PIN nou, 4–6 cifre</span><input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,6}" autoComplete="off" required /></label>
        <div className="actiuni"><button className="secundar">Setează PIN-ul</button></div>
      </form>
      <p className="slab">PIN-ul merge doar pe dispozitivele de atelier ale firmei, pentru rolurile de croit, bandă și depozit.</p>
    </main>
  );
}
