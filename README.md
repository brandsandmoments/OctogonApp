# OctogonApp

Aplicație de producție pentru Octogon Fashion: de la comanda de producție (PSF/PSC)
până la intrarea în depozit, cu etichete scanabile pe fiecare poziție de comandă.

Specificația completă: documentul **Aplicația Octogon — specificație și arhitectură**.

## Starea de acum

Nu există încă aplicație. Există structura bazei de date — partea care trebuie
să fie corectă înainte de orice linie de interfață, pentru că e singura care nu
se poate schimba ieftin mai târziu.

| | |
|---|---|
| `db/migrations/0001_structura.sql` | lanțul comandă → linie → planificare → lot → etichetă → recepție |
| `db/migrations/0002_izolare.sql` | izolarea între firme, impusă de Postgres |
| `db/migrations/0003_marimi_numerice_si_motive.sql` | grila numerică EU și lista de motive |
| `db/migrations/0004_traduceri.sql` | descrierea în engleză a fiecărui tabel și a fiecărei coloane |
| `db/migrations/0005_inchidere_pe_zero.sql` | o poziție se poate închide cu zero bucăți, cu motiv și observații |
| `db/migrations/0006_modele_materiale_retete.sql` | modele, materiale, rețete și necesarul pe comandă |
| `db/migrations/0007_campuri_din_dashboard.sql` | familia și prețul materialului, stofa principală a modelului |
| `db/migrations/0008_stoc_si_inventar.sql` | fișa de magazie, rezervarea din planificări, inventarul, parametrii de pierderi |
| `db/migrations/0009_planificare_si_croit.sql` | ce i se cere lotului, când s-a croit, încheierea planificării |
| `db/migrations/0010_alimentare_banda.sql` | tranșele de pe bandă, consumul de accesorii, rezervarea lor până la bandă |
| `scripts/import-dashboard.mts` | importul din dashboard-ul Google Sheets |
| `db/test_izolare.sql` | douăzeci și patru de verificări de purtare, rulate pe Postgres 16 |

## Cele două decizii care traversează tot

**Fiecare tabel poartă `firma_id`**, iar izolarea e impusă prin Row Level Security,
nu prin codul aplicației. Un filtru uitat întoarce zero rânduri, nu datele altui
client. Asta nu se adaugă retroactiv — de aceea e aici de la primul tabel.

**Nomenclatoarele sunt date, nu cod.** Mărimile, culorile, etapele de croit și
motivele stau în tabele. Grila Octogon e XXS–2XL, a Sleevy e 2XS–2XL, a altei
firme e 36–46. Dacă mărimile ar fi coloane, produsul n-ar fi vandabil.

## Ce rezolvă structura asta, concret

Fiecare constrângere de mai jos corespunde unui incident real din dashboard-ul
în Google Sheets:

| Ce s-a întâmplat | Ce o face imposibilă acum |
|---|---|
| Coloane „(auto)" tastate peste formulă, 58 de rânduri | câmpuri calculate, nu celule |
| Loturi rămase fără comandă după ștergeri | chei străine cu `ON DELETE RESTRICT` |
| `psf-ps-oct-70` duplicat; `PS-AW26-1` pe șapte rânduri | indecși unici |
| Formule cu plafon `$AE$446` lângă altele cu `$AE$572` | nu există plafoane |
| 420 de intrări invizibile sub rândul 605 | idem |
| Legături pe poziție de rând, rupte la sortare | legături prin id |
| Brand scris `MAison Loulou` → 19 chei paralele | referințe, nu text liber |
| O linie invizibilă fiindcă îi lipsea data de lansare | `NOT NULL` |

## Rulare locală

```sh
createdb octogon
psql octogon -f db/migrations/0001_structura.sql
psql octogon -f db/migrations/0002_izolare.sql
```

Aplicația setează firma la fiecare conexiune:

```sql
SET app.firma_id = '<uuid-ul firmei>';
```

Fără asta, toate interogările întorc zero rânduri. Intenționat.

## Verificare

```sh
psql octogon -f db/test_izolare.sql
```

Testul nu verifică doar că migrările rulează, ci că structura se poartă corect:
aplicația nu vede nimic fără firmă setată, nu vede și nu poate scrie datele altei
firme, nu poate crea un lot fără planificare, nu poate șterge o comandă care are
linii în producție, nu poate refolosi un cod de etichetă, nu poate înregistra o
recepție de zero bucăți — și calculează corect *cerut 7, intrat 4, lipsesc 3*.

## Ce urmează

- [x] Stack: Next.js 16 + TypeScript + Postgres
- [x] Migrarea 0003: mărimi numerice și lista de motive
- [x] Primul ecran: pozițiile deschise cu progresul lor
- [ ] Autentificare și roluri (acum firma vine din `FIRMA_ID`, din mediu)
- [x] Generarea etichetelor: Code 128 + QR, pe coală A4
- [x] Ecranul de scanare, pe telefon
- [x] Introducerea PSF/PSC, centralizatorul, rețete pe model, necesarul pe comandă
- [x] Stoc și inventar pe materii prime și accesorii: rezervare la planificare, scădere la croit 
- [x] Planificarea și croitul (tot ce e în croit / de croit / croite / rămas de croit)
- [x] Alimentarea benzii: loturile croite intră pe bandă, accesoriile scad din stoc
- [x] Import din dashboard: catalog, modele, rețete, materiale, comenzi PSF/PSC
- [ ] Import din cele trei magazine Shopify; planificarea, croitul și recepțiile din dashboard

## Aplicația

Next.js 16 + TypeScript + Postgres, fără ORM — interogările sunt SQL, ca să nu
depindă de o bibliotecă anume dacă proiectul schimbă stack-ul sau mâinile.

```sh
npm install
cp .env.example .env     # și completează DATABASE_URL
npm run db:reset         # migrări + nomenclatoarele Octogon
npm run dev
```

`app/lib/db.ts` e singurul drum către bază. Fiecare interogare rulează într-o
tranzacție care începe prin `set_config('app.firma_id', …, true)` — legat de
tranzacție, deci nu rămâne setat pe conexiunea întoarsă în pool.

| Ecran | Ce arată |
|---|---|
| `/comenzi` | pozițiile deschise cu progresul lor: cerut, intrat, lipsesc, motiv |
| `/etichete/<comanda>` | coala A4 de etichete a comenzii, gata de tipărit |
| `/scanare` | recepția pe telefon: scanezi eticheta, confirmi ce a intrat |
| `/centralizator` | toate liniile PSF și PSC: cerut, planificat, croit, pe bandă, intrat, lipsesc |
| `/comenzi/noua` | PSF sau PSC nouă, cu grila de mărimi |
| `/necesar/<comanda>` | materia primă și accesoriile unei comenzi, plus ce lipsește din rețete |
| `/modele`, `/modele/<id>` | modelele, consumul pe bucată, materialul fiecărei culori |
| `/materiale` | nomenclatorul de materii prime și accesorii |
| `/planificare`, `/planificare/<id>` | ce e de planificat; acoperirea cu stofă; lansarea spre croit; încheierea |
| `/croit`, `/croit/<lot>` | tot ce e în croit, de croit, croite, rămas de croit; fișa lotului cu etapele și croitul efectiv |
| `/banda`, `/banda/<tranșă>` | de alimentat, pe bandă, predate; drumul fiecărei tranșe până la depozit |
| `/stoc`, `/stoc/<id>` | stoc, rezervat, disponibil, de aprovizionat; fișa de magazie a fiecărui material |
| `/inventar`, `/inventar/<id>` | numărătoarea fizică; la închidere, diferențele devin ajustări |

## Limba schemei

Numele sunt în română — asta vorbește echipa, iar „PSF" și „croit" n-au echivalent
curat în engleză. Dar **fiecare tabel și fiecare coloană poartă o descriere în
engleză**, stocată în baza de date, nu într-un fișier care se desincronizează:

```sql
SELECT * FROM glosar;
```

Se vede și din `\d+ comanda` în psql, și în orice unealtă de baze de date. Un
dezvoltator din afară citește schema fără dicționar. `docs/glosar.md` e aceeași
informație, generată din bază, pentru citit pe hârtie.

## Mărimile

Grila principală e XXS–2XL. Denumirea numerică EU stă alături, pe aceeași mărime:

| XXS | XS | S | M | L | XL | 2XL |
|---|---|---|---|---|---|---|
| 32 | 34 | 36 | 38 | 40 | 42 | 44 |

Nu sunt mărimi separate. Dacă ar fi rânduri distincte, cele 7 ar deveni 14 și
fiecare cantitate s-ar împărți în două. `marime_alias` acoperă și cum le scriu
alte sisteme — Shopify Sleevy trimite `2XS` unde noi scriem `XXS`.

## Etichetele

Zece pe coală A4, 105 x 59,4 mm — A4 împărțit exact în două pe lățime și în cinci
pe înălțime, deci se taie cu rigla fără rest. Totul e dimensionat în milimetri:
ce se taie cu rigla nu se măsoară în pixeli.

Pe fiecare etichetă: denumirea produsului, **SKU-ul**, mărimea cu echivalentul
numeric, **numărul comenzii** și poziția, un QR în colț și un Code 128 lat jos.
Numărul comenzii și SKU-ul sunt tipărite cu litere; în codul de bare stă doar
serialul.

**Se tipărește la 100%**, fără „scale to fit". Redimensionarea strică raportul
dintre bare și codurile nu se mai citesc.

Verificarea nu s-a făcut privind pagina, ci decodând-o: cele șase coduri de pe
coala unei comenzi reale au fost extrase din HTML, randate ca imagini și citite
înapoi cu un cititor de coduri de bare. Așa s-a descoperit și că fără zona liberă
din jurul codului nu se citește niciunul.

## Rețete și necesar

Rețeta e a **modelului**, nu a produsului. „Trening Echo" consumă la fel în roșu,
bleu sau negru; culoarea schimbă doar *ce* stofă și *ce* fermoar intră, nu *cât*.
Shopify o spune deja: fiecare produs Sleevy poartă un tag `model:echo`.

Așa că rețeta are două jumătăți: `model_componenta` spune cât consumă o bucată
(„stofă principală, 2,1 m"), iar `produs_material` spune ce material concret umple
componenta pentru o culoare anume („Jerseu negru"). Cheile compuse fac imposibil
un nasture pus în locul stofei, o stofă socotită în bucăți sau componenta altui
model — fără nicio linie de cod.

Necesarul unei comenzi = bucăți cerute × consum, adunat pe material, calculat în
vederea `necesar_comanda`. Un produs fără model, un model fără rețetă sau o
componentă fără material **nu dispar din sumă**: ecranul le arată deasupra
tabelului, pentru că un necesar care tace despre ele pare complet și nu e.

## Planificare și croit

Lanțul e cel din dashboard: comanda → planificarea (`psf-ms-sep-1/P1`) → lotul de
croit (`psf-ms-sep-1/P1/C1`).

**Planificarea** ia din pozițiile care mai au ceva neplanificat (urgența întâi,
apoi termenul) și spune pe loc dacă stofa ajunge. Stocul se împarte în ordinea
priorității comenzii, apoi a datei planificării: când stofa nu ajunge pentru toți,
urgentele trec primele. **Doar stofa principală oprește lansarea**; restul
materialelor dau avertisment — ca în dashboard, unde statusul materiei prime și
cel al accesoriilor sunt separate. Lansarea creează lotul cu tot ce a rămas de croit.

**Croitul** vede loturile în patru feluri: tot ce e în croit, de croit, croite și
rămas de croit (pe mărimi, inclusiv diferențele loturilor croite incomplet). Pe
fișa lotului bifează cele nouă etape și, la final, scrie cât s-a croit pe mărimi —
cu motiv din listă dacă diferă de cerut. Într-o singură tranzacție:

- **materia primă scade din stoc**: teoretic, iar pentru stofa principală metrii
  măsurați, dacă s-au scris; **accesoriile scad abia la alimentarea benzii**;
- planificarea trece în croit sau se încheie — singură când nu mai e nimic de
  croit, ori la cerere, cu motiv, când restul nu mai vine.

O planificare încheiată **contează doar cu ce a croit**: restul redevine de
planificat, pentru că comanda tot îl cere. Rezervarea ei de material se eliberează.

## Alimentarea benzii

Un lot croit intră pe bandă în una sau mai multe tranșe (`psf-ms-sep-1/P1/C1/B1`,
`/B2`) — niciodată mai mult decât s-a croit. **Accesoriile ies din depozit aici**,
nu la croit; până atunci rămân rezervate, deci rezervarea lor ține cât lotul e
croit și încă neintrat pe bandă.

O tranșă trece prin intrare în producție, ieșire din producție, CTC și predare
la depozit, fiecare cu ora ei. Ordinea o păzește baza: nu iese din producție ce
n-a intrat.

**Data estimată în depozit**, ca în dashboard: ore-om = bucăți × minute pe bucată
÷ 60; zile = ore-om ÷ (persoane × ore pe zi), rotunjit în sus, de la intrarea în
producție. Orele pe zi sunt un parametru al firmei (8). Fără persoane sau minute
pe bucată nu se estimează nimic — o dată inventată e mai rea decât niciuna.

## Stocul de materiale

Stocul nu e o coloană, e suma fișei de magazie (`miscare_stoc`): fiecare intrare
de la furnizor, consum la croit, ieșire sau ajustare de inventar e un rând, cu
dată, document și semn. Baza verifică semnul după tip (o intrare nu poate scădea
stocul) și cere documentul potrivit (consumul spune lotul, ajustarea spune
inventarul). Aplicația poate **adăuga** rânduri, nu le poate schimba: o greșeală
se corectează cu o mișcare inversă, care rămâne vizibilă.

**Rezervarea se calculează, nu se scrie.** Cât timp o planificare e activă,
materialul pentru ce a rămas de croit din ea e rezervat: rest de croit × consumul
din rețetă. Pe măsură ce croitul înregistrează bucățile croite, rezervarea scade
singură — nu există rezervări uitate.

| | |
|---|---|
| **Stoc** | suma fișei de magazie |
| **Rezervat** | rest de croit din planificările active × consum |
| **Disponibil** | stoc − rezervat |
| **Neplanificat** | ce cer comenzile deschise și n-a intrat încă în planificare × consum |
| **De aprovizionat** | (rezervat + neplanificat) × (1 + pierderi) − stoc |

Pierderile sunt parametri ai firmei (`parametru`), nu numere în cod: 5% tehnologic,
8% defecte de material, 7% neconformități, ca în fila TINTE din dashboard.

**Inventarul** se numără pe o listă; un câmp gol înseamnă nenumărat, nu zero, deci
un inventar parțial (doar stofele) nu golește restul stocului. La închidere,
diferența dintre numărat și fișa de magazie de atunci devine o ajustare.

## Importul din dashboard

```sh
npm run import:dashboard -- dashboard.xlsx   # File → Download → Microsoft Excel
```

Aduce brandurile, categoriile, culorile, materialele (NOM_MATERIALE), modelele cu
rețetele lor (RETETE), produsele (NOM_PRODUSE) și comenzile PSF și PSC. Coloanele se
caută după antet, nu după literă: o coloană inserată în sheet nu mută datele în
câmpul greșit.

- **Totul sau nimic**, într-o singură tranzacție.
- **Se poate rula din nou.** Nomenclatoarele se actualizează după cheia lor; o
  comandă care există deja nu se rescrie, iar materialul ales în aplicație pentru
  o culoare nu se înlocuiește — din clipa în care au intrat, aplicația e sursa lor.
- **Nimic nu se pierde în tăcere.** La final, raportul spune rând cu rând ce n-a
  putut fi potrivit: un produs care nu e în catalog, o comandă fără dată de lansare,
  o culoare scrisă altfel decât în listă.

Primul import, pe sheet-ul din 24 octombrie 2026: 690 de produse, 107 modele cu
1.809 componente de rețetă, 134 de materiale, 227 de comenzi (182 PSF, 45 PSC) cu
9.962 de bucăți. Față de sheet lipsesc exact 20 de bucăți: linia „antoniq turqoise",
al cărei produs nu există în catalog.

## Recepția

`/scanare`, pe telefon. Scanezi eticheta și vezi **cerut / intrat / lipsesc**.
Aplicația propune restul; în cele mai multe cazuri coletul e complet și se apasă
doar „Confirm".

- **Mai puțin** cere motivul din lista `motiv` (doar cele marcate pentru
  recepție) și întreabă dacă restul mai vine. Dacă nu, poziția se închide și nu
  mai primește nimic.
- **Zero bucăți** înseamnă închiderea poziției: cere motiv și observații scrise.
  Baza o impune și ea (0005), nu doar ecranul.
- **Peste cerut** se poate, dar ecranul o spune explicit pe buton și pe o
  poziție deja completă formularul stă ascuns în spatele „Au venit bucăți în
  plus" — a doua scanare a aceleiași etichete arată exact la fel.

Regulile stau în `app/lib/receptie.ts`, nu în ecran. Eticheta se blochează cât
se scrie recepția, ca doi oameni care scanează același colet să nu crediteze de
două ori restul.

Camera citește codurile prin `BarcodeDetector`, care există în Chrome pe Android,
nu și în Safari pe iPhone. Acolo rămâne câmpul de text, în care scrie și un
scanner de mână conectat ca tastatură. Camera cere HTTPS — pe telefon, serverul
de dezvoltare trebuie pornit cu `next dev --experimental-https` sau pus în spatele
unui tunel.
