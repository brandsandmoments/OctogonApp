import Link from 'next/link';

export type FilaProductie = 'plan' | 'predate';

/**
 * Producția are două file: planul pe săptămâni (de acolo se dă în lucru, se
 * reprioritizează și se trece cine lucrează) și ce a ieșit gata.
 */
export default function FileProductie({ activ }: { activ: FilaProductie }) {
  const file: [FilaProductie, string, string][] = [
    ['plan', '/productie', '1 · Plan pe săptămâni'],
    ['predate', '/banda?vedere=predate', '2 · Terminate (ieșite gata)'],
  ];
  return (
    <nav className="file">
      {file.map(([k, href, nume]) => (
        <Link key={k} href={href} className={k === activ ? 'activ' : ''}>{nume}</Link>
      ))}
    </nav>
  );
}
