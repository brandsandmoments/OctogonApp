import { poate, type Cine } from './acces';
import { deAlimentat, transe } from './banda';
import { ramasDeCroit, taieriLaCroit } from './croitTaiere';
import { comenziDepozit } from './depozit';
import { numarePeSectiuni } from './dezvoltare';
import { azi, zilePanaLa } from './format';
import { luni } from './perioade';
import { planPeSaptamani } from './productieComenzi';
import { comenziMagazine } from './magazine';
import { alerte, produseMagazine } from './produse';
import { psfDeAprobat } from './aprobare';
import { listaCumparaturi } from './stoc';

/**
 * Pagina de pornire pe om: ce are de făcut azi, ca niște carduri cu un număr și
 * un drum. Fiecare card apare doar cui are dreptul la zona lui, deci Adriana vede
 * croitul, Nela planificarea și banda, KAM-ul comenzile lui. Numerele vin din
 * aceleași funcții ca ecranele, ca să nu se contrazică niciodată cu ele.
 *
 * Tonul cardului: „rosu" = întârziat, „galben" = de făcut curând, „verde" =
 * nimic de făcut, „neutru" = de lucru obișnuit.
 */

export type Ton = 'rosu' | 'galben' | 'verde' | 'neutru';

export type Card = {
  titlu: string;
  numar: number;
  unitate: string;
  detaliu?: string;
  href: string;
  actiune: string;
  ton: Ton;
};

export type Grupa = { nume: string; carduri: Card[] };

const urgent = (zile: number | null) => zile !== null && zile <= 3;
const intarziat = (zile: number | null) => zile !== null && zile < 0;
const buc = (n: number) => (n === 1 ? 'bucată' : 'bucăți');
const comenzi = (n: number) => (n === 1 ? 'comandă' : 'comenzi');
const nr = (n: number) => n.toLocaleString('ro-RO');

async function croit(): Promise<Grupa> {
  const [ramas, taieri] = await Promise.all([ramasDeCroit(), taieriLaCroit('taieri')]);
  const inLucru = taieri.filter((t) => t.loturi_deschise > 0);
  const presante = ramas.filter((r) => urgent(zilePanaLa(r.data_ceruta)));
  const bucati = ramas.reduce((s, r) => s + r.disponibil, 0);
  return {
    nume: 'Croit',
    carduri: [
      {
        titlu: 'Rămas de croit', numar: bucati, unitate: buc(bucati),
        detaliu: `${ramas.length} ${comenzi(ramas.length)}${presante.length ? ` · ${presante.length} cu termen în 3 zile sau trecut` : ''}`,
        href: '/croit?vedere=ramas', actiune: 'Croiește',
        ton: ramas.length === 0 ? 'verde' : presante.some((r) => intarziat(zilePanaLa(r.data_ceruta))) ? 'rosu' : presante.length ? 'galben' : 'neutru',
      },
    ],
  };
}

async function planificare(): Promise<Grupa> {
  const curenta = luni(azi());
  const comenzi = await planPeSaptamani(curenta, curenta, curenta, luni);
  const deLucru = comenzi.filter((c) => c.stadiu !== 'terminat');
  const ramas = deLucru.reduce((s, c) => s + c.ramas_de_intrat, 0);
  const deDat = deLucru.reduce((s, c) => s + c.de_dat, 0);
  return {
    nume: 'Producție',
    carduri: [
      {
        titlu: 'Cu termen săptămâna asta', numar: deLucru.length, unitate: deLucru.length === 1 ? 'comandă' : 'comenzi',
        detaliu: `${ramas} buc rămase de intrat în lucru${comenzi.some((c) => c.intarziata) ? ' · unele întârziate' : ''}`,
        href: '/productie', actiune: 'Vezi planul', ton: comenzi.some((c) => c.intarziata) ? 'rosu' : deLucru.length ? 'neutru' : 'verde',
      },
      {
        titlu: 'Croite, de dat în lucru', numar: deDat, unitate: buc(deDat),
        detaliu: 'din comenzile cu termen săptămâna asta',
        href: '/productie', actiune: 'Dă în lucru', ton: deDat ? 'galben' : 'verde',
      },
    ],
  };
}

async function banda(): Promise<Grupa> {
  const [loturi, pe] = await Promise.all([deAlimentat(), transe(false)]);
  const intarziate = pe.filter((t) => t.marja_zile !== null && t.marja_zile < 0);
  const bucati = loturi.reduce((s, l) => s + l.rest, 0);
  return {
    nume: 'Bandă',
    carduri: [
      {
        titlu: 'De dat pe bandă', numar: bucati, unitate: buc(bucati),
        detaliu: `${loturi.length} ${loturi.length === 1 ? 'lot croit' : 'loturi croite'}`,
        href: '/banda', actiune: 'Dă pe bandă', ton: loturi.length ? 'neutru' : 'verde',
      },
      {
        titlu: 'Pe bandă, peste termen', numar: intarziate.length, unitate: intarziate.length === 1 ? 'tranșă' : 'tranșe',
        detaliu: `din ${pe.length} pe bandă acum`,
        href: '/banda', actiune: 'Vezi banda', ton: intarziate.length ? 'rosu' : 'verde',
      },
    ],
  };
}

/** Comenzile de stins; pentru un KAM fără drept peste depozit, doar ale lui. */
async function depozit(c: Cine & { nume: string }, doarAleLui: boolean): Promise<Grupa[]> {
  const toate = await comenziDepozit('de_stins');
  const grupe: Grupa[] = [];
  if (poate(c, 'receptie')) {
    const peste = toate.filter((x) => intarziat(zilePanaLa(x.termen)));
    grupe.push({
      nume: 'Depozit',
      carduri: [{
        titlu: 'Comenzi de stins', numar: toate.length, unitate: comenzi(toate.length),
        detaliu: `${nr(toate.reduce((s, x) => s + x.lipsesc, 0))} buc așteptate${peste.length ? ` · ${peste.length} peste termen` : ''}`,
        href: '/depozit', actiune: 'Scanează sau stinge', ton: peste.length ? 'rosu' : toate.length ? 'neutru' : 'verde',
      }],
    });
  }
  if (poate(c, 'comenzi')) {
    const ale = doarAleLui ? toate.filter((x) => x.kam === c.nume) : toate;
    const peste = ale.filter((x) => intarziat(zilePanaLa(x.termen)));
    const curand = ale.filter((x) => !intarziat(zilePanaLa(x.termen)) && urgent(zilePanaLa(x.termen)));
    grupe.push({
      nume: doarAleLui ? 'Comenzile tale' : 'Comenzi',
      carduri: [
        {
          titlu: 'Peste termen', numar: peste.length, unitate: comenzi(peste.length),
          detaliu: `${nr(peste.reduce((s, x) => s + x.lipsesc, 0))} buc încă neintrate în depozit`,
          href: '/depozit', actiune: 'Vezi comenzile', ton: peste.length ? 'rosu' : 'verde',
        },
        {
          titlu: 'Termen în următoarele 3 zile', numar: curand.length, unitate: comenzi(curand.length),
          detaliu: `din ${ale.length} deschise`,
          href: '/centralizator', actiune: 'Vezi stadiul', ton: curand.length ? 'galben' : 'verde',
        },
      ],
    });
  }
  return grupe;
}

async function dezvoltare(): Promise<Grupa> {
  const n = await numarePeSectiuni();
  return {
    nume: 'Dezvoltare produs',
    carduri: [
      { titlu: 'Tipare de făcut', numar: n.de_facut ?? 0, unitate: 'cereri', href: '/dezvoltare', actiune: 'Vezi cererile', ton: n.de_facut ? 'neutru' : 'verde' },
      { titlu: 'Mostre de aprobat', numar: n.mostre ?? 0, unitate: 'mostre', href: '/dezvoltare?sectiune=mostre', actiune: 'Aprobă', ton: n.mostre ? 'galben' : 'verde' },
    ],
  };
}

async function materiale(): Promise<Grupa> {
  const lipsa = await listaCumparaturi();
  const furnizori = new Set(lipsa.map((x) => x.furnizor).filter(Boolean)).size;
  const fara = lipsa.filter((x) => !x.furnizor).length;
  return {
    nume: 'Materii prime',
    carduri: [{
      titlu: 'De cumpărat', numar: lipsa.length, unitate: lipsa.length === 1 ? 'material' : 'materiale',
      detaliu: [furnizori && `${furnizori} ${furnizori === 1 ? 'furnizor' : 'furnizori'}`, fara && `${fara} fără furnizor`].filter(Boolean).join(' · '),
      href: '/stoc/cumparaturi', actiune: 'Lista de cumpărături', ton: lipsa.length ? 'galben' : 'verde',
    }],
  };
}

/** Comenzile din magazinele Shopify: ce pleacă azi, ce e de sunat, ce a rămas fără stoc. */
async function magazineShopify(): Promise<Grupa> {
  const toate = await comenziMagazine();
  const pe = (s: string) => toate.filter((c) => c.situatie === s);
  const vechi = toate.filter((c) => c.zile >= 4).length;
  return {
    nume: 'Comenzi din magazine',
    carduri: [
      {
        titlu: 'De trimis', numar: pe('livrabila').length, unitate: comenzi(pe('livrabila').length),
        detaliu: `${nr(pe('livrabila').reduce((s, c) => s + c.bucati, 0))} buc de cules${vechi ? ` · ${vechi} așteaptă de 4+ zile` : ''}`,
        href: '/magazine', actiune: 'Picking', ton: vechi ? 'rosu' : pe('livrabila').length ? 'neutru' : 'verde',
      },
      {
        titlu: 'De sunat', numar: pe('de_sunat').length, unitate: comenzi(pe('de_sunat').length),
        detaliu: 'avem doar o parte din comandă', href: '/magazine', actiune: 'Sună clienții',
        ton: pe('de_sunat').length ? 'galben' : 'verde',
      },
      {
        titlu: 'Fără stoc', numar: pe('fara_stoc').length, unitate: comenzi(pe('fara_stoc').length),
        detaliu: `${nr(pe('fara_stoc').reduce((s, c) => s + c.bucati, 0))} buc lipsă`, href: '/magazine',
        actiune: 'Vezi ce lipsește', ton: pe('fara_stoc').length ? 'rosu' : 'verde',
      },
    ],
  };
}

/** Alertele magazinelor: clienți care așteaptă stoc, mărimi terminate care se vindeau, ce se termină curând. */
async function alerteMagazine(): Promise<Grupa> {
  const a = alerte(await produseMagazine());
  const pierdute = a.terminat.filter((x) => !x.m.se_poate_comanda).length;
  return {
    nume: 'Alerte magazine',
    carduri: [
      { titlu: 'Clienți care așteaptă', numar: a.asteapta.reduce((s, x) => s + x.m.lipsa, 0), unitate: 'buc lipsă',
        detaliu: `${a.asteapta.length} mărimi cerute de comenzi deschise peste stoc`, href: '/magazine/alerte',
        actiune: 'Vezi ce lipsește', ton: a.asteapta.length ? 'rosu' : 'verde' },
      { titlu: 'Terminate, se vindeau', numar: a.terminat.length, unitate: 'mărimi',
        detaliu: pierdute ? `${pierdute} nu se mai pot comanda: vânzări pierdute` : 'toate se mai pot comanda',
        href: '/magazine/alerte', actiune: 'Restoc sau nu', ton: pierdute ? 'rosu' : a.terminat.length ? 'galben' : 'verde' },
      { titlu: 'Se termină curând', numar: a.curand.length, unitate: 'mărimi', detaliu: `${a.trend.length} produse în trend · ${a.stoc_mort.length} nu se mișcă`,
        href: '/magazine/alerte', actiune: 'Vezi alertele', ton: a.curand.length ? 'galben' : 'verde' },
    ],
  };
}

/** Pentru responsabilii cu drept de aprobare: PSF-urile date de KAM-i care îi așteaptă. */
async function aprobari(): Promise<Grupa> {
  const lista = await psfDeAprobat();
  const bucati = lista.reduce((s, c) => s + c.linii.reduce((a, l) => a + l.marimi.reduce((b, m) => b + m.cantitate, 0), 0), 0);
  return {
    nume: 'De aprobat',
    carduri: [{
      titlu: 'PSF-uri de la KAM-i', numar: lista.length, unitate: lista.length === 1 ? 'PSF' : 'PSF-uri',
      detaliu: `${nr(bucati)} buc cerute`, href: '/comenzi/aprobare', actiune: 'Aprobă sau respinge',
      ton: lista.length ? 'galben' : 'verde',
    }],
  };
}

/** Grupele omului, în ordinea drumului comenzii. Un KAM simplu își vede doar comenzile lui. */
export async function deFacutAzi(c: Cine & { nume: string }): Promise<Grupa[]> {
  const doarAleLui = c.roluri.includes('kam') && !c.roluri.includes('admin') && !c.roluri.includes('head_of_sales');
  const parti = await Promise.all([
    poate(c, 'comenzi') || poate(c, 'receptie') ? depozit(c, doarAleLui) : Promise.resolve([]),
    poate(c, 'planificare') ? planificare().then((g) => [g]) : Promise.resolve([]),
    poate(c, 'croit') ? croit().then((g) => [g]) : Promise.resolve([]),
    poate(c, 'banda') ? banda().then((g) => [g]) : Promise.resolve([]),
    poate(c, 'dezvoltare') ? dezvoltare().then((g) => [g]) : Promise.resolve([]),
    poate(c, 'materiale') ? materiale().then((g) => [g]) : Promise.resolve([]),
    poate(c, 'expediere') ? Promise.all([magazineShopify(), alerteMagazine()]) : Promise.resolve([]),
  ]);
  if (poate(c, 'aprobare', 'modifica')) parti.splice(1, 0, [await aprobari()]);
  const [dep, ...rest] = parti;
  // Comenzile (ale KAM-ului) întâi, depozitul la urmă: drumul comenzii.
  return [...dep.filter((g) => g.nume !== 'Depozit'), ...rest.flat(), ...dep.filter((g) => g.nume === 'Depozit')];
}
