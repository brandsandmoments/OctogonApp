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
| `db/test_izolare.sql` | nouă verificări de purtare, rulate pe Postgres 16 |

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
- [ ] Generarea etichetelor: Code 128 + QR, pe coală A4
- [ ] Ecranul de scanare, pe telefon
- [ ] Import din Google Sheets, ca oglindă read-only

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

## Mărimile

Grila principală e XXS–2XL. Denumirea numerică EU stă alături, pe aceeași mărime:

| XXS | XS | S | M | L | XL | 2XL |
|---|---|---|---|---|---|---|
| 32 | 34 | 36 | 38 | 40 | 42 | 44 |

Nu sunt mărimi separate. Dacă ar fi rânduri distincte, cele 7 ar deveni 14 și
fiecare cantitate s-ar împărți în două. `marime_alias` acoperă și cum le scriu
alte sisteme — Shopify Sleevy trimite `2XS` unde noi scriem `XXS`.
