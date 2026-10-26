import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ROLURI, ZONE, type Rol } from '../lib/acces';
import { adaugaOm, dispozitive, inregistreazaDispozitiv, oameni, revocaDispozitiv } from '../lib/oameni';
import { cere, COOKIE_DISPOZITIV } from '../lib/sesiune';
import '../formulare.css';

export const dynamic = 'force-dynamic';

async function adauga(date: FormData) {
  'use server';
  await cere('oameni', 'modifica');
  const e = await adaugaOm(String(date.get('nume') ?? ''), String(date.get('email') ?? ''), date.getAll('rol').map(String));
  redirect(e ? `/oameni?eroare=${encodeURIComponent(e)}` : '/oameni');
}

async function inregistreaza(date: FormData) {
  'use server';
  const eu = await cere('oameni', 'modifica');
  const token = await inregistreazaDispozitiv(String(date.get('nume') ?? ''), eu.id);
  // Tokenul stă doar în cookie-ul acestui browser, un an. Dacă tableta se pierde,
  // dispozitivul se revocă de aici și tokenul nu mai deschide nimic.
  (await cookies()).set(COOKIE_DISPOZITIV, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 365 * 24 * 3600,
  });
  redirect('/oameni?dispozitiv=1');
}

async function revoca(date: FormData) {
  'use server';
  await cere('oameni', 'modifica');
  await revocaDispozitiv(String(date.get('id')));
  redirect('/oameni');
}

/** Oamenii firmei, conturile lor și dispozitivele de atelier. Doar pentru admin. */
export default async function Oameni({
  searchParams,
}: {
  searchParams: Promise<{ eroare?: string; dispozitiv?: string; toti?: string }>;
}) {
  await cere('oameni');
  const [{ eroare, dispozitiv, toti }, totiOamenii, disp] = await Promise.all([searchParams, oameni(), dispozitive()]);
  // Dezactivații nu apar implicit: istoricul lor rămâne, dar nu mai sunt în lucru.
  const lista = toti ? totiOamenii : totiOamenii.filter((o) => o.activ);
  const dezactivati = totiOamenii.length - totiOamenii.filter((o) => o.activ).length;
  const aici = Boolean((await cookies()).get(COOKIE_DISPOZITIV));

  return (
    <main className="formular lat">
      <h1>Oameni și conturi</h1>
      <p className="sumar">
        {lista.filter((o) => o.activ).length} activi · {lista.filter((o) => o.are_parola || o.are_pin).length} cu cont
        {dezactivati > 0 && <> · <Link href={toti ? '/oameni' : '/oameni?toti=1'}>{toti ? 'doar activii' : `arată și cei ${dezactivati} dezactivați`}</Link></>}
      </p>
      {eroare && <p className="eroare">{eroare}</p>}

      <div className="tabel-derulant">
        <table>
          <thead><tr><th>Nume</th><th>Email</th><th>Roluri</th><th>Drepturi</th><th>Intră cu</th><th /></tr></thead>
          <tbody>
            {lista.map((o) => (
              <tr key={o.id} className={o.activ ? '' : 'slab'}>
                <td><Link href={`/oameni/${o.id}`}>{o.nume}</Link>{!o.activ && ' · dezactivat'}</td>
                <td className="slab">{o.email ?? '—'}</td>
                <td>{o.roluri.map((r) => ROLURI[r as Rol] ?? r).join(', ') || <span className="slab">—</span>}</td>
                <td className="slab">
                  {o.roluri.includes('admin') ? 'tot'
                    : Object.entries(o.drepturi).map(([z, n]) => `${ZONE[z as keyof typeof ZONE] ?? z}${n === 'vede' ? ' (vede)' : ''}`).join(', ') || '—'}
                </td>
                <td>
                  {[o.are_parola && 'parolă', o.are_pin && 'PIN'].filter(Boolean).join(' + ') || <span className="slab">fără cont</span>}
                  {o.blocat && <span className="lipsa"> · blocat</span>}
                </td>
                <td><Link href={`/oameni/${o.id}`}>Modifică</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Om nou</h2>
      <form action={adauga} className="antet-comanda">
        <label><span>Nume</span><input name="nume" required /></label>
        <label><span>Email (pentru logare cu parolă)</span><input name="email" type="email" /></label>
        <fieldset className="lat roluri">
          <legend>Roluri</legend>
          {Object.entries(ROLURI).map(([k, v]) => (
            <label key={k}><input type="checkbox" name="rol" value={k} /> {v}</label>
          ))}
        </fieldset>
        <div className="actiuni"><button className="principal">Adaugă</button></div>
      </form>

      <h2>Dispozitive de atelier</h2>
      <p className="slab">
        Pe un dispozitiv înregistrat, oamenii de atelier (croit, bandă, depozit) intră alegându-și numele și
        bagă PIN-ul. Înregistrarea se face de pe dispozitivul însuși: intri pe el ca admin și apeși butonul de mai jos.
      </p>
      {dispozitiv && <p className="ok">Acest browser e acum dispozitiv de atelier. La ieșire, se deschide logarea cu PIN.</p>}
      {aici
        ? <p className="slab">Acest browser e deja înregistrat ca dispozitiv de atelier.</p>
        : (
          <form action={inregistreaza} className="antet-comanda">
            <label><span>Numele dispozitivului</span><input name="nume" placeholder="Tableta croit" required /></label>
            <div className="actiuni"><button className="secundar">Înregistrează acest browser</button></div>
          </form>
        )}
      {disp.length > 0 && (
        <table>
          <tbody>
            {disp.map((d) => (
              <tr key={d.id} className={d.revocat ? 'slab' : ''}>
                <td>{d.nume}</td>
                <td className="slab">{d.inregistrat_la}</td>
                <td>{d.revocat ? 'revocat' : (
                  <form action={revoca}><input type="hidden" name="id" value={d.id} /><button className="mic">Revocă</button></form>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
