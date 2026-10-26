import Pliere from './Pliere';

const GRUPARI = { saptamana: 'pe săptămâni', luna: 'pe luni', trimestru: 'pe trimestre', an: 'pe ani' } as const;

/**
 * Alegerea grupării unei liste — fără, pe săptămâni, luni, trimestre, ani. Un
 * formular GET: celelalte filtre din adresă se păstrează ca câmpuri ascunse.
 * Grupele pornesc strânse și se desfac la clic (Pliere).
 */
export default function Grupare({ ales, pastreaza = {} }: { ales: string; pastreaza?: Record<string, string | undefined> }) {
  return (
    <form className="filtre">
      {Object.entries(pastreaza).filter(([k, v]) => v && k !== 'grupare').map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <select name="grupare" defaultValue={ales || 'fara'} aria-label="Grupare">
        <option value="fara">fără grupare</option>
        {Object.entries(GRUPARI).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
      </select>
      <button>Arată</button>
      {ales && <Pliere semn={JSON.stringify([ales, pastreaza])} />}
    </form>
  );
}
