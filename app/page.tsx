import Link from 'next/link';

export default function Acasa() {
  return (
    <main>
      <h1>OctogonApp</h1>
      <p>
        Deocamdată există structura bazei de date și un singur ecran, cel care
        arată ce se vede după o scanare.
      </p>
      <p>
        <Link href="/comenzi">Poziții deschise</Link>
      </p>
    </main>
  );
}
