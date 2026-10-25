import Link from 'next/link';

const ECRANE: [string, string, string][] = [
  ['/centralizator', 'Centralizator', 'toate liniile PSF și PSC: cerut, planificat, croit, intrat'],
  ['/comenzi/noua', 'Comandă nouă', 'PSF sau PSC, cu grila de mărimi'],
  ['/modele', 'Modele și rețete', 'consumul pe bucată și materialul fiecărei culori'],
  ['/stoc', 'Stoc materiale', 'stoc, rezervat, disponibil, de aprovizionat; intrări de la furnizor'],
  ['/inventar', 'Inventar', 'numărătoare fizică; diferențele devin ajustări'],
  ['/materiale', 'Materiale', 'materii prime și accesorii'],
  ['/comenzi', 'Poziții deschise', 'progresul fiecărei poziții'],
  ['/scanare', 'Recepție', 'scanează o etichetă, pe telefon'],
];

export default function Acasa() {
  return (
    <main>
      <h1>OctogonApp</h1>
      <ul className="meniu">
        {ECRANE.map(([href, nume, ce]) => (
          <li key={href}>
            <Link href={href}>{nume}</Link> <span className="slab">— {ce}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
