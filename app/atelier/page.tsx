import Link from 'next/link';
import { cookies } from 'next/headers';
import { faraFirma } from '../lib/db';
import { logarePin } from '../lib/logare';
import { COOKIE_DISPOZITIV } from '../lib/sesiune';
import '../formulare.css';

export const dynamic = 'force-dynamic';

/**
 * Logarea din atelier, pe telefonul sau tableta comună: alegi numele, bagi PIN-ul.
 * Doar pe un dispozitiv înregistrat de admin — altfel lista de oameni nu există,
 * iar un PIN de 4 cifre nu e niciodată singura barieră.
 */
export default async function Atelier({ searchParams }: { searchParams: Promise<{ eroare?: string; cine?: string }> }) {
  const { eroare, cine } = await searchParams;
  const dispozitiv = (await cookies()).get(COOKIE_DISPOZITIV)?.value;
  const oameni = dispozitiv
    ? await faraFirma<{ id: string; nume: string; dispozitiv: string }>(`SELECT * FROM dispozitiv_oameni($1)`, [dispozitiv])
    : [];

  if (!dispozitiv || oameni.length === 0) {
    return (
      <main className="formular logare">
        <h1>Atelier</h1>
        <p>
          {dispozitiv
            ? 'Pe acest dispozitiv nu poate intra nimeni încă: niciun om de atelier nu are PIN.'
            : 'Acest telefon sau această tabletă nu e înregistrată ca dispozitiv de atelier.'}
        </p>
        <p className="slab">
          Adminul intră o dată pe el, din <Link href="/login">logarea cu email</Link>, și îl înregistrează din
          „Oameni și conturi”.
        </p>
      </main>
    );
  }

  return (
    <main className="formular logare">
      <h1>Atelier</h1>
      <p className="sumar">{oameni[0].dispozitiv}</p>
      <form action={logarePin}>
        <fieldset className="alege-om">
          <legend>Cine ești?</legend>
          {oameni.map((o) => (
            <label key={o.id}>
              <input type="radio" name="utilizator" value={o.id} required defaultChecked={o.id === cine} />
              {o.nume}
            </label>
          ))}
        </fieldset>
        <label>
          <span>PIN</span>
          <input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,6}" autoComplete="off" required />
        </label>
        {eroare && <p className="eroare">PIN greșit. După 5 încercări contul se blochează 15 minute.</p>}
        <div className="actiuni"><button className="principal">Intră</button></div>
      </form>
      <p className="slab"><Link href="/login">Logare cu email</Link></p>
    </main>
  );
}
