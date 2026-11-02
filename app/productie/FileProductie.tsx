import Link from 'next/link';
import { deAlimentat, transeSimple } from '../lib/banda';

export type FilaProductie = 'plan' | 'banda' | 'predate';

/**
 * Drumul producției, aceleași file pe planul pe săptămâni și pe bandă, ca să se
 * treacă dintr-una în alta dintr-un clic: întâi se planifică, apoi banda (ce s-a
 * croit se dă pe bandă, cine lucrează pe ce a intrat), apoi e terminat.
 */
export default async function FileProductie({ activ }: { activ: FilaProductie }) {
  const [loturi, pe] = await Promise.all([deAlimentat(), transeSimple(false)]);
  const buc = loturi.reduce((s, l) => s + l.rest, 0);
  const file: [FilaProductie, string, string][] = [
    ['plan', '/productie', '1 · Plan pe săptămâni'],
    ['banda', '/banda', `2 · Bandă · ${buc} buc de dat în lucru · ${pe.length} în lucru`],
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
