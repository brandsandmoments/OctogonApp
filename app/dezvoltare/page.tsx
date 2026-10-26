import Link from 'next/link';
import { redirect } from 'next/navigation';
import { poate } from '../lib/acces';
import { creeaza, lista, nomenclatoare, numarePeSectiuni, SECTIUNI, STARI, TIPURI, type Sectiune } from '../lib/dezvoltare';
import { cere } from '../lib/sesiune';
import CampuriCerere, { cerereDinFormular } from './CampuriCerere';
import '../formulare.css';

export const dynamic = 'force-dynamic';

async function cerereNoua(f: FormData) {
  'use server';
  await cere(['dezvoltare', 'comenzi'], 'vede'); // dreptul exact îl verifică creeaza()
  const r = await creeaza(cerereDinFormular(f));
  if ('eroare' in r) redirect(`/dezvoltare?eroare=${encodeURIComponent(r.eroare)}`);
  redirect(`/dezvoltare/${r.id}`);
}

const PRIORITATE: Record<number, string> = { 1: 'Urgent', 2: 'Ridicată', 3: 'Normal', 4: 'Scăzută', 5: 'Scăzută' };

/**
 * Dezvoltarea de produs, în patru secțiuni: tipare de făcut, în lucru (început,
 * probă, corecturi, tipar gata), mostre gata — care așteaptă aprobarea KAM-ului —
 * și aprobate. Statusul vine din pașii fiecărui model, nu dintr-o coloană scrisă.
 */
export default async function Dezvoltare({ searchParams }: { searchParams: Promise<{ sectiune?: string; eroare?: string }> }) {
  const u = await cere(['dezvoltare', 'comenzi']);
  const { sectiune: s = 'de_facut', eroare } = await searchParams;
  const sectiune = (s in SECTIUNI ? s : 'de_facut') as Sectiune;
  const [randuri, numere, nom] = await Promise.all([lista(sectiune), numarePeSectiuni(), nomenclatoare()]);
  const poateCere = poate(u, 'dezvoltare', 'modifica') || poate(u, 'comenzi', 'modifica');

  return (
    <main className="formular lat">
      <h1>Dezvoltare produs</h1>
      <nav className="file">
        {Object.entries(SECTIUNI).map(([k, v]) => (
          <Link key={k} href={`/dezvoltare?sectiune=${k}`} className={k === sectiune ? 'activ' : ''}>
            {v.nume} <span className="slab">{numere[k] ?? 0}</span>
          </Link>
        ))}
      </nav>
      {eroare && <p className="eroare">{eroare}</p>}

      {poateCere && (
        <details className="caseta" open={Boolean(eroare)}>
          <summary>Cerere nouă de tipar</summary>
          <form action={cerereNoua} className="antet-comanda">
            <CampuriCerere nom={nom} />
            <div className="actiuni"><button className="principal">Trimite cererea</button></div>
          </form>
        </details>
      )}

      {randuri.length === 0 ? <p className="slab">Nimic aici.</p> : (
        <div className="tabel-derulant">
          <table className="centralizator">
            <thead>
              <tr><th>Model</th><th>Brand</th><th>Categorie</th><th>Culori</th><th>Tip</th><th>Prioritate</th>
                  <th>Termen</th><th>KAM</th><th>Stare</th></tr>
            </thead>
            <tbody>
              {randuri.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/dezvoltare/${r.id}`}>{r.model}</Link></td>
                  <td>{r.brand}</td>
                  <td className="slab">{r.categorie ?? '—'}</td>
                  <td className="culori-celula">{r.culori.join(', ')}</td>
                  <td className="slab">{TIPURI[r.tip]}</td>
                  <td>{r.prioritate === 1 ? <strong>Urgent</strong> : PRIORITATE[r.prioritate]}</td>
                  <td className={r.intarziat ? 'lipsa' : 'slab'}>{r.termen ?? '—'}{r.intarziat && ' · depășit'}</td>
                  <td className="slab">{r.kam ?? '—'}</td>
                  <td>{STARI[r.stare]}{r.fisa_gata && <span className="slab"> · fișă</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
