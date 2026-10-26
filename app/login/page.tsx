import Link from 'next/link';
import { logareParola } from '../lib/logare';
import '../formulare.css';

export const dynamic = 'force-dynamic';

/** Logarea de birou: email și parolă. Atelierul intră de pe tableta lui, cu PIN. */
export default async function Login({ searchParams }: { searchParams: Promise<{ eroare?: string; inapoi?: string }> }) {
  const { eroare, inapoi = '/' } = await searchParams;
  return (
    <main className="formular logare">
      <h1>OctogonApp</h1>
      <form action={logareParola}>
        <input type="hidden" name="inapoi" value={inapoi} />
        <label><span>Email</span><input name="email" type="email" autoComplete="username" required autoFocus /></label>
        <label><span>Parolă</span><input name="parola" type="password" autoComplete="current-password" required /></label>
        {/* Un singur mesaj pentru toate cazurile: cine ghicește nu află dacă emailul există. */}
        {eroare && <p className="eroare">Email sau parolă greșite. După 5 încercări contul se blochează 15 minute.</p>}
        <div className="actiuni"><button className="principal">Intră</button></div>
      </form>
      <p className="slab">În atelier? <Link href="/atelier">Intră cu PIN-ul</Link>, de pe tableta atelierului.</p>
    </main>
  );
}
