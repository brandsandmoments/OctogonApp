import { redirect } from 'next/navigation';

/** Planificarea s-a mutat: o comandă lansată pleacă singură la croit, iar planul e pe săptămâni, în Producție. */
export default function Planificare() {
  redirect('/productie');
}
