import { caFirma } from './db';
import { firmaCurenta } from './sesiune';

export type Optiune = { id: string; nume: string };
export type ProdusOptiune = { id: string; nume: string; cod_sku: string; brand_id: string; activ: boolean; timp_min_buc: number | null };
export type MarimeOptiune = { id: string; cod: string; cod_numeric: string | null };

export type Nomenclatoare = {
  branduri: Optiune[];
  produse: ProdusOptiune[];
  marimi: MarimeOptiune[];
  kami: Optiune[];
  // Pentru estimarea timpului de producție (lib/timp.ts).
  timp: { orePeZi: number; operatori: number; costMinut: number };
};

/** Tot ce trebuie formularului de comandă, într-o singură tranzacție. */
export async function nomenclatoareComanda(): Promise<Nomenclatoare> {
  return caFirma(firmaCurenta(), async (c) => {
    // Una după alta: o conexiune execută o singură interogare odată.
    const branduri = await c.query<Optiune>(`SELECT id, nume FROM brand WHERE activ ORDER BY nume`);
    // Și produsele inactive: „Activ" din catalog înseamnă activ pe site, nu „nu se mai
    // produce" — 73 de produse inactive au comenzi în dashboard. Vin după cele active.
    const produse = await c.query<ProdusOptiune>(
      `SELECT p.id, p.denumire AS nume, p.cod_sku, p.brand_id, p.activ, m.timp_min_buc::float AS timp_min_buc
         FROM produs p LEFT JOIN model m ON m.id = p.model_id ORDER BY NOT p.activ, p.denumire`,
    );
    const marimi = await c.query<MarimeOptiune>(`SELECT id, cod, cod_numeric FROM marime ORDER BY ordine`);
    const kami = await c.query<Optiune>(
      `SELECT id, nume FROM utilizator WHERE activ AND 'kam' = ANY (roluri) ORDER BY nume`);
    const { rows: param } = await c.query<{ cheie: string; valoare: number }>(
      `SELECT cheie, valoare::float AS valoare FROM parametru WHERE cheie IN ('ore_pe_zi', 'operatori_impliciti', 'cost_minut_om')`);
    const p = (k: string, d: number) => param.find((x) => x.cheie === k)?.valoare ?? d;
    return { branduri: branduri.rows, produse: produse.rows, marimi: marimi.rows, kami: kami.rows,
             timp: { orePeZi: p('ore_pe_zi', 8), operatori: p('operatori_impliciti', 6), costMinut: p('cost_minut_om', 0) } };
  });
}

export type LinieNoua = {
  produsId: string;
  dataCeruta: string;
  vanzareDeLa: string;   // perioada în care KAM-ul crede că se vinde linia
  vanzarePanaLa: string;
  cantitati: Record<string, number>; // marime_id → bucăți
};

export type ComandaNoua = {
  tip: 'PSF' | 'PSC';
  brandId: string;
  kamId: string;
  dataLansare: string;
  prioritate: number;
  observatii: string;
  lanseaza: boolean;
  // PSF dat de cineva fără dreptul de aprobare: se „lansează" în așteptarea unui responsabil.
  // Îl pune doar acțiunea de pe server, niciodată formularul.
  deAprobat?: boolean;
  // Cine o dă: KAM-ul (implicit) sau croitul — mostră ori comandă de croit internă, fără KAM
  // și fără perioadă de vânzare (nu intră în evaluarea KAM-ilor).
  origine?: 'kam' | 'mostra' | 'croit';
  linii: LinieNoua[];
};

export type RezultatComanda = { ok: true; numar: string; deAprobat?: boolean } | { ok: false; eroare: string };

/**
 * Numărul comenzii se scrie mereu la fel: „PSC-Sep-26-1 " și „psc-sep-26-1" sunt
 * aceeași comandă. Fără asta, indexul unic n-ar prinde dublura.
 */
export function normalizeazaNumar(brut: string): string {
  return brut.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Scrie comanda cu liniile și cantitățile ei, într-o singură tranzacție: ori
 * intră toată, ori nimic. O comandă pe jumătate scrisă e exact genul de rând
 * orfan pe care structura asta a fost făcută să nu-l mai permită.
 */
/** Brandul n-are codul din numărul comenzii: fără el, numărul ar ieși gol. */
class FaraCodBrand extends Error {}

export async function creeazaComanda(cmd: ComandaNoua): Promise<RezultatComanda> {
  if (!cmd.brandId) return { ok: false, eroare: 'Alege brandul.' };
  if (!cmd.dataLansare) return { ok: false, eroare: 'Data lansării e obligatorie.' };

  const linii = cmd.linii
    .map((l) => ({
      ...l,
      cantitati: Object.entries(l.cantitati).filter(([, q]) => Number.isInteger(q) && q > 0),
    }))
    .filter((l) => l.produsId && l.cantitati.length > 0);
  if (linii.length === 0) return { ok: false, eroare: 'Comanda nu are nicio cantitate.' };
  if (new Set(linii.map((l) => l.produsId)).size !== linii.length) {
    return { ok: false, eroare: 'Același produs apare pe două linii. Pune cantitățile pe una.' };
  }
  if (linii.some((l) => !l.dataCeruta)) {
    return { ok: false, eroare: 'Fiecare linie are nevoie de data cerută în depozit.' };
  }
  // La PSF și la PSC, KAM-ul își asumă și perioada în care se vinde stocul cerut: din
  // ea se măsoară, săptămânal, cât de bine a citit piața (evaluarea KAM-ilor).
  const intern = cmd.origine === 'mostra' || cmd.origine === 'croit';
  if (cmd.tip === 'PSF' && !cmd.kamId && !intern) return { ok: false, eroare: 'La PSF, alege KAM-ul care îl dă.' };
  if (!intern && linii.some((l) => !l.vanzareDeLa || !l.vanzarePanaLa)) {
    return { ok: false, eroare: 'Fiecare linie are nevoie de perioada în care estimezi că se vinde stocul cerut.' };
  }
  if (linii.some((l) => l.vanzarePanaLa < l.vanzareDeLa)) {
    return { ok: false, eroare: 'Perioada de vânzare se termină înainte să înceapă.' };
  }

  try {
    return await caFirma(firmaCurenta(), async (c) => {
      // Numărul îl dă aplicația: psf-ms-26-noi-4 — tip, brand, anul și luna lansării,
      // nr. de ordine în luna aceea, pe tip și brand. Blocarea ține pe loc a doua
      // comandă salvată în aceeași clipă, ca să nu primească același număr.
      const { rows: [{ prefix }] } = await c.query<{ prefix: string }>(
        `SELECT lower($1) || '-' || b.cod || '-' || to_char($3::date, 'YY') || '-' || luna_scurta($3::date) || '-' AS prefix
           FROM brand b WHERE b.id = $2`, [cmd.tip, cmd.brandId, cmd.dataLansare]);
      if (!prefix) throw new FaraCodBrand();
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [prefix]);
      const { rows: [{ numar }] } = await c.query<{ numar: string }>(
        `SELECT $1 || (coalesce(max(substr(numar, length($1) + 1)::int), 0) + 1) AS numar
           FROM comanda WHERE numar LIKE $1 || '%' AND substr(numar, length($1) + 1) ~ '^[0-9]+$'`, [prefix]);
      const { rows: [{ id }] } = await c.query<{ id: string }>(
        `INSERT INTO comanda (firma_id, numar, tip, brand_id, data_lansare, prioritate, stare, observatii, kam_id, origine)
         VALUES (firma_curenta(), $1, $2, $3, $4, $5, $6, nullif($7, ''), nullif($8, '')::uuid, $9)
         RETURNING id`,
        [numar, cmd.tip, cmd.brandId, cmd.dataLansare, cmd.prioritate,
         cmd.lanseaza ? (cmd.deAprobat ? 'de_aprobat' : 'lansata') : 'ciorna', cmd.observatii.trim(), cmd.kamId, cmd.origine ?? 'kam'],
      );
      for (const l of linii) {
        const { rows: [linie] } = await c.query<{ id: string }>(
          `INSERT INTO comanda_linie (firma_id, comanda_id, produs_id, data_ceruta, vanzare_de_la, vanzare_pana_la)
           VALUES (firma_curenta(), $1, $2, $3, nullif($4, '')::date, nullif($5, '')::date) RETURNING id`,
          [id, l.produsId, l.dataCeruta, l.vanzareDeLa, l.vanzarePanaLa],
        );
        for (const [marimeId, q] of l.cantitati) {
          await c.query(
            `INSERT INTO comanda_cantitate (firma_id, linie_id, marime_id, cantitate)
             VALUES (firma_curenta(), $1, $2, $3)`,
            [linie.id, marimeId, q],
          );
        }
      }
      // Lansată, pleacă direct la croit: nu mai trece prin planificare.
      if (cmd.lanseaza && !cmd.deAprobat) await c.query(`SELECT planifica_automat($1)`, [id]);
      return { ok: true as const, numar, deAprobat: Boolean(cmd.lanseaza && cmd.deAprobat) };
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      return { ok: false, eroare: 'Numărul comenzii s-a ocupat chiar acum. Mai apasă o dată.' };
    }
    if (e instanceof FaraCodBrand) return { ok: false, eroare: 'Brandul ales n-are cod pentru numărul comenzii (ms, ps, sl). Spune-i adminului.' };
    throw e;
  }
}

/**
 * Schimbă termenul cerut în stoc al comenzii (pe toate liniile ei), de ex. o dată scrisă greșit
 * la lansare. Planul pe săptămâni o mută singur în săptămâna noului termen. Schimbarea se
 * notează în observațiile comenzii (de la ce dată la ce dată, cine, când).
 */
export async function schimbaTermen(numar: string, data: string, cine: string): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return 'Alege data nouă.';
  return caFirma(firmaCurenta(), async (c) => {
    const { rows: [cm] } = await c.query<{ id: string; vechi: string | null; data_lansare: string; stare: string }>(
      `SELECT c.id, to_char(c.data_lansare, 'YYYY-MM-DD') AS data_lansare, c.stare::text AS stare,
              (SELECT to_char(min(cl.data_ceruta), 'DD.MM.YYYY') FROM comanda_linie cl WHERE cl.comanda_id = c.id) AS vechi
         FROM comanda c WHERE c.numar = $1 FOR UPDATE`, [numar]);
    if (!cm) return 'Comanda nu există.';
    if (cm.stare === 'anulata') return 'Comanda e anulată.';
    if (data < cm.data_lansare) return 'Termenul nu poate fi înainte de lansare.';
    await c.query(`UPDATE comanda_linie SET data_ceruta = $2 WHERE comanda_id = $1`, [cm.id, data]);
    const nou = data.split('-').reverse().join('.');
    const azi = new Date().toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest' });
    await c.query(`UPDATE comanda SET observatii = concat_ws(' · ', nullif(observatii, ''), $2::text) WHERE id = $1`,
      [cm.id, `Termen schimbat din ${cm.vechi ?? '—'} în ${nou} de ${cine}, ${azi}`]);
    return null;
  });
}
