import type { Detalii } from '../lib/dezvoltare';
import { TIPURI } from '../lib/dezvoltare';

type Nom = {
  branduri: { id: string; nume: string }[];
  categorii: { id: string; nume: string }[];
  marimi: { id: string; cod: string }[];
  kami: { id: string; nume: string }[];
};

/** Câmpurile unei cereri de tipar: aceleași la cerere nouă și la modificare. */
export default function CampuriCerere({ nom, d }: { nom: Nom; d?: Detalii }) {
  return (
    <>
      <label>
        <span>Brand</span>
        <select name="brand" defaultValue={d?.brand_id ?? ''} required>
          <option value="">—</option>
          {nom.branduri.map((b) => <option key={b.id} value={b.id}>{b.nume}</option>)}
        </select>
      </label>
      <label><span>Model</span><input name="model" defaultValue={d?.model ?? ''} placeholder="Melissa" required /></label>
      <label>
        <span>Categorie</span>
        <select name="categorie" defaultValue={d?.categorie_id ?? ''}>
          <option value="">—</option>
          {nom.categorii.map((k) => <option key={k.id} value={k.id}>{k.nume}</option>)}
        </select>
      </label>
      <label>
        <span>Tip lucrare</span>
        <select name="tip" defaultValue={d?.tip ?? 'tipar_nou'}>
          {Object.entries(TIPURI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="lat"><span>Culori, despărțite prin virgulă</span>
        <input name="culori" defaultValue={d?.culori.join(', ') ?? ''} placeholder="Negru, Crem, Maro" /></label>
      <label>
        <span>Mărimi de la</span>
        <select name="marime_de_la" defaultValue={d?.marime_de_la ?? ''}>
          <option value="">—</option>
          {nom.marimi.map((m) => <option key={m.id} value={m.id}>{m.cod}</option>)}
        </select>
      </label>
      <label>
        <span>până la</span>
        <select name="marime_pana_la" defaultValue={d?.marime_pana_la ?? ''}>
          <option value="">—</option>
          {nom.marimi.map((m) => <option key={m.id} value={m.id}>{m.cod}</option>)}
        </select>
      </label>
      <label>
        <span>Prioritate</span>
        <select name="prioritate" defaultValue={String(d?.prioritate ?? 3)}>
          <option value="1">Urgent</option>
          <option value="3">Normal</option>
          <option value="5">Scăzută</option>
        </select>
      </label>
      <label><span>Termen</span><input name="termen" type="date" defaultValue={d?.termen ?? ''} /></label>
      <label>
        <span>KAM (aprobă mostra)</span>
        <select name="kam" defaultValue={d?.kam_id ?? ''}>
          <option value="">—</option>
          {nom.kami.map((k) => <option key={k.id} value={k.id}>{k.nume}</option>)}
        </select>
      </label>
      <label><span>Link poze (Drive)</span><input name="link_poze" type="url" defaultValue={d?.link_poze ?? ''} /></label>
      <label><span>Link fișă produs</span><input name="link_fisa" type="url" defaultValue={d?.link_fisa ?? ''} /></label>
      <label className="lat"><span>Observații</span><input name="observatii" defaultValue={d?.observatii ?? ''} /></label>
    </>
  );
}

export function cerereDinFormular(f: FormData) {
  const s = (k: string) => String(f.get(k) ?? '');
  return {
    brandId: s('brand'), model: s('model'), culori: s('culori'), categorieId: s('categorie'), tip: s('tip'),
    marimeDeLa: s('marime_de_la'), marimePanaLa: s('marime_pana_la'), prioritate: Number(s('prioritate')) || 3,
    termen: s('termen'), kamId: s('kam'), linkPoze: s('link_poze'), linkFisa: s('link_fisa'), observatii: s('observatii'),
  };
}
