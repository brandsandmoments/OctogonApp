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
| `db/migrations/0008_stoc_si_inventar.sql` | fișa de magazie, rezervarea din planificări, inventarul, parametrii |
| `db/migrations/0009_planificare_si_croit.sql` | ce i se cere lotului, când s-a croit, încheierea planificării |
| `db/migrations/0010_alimentare_banda.sql` | tranșele de pe bandă, consumul de accesorii, rezervarea lor până la bandă |
| `db/migrations/0011_vanzari_si_eficienta_kam.sql` | vânzările, magazinele Shopify, ținta zilnică a fiecărui PSF |
| `db/migrations/0012_conturi_si_sesiuni.sql` | conturi, parole și PIN-uri (bcrypt, în bază), sesiuni, tablete de atelier |
| `db/migrations/0013_drepturi_pe_zone.sql` | drepturile pe om și pe zonă: vede sau modifică |
| `db/migrations/0014_dezvoltare_produs.sql` | dezvoltarea de produs: tipare, mostre, aprobare, ca jurnal de pași |
| `db/migrations/0015_taiere.sql` | taierea: mai multe PSF și PSC pe același model, tăiate împreună |
| `db/migrations/0021_numerotare_lunara.sql` | numere date de aplicație, pe lună: psf-ms-26-noi-1, t-26-noi-12 |
| `db/migrations/0020_timp_pe_bucata.sql` | timpul de lucru pe bucată, din fișa de produs, pe model |
| `db/migrations/0019_material_pe_culoare.sql` | un material pe fiecare culoare: stofa roșie și cea ivoire au stoc și necesar separat |
| `db/migrations/0018_materie_prima_doar_stofa.sql` | materie primă = stofă și căptușeală, restul accesorii; fără pierderi; bifa „avem materialul” |
| `db/migrations/0017_fisa_de_produs.sql` | referințele cererii de tipar (linkuri, observații, poze) și fișa de produs |
| `db/migrations/0016_croit_pe_taiere.sql` | taierile le face croitul; întins, tăiat, termocolat, împerecheat, metri și defecte pe culoare; operatorii de croit |
| `db/oameni_octogon.sql` | oamenii Octogon și drepturile lor, cum le-a dat conducerea |
| `db/modele_din_denumire.sql` | modele pentru produsele fără rețetă, din denumire („Trench Melissa Crem” → Melissa) |
| `scripts/sync-shopify.mts` | sincronizarea vânzărilor din cele trei magazine Shopify |
| `scripts/import-dashboard.mts` | importul din dashboard-ul Google Sheets |
| `scripts/import-tipare.mts` | importul din „Situație Tipare" |
| `db/test_izolare.sql` | treizeci și nouă de verificări de purtare, rulate pe Postgres 16 |

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

Aplicația setează firma — și omul logat — la fiecare tranzacție:

```sql
SET app.firma_id = '<uuid-ul firmei>';
```

Fără asta, toate interogările întorc zero rânduri. Intenționat. Firma vine din
sesiunea omului logat; doar scripturile (import, sincronizare) o iau din `FIRMA_ID`.

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
- [x] Autentificare și roluri: email + parolă la birou, PIN pe tableta atelierului
- [x] Generarea etichetelor: Code 128 + QR, pe coală A4
- [x] Ecranul de scanare, pe telefon
- [x] Introducerea PSF/PSC, centralizatorul, rețete pe model, necesarul pe comandă
- [x] Stoc și inventar pe materii prime și accesorii: rezervare la planificare, scădere la croit 
- [x] Planificarea și croitul (tot ce e în croit / de croit / croite / rămas de croit)
- [x] Alimentarea benzii: loturile croite intră pe bandă, accesoriile scad din stoc
- [x] Import din dashboard: catalog, modele, rețete, materiale, comenzi PSF/PSC
- [x] Import din dashboard al istoricului: planificări, loturi croite, tranșe pe bandă
- [x] Eficiența KAM, pe săptămână, lună, trimestru și an, din vânzările Shopify; sincronizarea magazinelor (cu tokenuri în .env)
- [x] Dezvoltarea de produs: tipare de făcut, mostre gata, aprobarea KAM-ului, intrarea în catalog
- [ ] Expedierea: comenzile intrate și nelivrate
- [ ] Intrările în depozit din dashboard

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

Meniul urmează drumul comenzii, pe secțiuni — **Comenzi** (PSF, PSC), **Asigură
stoc** (centralizator, planificare, croit, bandă), **Depozit produse finite**,
**Eficiență**, **Dezvoltare produs**, **Materii prime**, **Oameni și conturi** —, iar
ecranele unei secțiuni sunt file sub ea (`app/lib/acces.ts`, `SECTIUNI`). Fiecare om
vede doar secțiunile la care are drept.

| Ecran | Ce arată |
|---|---|
| `/comenzi` | comenzile date, pe file PSF și PSC: cerut, croit, intrat, stadiul liniilor |
| `/etichete/<comanda>` | coala A4 de etichete a comenzii, gata de tipărit |
| `/depozit`, `/depozit/<comanda>` | comenzile de stins, finalizate, toate; intrarea de mână și stingerea cu observații |
| `/scanare` | recepția pe telefon: scanezi eticheta, confirmi ce a intrat |
| `/centralizator` | toate liniile PSF și PSC, pe stadii (necroite, croite, în lucru, gata); necroitele grupate pe model |
| `/comenzi/noua` | PSF sau PSC nouă, cu grila de mărimi |
| `/necesar/<comanda>` | materia primă și accesoriile unei comenzi, plus ce lipsește din rețete |
| `/modele`, `/modele/<id>` | modelele, consumul pe bucată, materialul fiecărei culori |
| `/materiale` | nomenclatorul de materii prime și accesorii |
| `/planificare`, `/planificare/<id>` | de planificat pe model; trimiterea la croit și ordinea de croit; o planificare |
| `/croit`, `/croit/taiere/<id>`, `/croit/<lot>` | toate, croite, rămas de croit (de unde se fac taierile, pe mărimi), taieri, pe perioade; fișa taierii cu operațiile, metrii și croitul; o comandă din taiere |
| `/eficienta/asigura-stoc` | livrările producției față de data cerută: la timp, mai devreme, întârziate, restante |
| `/kam`, `/kam/<kam>` | eficiența KAM pe săptămână, lună, trimestru sau an: ritmul și acuratețea la zi a fiecărui PSF |
| `/banda`, `/banda/<tranșă>` | de alimentat, pe bandă, predate; drumul fiecărei tranșe până la depozit |
| `/stoc`, `/stoc/<id>` | stoc, rezervat, disponibil, de aprovizionat; fișa de magazie a fiecărui material |
| `/inventar`, `/inventar/<id>` | numărătoarea fizică; la închidere, diferențele devin ajustări |
| `/dezvoltare/<id>/fisa`, `…/fisa/excel`, `…/fisa/tipar` | fișa de produs: componente, culori, dimensiuni, cost; Excel și PDF |
| `/dezvoltare`, `/dezvoltare/<id>` | tipare de făcut, în lucru, mostre de aprobat, aprobate; drumul fiecărui model |

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

## Numere, căutare, motive

**Numerele le dă aplicația**, pe lună: comenzile `psf-ms-26-noi-1` (tip, codul
brandului, anul, luna, nr. de ordine pe tip și brand), taierile `t-26-noi-12`; de
la 1 în fiecare lună. Fiecare listă are o **bară de căutare** pe cuvinte, fără
diacritice („sophie neg"). La stingerea unei comenzi (în croit sau în depozit),
**motivul se alege din listă sau se scrie liber**; un motiv scris de mână se ține
sub „Altele", cu vorbele omului în observații. Peste cantitatea din PSF sau PSC
**planifică doar un cont master**; în croit, o taiere nu poate cere mai mult decât
a rămas.

## Rețete și necesar

Rețeta e a **modelului**, nu a produsului. „Trening Echo" consumă la fel în roșu,
bleu sau negru; culoarea schimbă doar *ce* stofă și *ce* fermoar intră, nu *cât*.
Shopify o spune deja: fiecare produs Sleevy poartă un tag `model:echo`.

Așa că rețeta are două jumătăți: `model_componenta` spune cât consumă o bucată
(„stofă principală, 2,1 m"), iar `produs_material` spune ce material concret umple
componenta pentru o culoare anume („Jerseu negru"). Cheile compuse fac imposibil
un nasture pus în locul stofei, o stofă socotită în bucăți sau componenta altui
model — fără nicio linie de cod.

**Materie primă** e doar ce se întinde și se taie: stofa, căptușeala, dantela,
mesh-ul — scade din stoc la croit. **Accesoriile** sunt tot restul: ață, thermo,
fermoare, nasturi, balene, bureți, etichete, pungi — scad la alimentarea benzii.

Necesarul unei comenzi = bucăți cerute × consum, calculat în vederea
`necesar_comanda`, **pe fiecare variație** (culoare): la Amalya Negru nasturi negri,
la Amalya Ivory nasturi albi. **Fiecare culoare e alt material** (0019): „STOFA
DAMARIS · ROSU" și „STOFA DAMARIS · IVOIRE", cu stoc, necesar și rând separat pe lista
de cumpărături — 18 m roșie și 10 m albă, nu 28 m de stofă. Rămân comune doar
accesoriile identice pe orice culoare: etichete, stickere, pungi, acul, balene,
cupe, bureți, pernuțe, umerași, thermo, elastic. Sub variații, totalul pe material. Pierderile nu se
mai adaugă. Necesarul se tipărește pe A4. Un produs fără model, un model fără rețetă sau o
componentă fără material **nu dispar din sumă**: ecranul le arată deasupra
tabelului, pentru că un necesar care tace despre ele pare complet și nu e.

## Planificare și croit

Lanțul e cel din dashboard: comanda → planificarea (`psf-ms-sep-1/P1`) → lotul de
croit (`psf-ms-sep-1/P1/C1`). Lotul e bucata unei comenzi dintr-o **taiere** (`T12`):
ce se întinde și se taie odată.

**Planificarea** arată ce mai e de planificat grupat pe model; planifică tot ce a
rămas pe comenzile bifate, sau alte cantități pe una singură. Pentru fiecare
planificare se vede pe loc dacă stocul o acoperă; stocul se împarte în ordinea
priorității comenzii, apoi a datei planificării, deci urgentele trec primele.
**Înainte de croit, planificatorul bifează fiecare material „îl avem"** — și pe cele
aduse, dar încă neinventariate, pentru că stocul din aplicație nu e mereu la zi. Doar
cu toate bifate planificarea pleacă la croit; se pot trimite mai multe deodată, iar
planificatorul ține ordinea în care vrea să fie croite.

**Taierile le face croitul.** Din „rămas de croit" — ce a trimis planificarea și
n-a intrat încă în nicio taiere, grupat pe model — șefa de croit hotărăște ce taie
odată: o parte dintr-un PSF, un PSF cu alt PSF, un PSF cu un PSC de pe același
model, scriind direct în listă câte bucăți taie din fiecare mărime — doar unele mărimi, sau doar o parte dintr-o mărime. Un PSF se poate împărți în mai multe taieri; ce nu
intră rămâne de croit. Baza refuză o taiere cu două modele. Cât n-a început, se
pot scoate comenzi din ea sau adăuga altele.

**Croitul** are patru file — toate, croite, rămas de croit, taieri (cele în
lucru) — iar taierile se pot grupa pe săptămâni, luni sau ani. Pe **fișa taierii**, pentru fiecare materie primă
(stofa de bază, căptușeala, paietele, mesh-ul):

| | |
|---|---|
| **Întins** | cine, de la ce oră la ce oră; nu se termină fără „am verificat fața materialului" |
| **Tăiat** | cine, de la ce oră la ce oră |
| **Termocolat** | dacă e cazul: cine, de la ce oră la ce oră |
| **Metri și defecte** | pe fiecare culoare (o taiere cu trei culori întinde stofa de bază din trei materiale) |

La final, **împerecheat** (piesele separate pe culori și pregătite pentru lucru) și
**croitul efectiv** pe fiecare comandă și mărime, cu motiv din listă dacă diferă de
cerut. Operatorii de croit (rolul „Operator croit", cu croitul la *vede*) bifează
operațiile, metrii și defectele, de pe tableta atelierului; șefa de croit le
corectează, înregistrează croitul și închide comenzile. Într-o singură tranzacție,
pentru toate comenzile taierii:

- **materia primă scade din stoc**: metrii scriși pe o culoare, împărțiți pe
  comenzile culorii (un PSF și un PSC pe Negru) după bucățile croite, iar unde nu
  s-au scris, consumul teoretic; **accesoriile scad abia la alimentarea benzii**;
- planificarea trece în croit sau se încheie — singură când nu mai e nimic de
  croit, ori la cerere, cu motiv, când restul nu mai vine.

Ce iese mai puțin decât s-a cerut se întoarce în „rămas de croit". De acolo, doar
șefa de croit **stinge o comandă** care nu se mai croiește — s-a renunțat la mărime,
materialul n-a ajuns, era defect —, cu motiv și observații. O planificare încheiată
**contează doar cu ce a croit**: restul redevine de planificat, pentru că comanda
tot îl cere. Rezervarea ei de material se eliberează.

## Alimentarea benzii

Un lot croit intră pe bandă în una sau mai multe tranșe (`psf-ms-sep-1/P1/C1/B1`,
`/B2`) — niciodată mai mult decât s-a croit. **Accesoriile ies din depozit aici**,
singure, fără să le mai treacă cineva; până atunci rămân rezervate.

O tranșă trece prin intrare în producție, ieșire din producție, CTC și predare
la depozit, fiecare cu ora ei. Ordinea o păzește baza: nu iese din producție ce
n-a intrat.

La alimentare se trec operatorii care lucrează la produs și câți sunt. Minutele pe
bucată vin din fișa de produs a modelului. **Orele de lucru** = bucăți × minute pe
bucată ÷ 60, cu +20% sub 50 de bucăți și −15% peste 200; **data estimată în
depozit** = ore ÷ (operatori × ore pe zi), rotunjit în sus, de la intrarea în
producție. Orele pe zi sunt un parametru al firmei (8). Fără operatori sau minute
pe bucată nu se estimează nimic — o dată inventată e mai rea decât niciuna.

## Conturi și roluri

**Biroul** (KAM, manager, admin) intră cu email și parolă. **Atelierul** (croit,
bandă, depozit) intră pe telefonul sau tableta comună: își alege numele și bagă un
PIN de 4–6 cifre. Tableta e înregistrată o dată de admin, de pe ea însăși, din
„Oameni și conturi" — deci un PIN nu e niciodată singura barieră. Sesiunea de birou
ține o săptămână, cea de atelier o tură (12 ore).

```sh
npm run cont:admin -- --email ana@octogonfashion.com --nume "Ana Popescu"   # primul admin
```

Parola se tastează la prompt, ascunsă. Restul conturilor le dă adminul din aplicație.

**Drepturile sunt pe om și pe zonă**, pe două niveluri: *vede* sau *modifică*
(care îl include pe *vede*). Șefa de croit, de pildă, vede PSF-urile și planificarea
fără să le poată schimba, dar lucrează la croit și în gestiunea de materii prime.
Contul master (admin) poate tot și dă drepturi celorlalți, din „Oameni și conturi".

| Zonă | Ce cuprinde |
|---|---|
| Comenzi | pozițiile; *modifică* = dă PSF și PSC |
| Centralizator · Eficiența KAM | doar de văzut |
| Necesar | necesarul pe comandă, modelele, rețetele, nomenclatorul de materiale |
| Planificare · Croit · Bandă | fiecare cu ecranele lui |
| Recepție | scanarea la depozit și etichetele |
| Materii prime | stocul, intrările de la furnizor, inventarul |
| Dezvoltare produs | tiparele și mostrele; KAM-urile cu *Comenzi* pot cere un model nou |
| Expediere | rezervată pentru modulul care urmează |

Rolurile (KAM, șef croit) rămân pentru identitate: lista de KAM din formularul de
PSF și cine poate intra cu PIN din atelier (croit, bandă, depozit). Cine doar vede
o zonă are formularele, dar cu butoanele dezactivate; acțiunea e refuzată oricum
pe server. Accesul se verifică la fiecare pagină și la fiecare acțiune
(`app/lib/sesiune.ts`, `cere(zona, nivel)`).

**Parolele și PIN-urile nu ies din bază.** Se verifică în Postgres, cu bcrypt
(pgcrypto), prin funcții SECURITY DEFINER; tabelele `cont`, `sesiune` și
`dispozitiv` nu au niciun drept acordat rolului aplicației. Sesiunea e un token
aleator, iar în bază stă doar amprenta lui SHA-256. După 5 încercări greșite,
contul se blochează 15 minute; o parolă nouă închide sesiunile vechi. Funcțiile
nu depind de un proprietar care ocolește izolarea pe firme: testul de purtare
rulează și cu un proprietar fără SUPERUSER și fără BYPASSRLS.

**Cine a făcut** se scrie singur: omul logat e declarat în fiecare tranzacție, iar
coloanele „cine" (a scanat, a planificat, a croit, a dat pe bandă, a mișcat stocul)
îl primesc implicit.

## Dezvoltarea de produs

Înlocuiește „Situație Tipare". Acolo statusul se scria de mână lângă bifele TIPAR /
MOSTRĂ / FIȘĂ / APROBAT și se contrazicea cu ele. Aici drumul unui model e **un
jurnal de pași** — început, probă, corecturi, tipar gata, mostră gata, fișă,
aprobat —, fiecare cu data și omul lui, iar starea se calculează din pași
(`dezvoltare_stare`). Jurnalul nu se rescrie: o greșeală se îndreaptă cu un pas nou.

| Secțiune | Ce e acolo |
|---|---|
| Tipare de făcut | cereri la care nu s-a început nimic |
| În lucru | început, probă, corecturi, tipar gata |
| Mostre gata | de aprobat de KAM-ul care a cerut modelul |
| Aprobate | intrate în catalog |

Pașii au o ordine: mostra vine după tipar, iar corecturile cer un motiv — altfel
tiparistul nu știe ce să schimbe — și aduc modelul înapoi în lucru; fiecare rundă
rămâne în istoric. **Mostra o aprobă KAM-ul care a cerut-o** (sau contul master).
La aprobare, modelul intră în catalog cu câte un produs pe culoare, cu SKU și
denumire propuse și modificabile, gata de rețetă.

```sh
npm run import:tipare -- situatie_tipare.xlsx
```

Cererile se văd în ordinea în care au fost făcute, cu data cererii și termenul.
Pozele și un link de Drive se pot pune chiar la cerere.

**Referințele cererii**: linkuri de Drive (clipuri, foldere), observații și poze.
Pozele stau în aplicație (până la 8 MB fiecare); o poză cu o culoare aleasă e poza
produsului în culoarea aceea și intră în fișa de produs. Clipurile rămân pe Drive.

**Fișa de produs** (`/dezvoltare/<id>/fisa`) o completează dezvoltarea și contul
master, ca „Palton Eloria.xlsx": materiile prime (material de bază 1, 2, contrast,
căptușeală…) și accesoriile, fiecare cu furnizor, cod, consum pe bucată și preț;
materialul fiecărei culori, din nomenclator sau unul nou; tabelul de dimensiuni;
manopera și **timpul de lucru pe bucată** (trece pe model, pentru estimarea benzii).
Materialul se caută scriind („tafta negru"); unul nou intră în nomenclator direct
din fișă, cu culoare, furnizor și preț. Componentele salvate stau într-un tabel —
componenta, consumul, furnizorul, materialul fiecărei culori, prețul —, fiecare cu
„editează". Costul pe bucată, pe culoare, se calculează. Fișa se descarcă
în **Excel** (cu pozele și formulele) sau se tipărește / salvează ca **PDF**. La
aprobarea mostrei, fișa devine **rețeta modelului**: componentele, consumurile și
materialul fiecărei culori; materialele noi intră în nomenclator.

Importul citește statusul și bifele din foaie, le face pași și raportează
rândurile care se contrazic. Se poate rula de mai multe ori.

## Eficiența KAM

Cine dă un PSF își asumă și perioada în care se vinde ce a pus în el: la PSF,
KAM-ul și perioada de vânzare a fiecărei linii sunt obligatorii. Din vânzările
reale se măsoară, pe săptămână (luni–duminică), lună, trimestru sau an, cât de
bine a citit piața. O perioadă în curs se socotește până la ultima zi cu vânzări:

| | |
|---|---|
| **De vândut** | volumul PSF împărțit egal pe zilele perioadei |
| **Ritmul perioadei** | vândut în perioadă ÷ de vândut în perioadă |
| **Acuratețea la zi** | 1 − \|vândut până acum − de vândut până acum\| ÷ de vândut până acum |

La finalul perioadei, acuratețea la zi e exact KPI-ul din dashboard (KPI_KAM).
Vânzările se numără brut — comandat pe site, înainte de retururi și anulări —
tot ca în sheet. Pragurile (70% / 85%) sunt parametri ai firmei, din fila TINTE.

Două diferențe față de sheet, ambele intenționate:

- **Suprapunerile se împart.** Când două PSF-uri pe același produs au perioade
  care se suprapun, vânzările zilei se împart după ținta zilnică a fiecăruia.
  Sheet-ul le dădea pe toate fiecăruia, deci aceeași bucată conta la doi KAM.
- **Pe KAM, acuratețea e media ponderată a liniilor**, nu acuratețea sumelor: o
  sumă ar lăsa un PSF supraestimat să compenseze unul subestimat.

Vânzările vin din Shopify (`npm run sync:shopify`). Fiecare magazin își ia
domeniul și tokenul din `.env` (`SHOPIFY_SHOP_<COD>`, `SHOPIFY_TOKEN_<COD>` — o
aplicație custom cu acces `read_orders`); baza nu le ține. Brandul unei vânzări
vine din produs, nu din magazin. Istoricul de până acum vine din fila VANZARI;
aceeași comandă adusă apoi din Shopify o înlocuiește, nu se adaugă.

## Eficiența Asigură stoc

`/eficienta/asigura-stoc`, pe săptămână, lună, trimestru sau an: livrează producția
ce a cerut KAM-ul, la data cerută? Se măsoară pe linia de comandă, față de data
cerută de KAM. Linia e livrată în ziua în care s-a stins ultima ei poziție — a
intrat tot în depozit sau s-a închis. Pentru liniile fără nicio recepție încă
(istoricul din dashboard), contează predarea de pe bandă la depozit.

| | |
|---|---|
| **La timp** | livrate până la data cerută, inclusiv, din cele livrate |
| **Mai devreme · întârziate** | câte, și cu câte zile în medie |
| **Restante** | încă nelivrate, cu data cerută trecută |
| **Bucăți la termen** | câte bucăți au intrat până la data cerută, din cât s-a cerut |
| **Nu mai vin** | bucăți din pozițiile închise, cu motivele lor (rebut, defect de țesătură…) |

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
| **De aprovizionat** | rezervat + neplanificat − stoc |

**Lista de cumpărături** (`/stoc/cumparaturi`) e tot ce e de aprovizionat, pe
furnizori, materii prime și accesorii, cu prețul aproximativ. Fără furnizor,
materialele rămân cu tipul, denumirea și produsele care le cer, ca să se caute unul.
Se tipărește pe A4.

**Inventarul** se numără pe o listă; un câmp gol înseamnă nenumărat, nu zero, deci
un inventar parțial (doar stofele) nu golește restul stocului. La închidere,
diferența dintre numărat și fișa de magazie de atunci devine o ajustare.

## Importul din dashboard

```sh
npm run import:dashboard -- dashboard.xlsx   # File → Download → Microsoft Excel
```

Aduce brandurile, categoriile, culorile, materialele (NOM_MATERIALE), modelele cu
rețetele lor (RETETE), produsele (NOM_PRODUSE), comenzile PSF și PSC, apoi istoricul
de producție: planificările (PLANIFICARE), loturile croite (CROIT) și tranșele de pe
bandă (ALIMENTARE_BANDA), legate prin ID-urile din sheet. Coloanele se
caută după antet, nu după literă: o coloană inserată în sheet nu mută datele în
câmpul greșit.

- **Totul sau nimic**, într-o singură tranzacție.
- **Se poate rula din nou.** Nomenclatoarele se actualizează după cheia lor; o
  comandă care există deja nu se rescrie, iar materialul ales în aplicație pentru
  o culoare nu se înlocuiește — din clipa în care au intrat, aplicația e sursa lor.
- **Nimic nu se pierde în tăcere.** La final, raportul spune rând cu rând ce n-a
  putut fi potrivit: un produs care nu e în catalog, o comandă fără dată de lansare,
  o culoare scrisă altfel decât în listă.

**Istoricul nu scrie în fișa de magazie.** Stocul de materiale n-a fost ținut
niciodată, deci un consum istoric ar duce stocul pe minus fără sens; stocul
pornește din inventar. Datele se importă cum sunt, și când încalcă regulile de acum
(croit peste cerut, bandă peste croit) — istoria s-a întâmplat — dar fiecare caz e
în raport. Un lot care lipsește din CROIT, dar are bucăți pe bandă, se reface din
tranșă; o planificare care lipsește, dar are lot, se reface din lot.

Primul import, pe sheet-ul din 24 octombrie 2026: 690 de produse, 107 modele cu
1.809 componente de rețetă, 134 de materiale, 227 de comenzi (182 PSF, 45 PSC) cu
9.962 de bucăți. Față de sheet lipsesc exact 20 de bucăți: linia „antoniq turqoise",
al cărei produs nu există în catalog. Istoricul: 353 de planificări, 351 de loturi
(7.097 buc croite), 198 de tranșe (5.603 buc pe bandă). Planificat, cerut la loturi
și croit se potrivesc la bucată cu sheet-ul, după rândurile raportate ca sărite;
banda la fel, după tranșele de pe comenzi sau produse care nu există.

## Depozitul de produse finite

`/depozit` are lista PSF-urilor și PSC-urilor așteptate, pe trei file: **de stins**
(lipsește ceva), **finalizate** și **toate**, grupabile pe săptămâni, luni,
trimestre sau ani. O comandă se stinge:

- **prin scanare**, pe telefon (mai jos);
- **de mână**, pe fișa comenzii: câte au venit azi, pe fiecare poziție. O livrare
  parțială lasă comanda de stins până vine restul; pozițiile fără etichetă o
  primesc atunci, pentru că recepția stă pe etichetă;
- **la un clic**, „restul nu mai vine": fiecare poziție deschisă se închide pe
  zero, cu motiv și observații.

Când toate pozițiile sunt stinse — intrate integral sau închise —, comanda se
închide singură și trece la finalizate. Stinge doar cine are „Recepție" la
*modifică*: KAM-ii, depozitul și contul master.

## Recepția

`/scanare`, pe telefon. Scanezi eticheta și vezi **cerut / intrat / lipsesc**.
Aplicația propune restul; în cele mai multe cazuri coletul e complet și se apasă
doar „Confirm".

- **Mai puțin** e o livrare parțială: restul rămâne de stins. Dacă restul nu mai
  vine, poziția se închide cu motivul din lista `motiv` (doar cele marcate pentru
  recepție) și nu mai primește nimic.
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
