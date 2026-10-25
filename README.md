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

- [ ] Stabilit stack-ul aplicației (vezi conversația — e singura decizie care blochează)
- [ ] Migrarea 0003: motive de diferență, legate de `lot_croit_efectiv` și `receptie`
- [ ] Import din Google Sheets, ca oglindă read-only
- [ ] Ecranul de croit, pe telefon
- [ ] Generarea etichetelor: Code 128 + QR, pe coală A4
