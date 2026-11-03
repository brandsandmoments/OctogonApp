import Link from 'next/link';

export type FilaProductie = 'plan' | 'mostre' | 'predate';

/**
 * Producția are trei file: planul pe săptămâni (de acolo se dă în lucru, se
 * reprioritizează și se trece cine lucrează), mostrele croite și ce a ieșit gata.
 */
export default function FileProductie({ activ }: { activ: FilaProductie }) {
  const file: [FilaProductie, string, string][] = [
    ['plan', '/productie', '1 · Plan pe săptămâni'],
    ['mostre', '/productie/mostre', '2 · Mostre'],
    ['predate', '/banda?vedere=predate', '3 · Terminate (ieșite gata)'],
  ];
  return (
    <nav className="file">
      {file.map(([k, href, nume]) => (
        <Link key={k} href={href} className={k === activ ? 'activ' : ''}>{nume}</Link>
      ))}
    </nav>
  );
}
