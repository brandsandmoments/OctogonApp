/**
 * Primul admin: cel care dă apoi conturi tuturor celorlalți, din „Oameni și conturi".
 *
 *   npm run cont:admin -- --email ana@octogonfashion.com --nume "Ana Popescu"
 *
 * Parola se tastează la prompt, ascunsă, nu în comandă: așa nu rămâne în istoricul
 * terminalului. Dacă omul există deja (după email sau nume), primește rolul de admin
 * și parola nouă; altfel se creează. Rulează pe firma din .env (FIRMA_ID).
 */
import { createInterface } from 'node:readline';
import { caFirma, firmaDinMediu } from '../app/lib/db.ts';

function argument(nume: string): string | undefined {
  const i = process.argv.indexOf(`--${nume}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Citește o linie fără s-o afișeze. Fără terminal (rulat din alt program), citește normal. */
function parolaAscunsa(intrebare: string): Promise<string> {
  return new Promise((ok) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const scrie = (rl as unknown as { _writeToOutput: (s: string) => void });
    let ascuns = false;
    scrie._writeToOutput = (s: string) => { if (!ascuns || s.includes(intrebare)) process.stdout.write(s); };
    rl.question(intrebare, (r) => { rl.close(); process.stdout.write('\n'); ok(r); });
    ascuns = true;
  });
}

const email = argument('email')?.trim().toLowerCase();
const nume = argument('nume')?.trim();
if (!email || !nume) {
  console.error('Folosire: npm run cont:admin -- --email <email> --nume "<Nume Prenume>"');
  process.exit(1);
}

const parola = process.env.PAROLA_ADMIN_NOUA ?? await parolaAscunsa('Parola (cel puțin 10 caractere): ');
if (!process.env.PAROLA_ADMIN_NOUA) {
  const din_nou = await parolaAscunsa('Încă o dată: ');
  if (din_nou !== parola) { console.error('Parolele nu se potrivesc.'); process.exit(1); }
}

await caFirma(firmaDinMediu(), async (c) => {
  const { rows: [u] } = await c.query<{ id: string }>(
    `INSERT INTO utilizator (firma_id, nume, email, roluri) VALUES (firma_curenta(), $1, $2::citext, '{admin}')
     ON CONFLICT (firma_id, nume) DO UPDATE
        SET email = EXCLUDED.email, activ = true,
            roluri = (SELECT array_agg(DISTINCT r) FROM unnest(utilizator.roluri || '{admin}'::rol[]) r)
     RETURNING id`, [nume, email]);
  await c.query(`SELECT cont_seteaza_parola($1, $2)`, [u.id, parola]);
});
console.log(`Gata: ${nume} (${email}) e admin și poate intra cu parola.`);
process.exit(0);
