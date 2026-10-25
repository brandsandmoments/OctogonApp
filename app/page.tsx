import Link from 'next/link';

export default function Acasa() {
  return (
    <main>
      <h1>OctogonApp</h1>
      <p>
        Deocamdată: pozițiile deschise cu progresul lor, coala de etichete a
        unei comenzi și recepția pe telefon.
      </p>
      <p>
        <Link href="/comenzi">Poziții deschise</Link>
      </p>
      <p>
        <Link href="/scanare">Recepție — scanează o etichetă</Link>
      </p>
    </main>
  );
}
