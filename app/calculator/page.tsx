import { cere, interogare } from '../lib/sesiune';
import { azi } from '../lib/format';
import { parametriTimp } from '../lib/parametriTimp';
import Calculator, { type ModelTimp } from './Calculator';
import '../formulare.css';

export const dynamic = 'force-dynamic';

/**
 * Calculatorul de timp de producție: pentru cine dă un PSF sau PSC, cine planifică și
 * cine alimentează banda — cât durează un lot de când intră în lucru până iese gata,
 * după minutele pe bucată ale modelului (nomenclatorul de timpi) și câți oameni lucrează.
 */
export default async function CalculatorPagina() {
  await cere(['comenzi', 'planificare', 'banda', 'centralizator', 'kam', 'croit']);
  const [modele, p] = await Promise.all([
    interogare<ModelTimp>(
      `SELECT m.id, m.denumire AS nume, b.nume AS brand, m.timp_min_buc::float AS minute
         FROM model m LEFT JOIN brand b ON b.id = m.brand_id WHERE m.activ ORDER BY m.denumire`),
    parametriTimp(),
  ]);
  const cuTimp = modele.filter((m) => m.minute).length;

  return (
    <main className="formular">
      <h1>Calculator timp de producție</h1>
      <p className="sumar">
        Cât durează un lot de când intră în lucru până iese gata. Timpul de bază e pentru o bucată făcută de un om
        ({cuTimp} din {modele.length} modele au timpul în nomenclator). Aceeași regulă ca estimarea de pe bandă.
      </p>
      <Calculator modele={modele} orePeZi={p.orePeZi} operatori={p.operatori} costMinut={p.costMinut} azi={azi()} />
    </main>
  );
}
