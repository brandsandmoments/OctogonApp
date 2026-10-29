/**
 * Bara de căutare a unei liste: un formular GET cu `cauta`; celelalte filtre din
 * adresă se păstrează. Potrivirea e pe cuvinte, fără diacritice (vezi potriveste).
 */
export default function Cauta({ valoare, pastreaza = {}, placeholder = 'caută: comandă, produs, model' }: {
  valoare?: string; pastreaza?: Record<string, string | undefined>; placeholder?: string;
}) {
  return (
    <form className="filtre">
      {Object.entries(pastreaza).filter(([k, v]) => v && k !== 'cauta').map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input name="cauta" type="search" defaultValue={valoare ?? ''} placeholder={placeholder} aria-label="Caută" />
      <button>Caută</button>
    </form>
  );
}
