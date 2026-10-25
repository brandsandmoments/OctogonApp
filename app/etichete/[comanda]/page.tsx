import { notFound } from 'next/navigation';
import { code128, qr } from '../../lib/coduri';
import { emiteEtichete, etichetele } from '../../lib/etichete';
import './etichete.css';

export const dynamic = 'force-dynamic';

/**
 * Coala de etichete a unei comenzi, gata de tipărit pe A4.
 *
 * Zece etichete pe pagină, 105 x 59,4 mm — A4 împărțit exact în două pe lățime
 * și în cinci pe înălțime, deci coala se taie cu rigla fără să rămână rest.
 *
 * Pe fiecare etichetă, numărul comenzii și SKU-ul se tipăresc cu litere. În codul
 * de bare stă doar serialul: dacă o comandă se renumerotează după ce etichetele
 * sunt deja lipite pe marfă, se corectează în aplicație și codurile rămân bune.
 */
export default async function Coala({
  params,
}: {
  params: Promise<{ comanda: string }>;
}) {
  const { comanda: brut } = await params;
  const comanda = decodeURIComponent(brut);

  await emiteEtichete(comanda);
  const randuri = await etichetele(comanda);
  if (randuri.length === 0) notFound();

  const desene = await Promise.all(
    randuri.map(async (r) => ({
      ...r,
      bare: await code128(r.cod),
      patrat: await qr(r.cod),
    })),
  );

  return (
    <>
      <div className="bara-ecran">
        <strong>{comanda}</strong> · {desene.length} etichete ·{' '}
        {Math.ceil(desene.length / 10)} {desene.length > 10 ? 'pagini' : 'pagină'} A4
        <span>Tipărește la 100%, fără „scale to fit" — altfel codurile nu se mai citesc.</span>
      </div>

      <div className="coala">
        {desene.map((r) => (
          <article className="eticheta" key={r.cod}>
            <div className="text">
              <h2>{r.produs}</h2>
              <p className="sku">{r.cod_sku}</p>
              <p className="marime">
                Mărimea {r.marime}
                {r.marime_numerica && <span> · {r.marime_numerica}</span>}
                <span> · cerut {r.cerut} buc</span>
              </p>
              <p className="comanda">
                {r.comanda} <span>{r.tip}</span> · poziția {r.pozitie} din {r.din}
              </p>
            </div>

            <div className="qr" dangerouslySetInnerHTML={{ __html: r.patrat }} />

            <div className="bare">
              <div dangerouslySetInnerHTML={{ __html: r.bare }} />
              <span className="serial">{r.cod}</span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
