# Glosar RO → EN

Numele din schemă sunt în română; descrierile sunt în engleză și stau în baza de
date, nu într-un fișier care se desincronizează. `SELECT * FROM glosar;` le arată
oricând. Fișierul ăsta e aceeași informație, pentru citit pe hârtie.

## `alimentare_banda`

Line feeding tranche: part of a cut batch sent into sewing. A batch may go in several tranches (…/C1/B1, B2).

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `numar` | Tranche number within the cutting batch |
| `alimentat_la` | Fed to the line at |
| `alimentat_de` | Fed by |
| `responsabil` | Line lead responsible, as free text until users exist |
| `persoane` | People assigned on the line |
| `timp_min_buc` | Production minutes per piece |
| `intrat_productie_la` | Entered production at |
| `iesit_productie_la` | Left production at |
| `ctc_la` | Through quality control and packing at |
| `predat_depozit_la` | Handed to the warehouse at |
| `observatii` | Notes |

## `alimentare_cantitate`

Pieces fed to the line in one tranche, per size. Never more than was cut.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `cantitate` | Pieces fed |

## `brand`

Brand. A company may run several (Parseea, Maison Loulou, Sleevy).

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `nume` | Brand name |
| `activ` | Active |

## `categorie`

Product category: dress, coat, suit, tracksuit.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `nume` | Category name |

## `comanda`

Production order header. PSF = firm seasonal order placed by a key account manager; PSC = supplementary order. Written once; its lines hang off it.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `numar` | Order number: psc-sep-26-1 |
| `tip` | Order type: PSF or PSC |
| `brand_id` | References brand. |
| `data_lansare` | Launch date. Required: a line without it used to be invisible to the whole chain. |
| `kam_id` | Key account manager who placed it |
| `prioritate` | Priority, 1 urgent to 5 lowest |
| `stare` | State: ciorna (draft), lansata (launched), in_productie (in production), inchisa (closed), anulata (cancelled) |
| `observatii` | Notes |
| `creat_la` | Created at |

## `comanda_cantitate`

Ordered quantity per size. Rows, not seven columns.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `linie_id` | Order line |
| `marime_id` | References marime. |
| `cantitate` | Quantity, pieces |

## `comanda_linie`

Order line. One product in one order.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `comanda_id` | References comanda. |
| `produs_id` | References produs. |
| `data_ceruta` | Date the goods are required in the warehouse |
| `vanzare_de_la` | Selling window, from |
| `vanzare_pana_la` | Selling window, to |
| `observatii` | Notes |

## `cont`

Credentials: bcrypt password and PIN hashes, failed attempts, lockout. No privileges for the application role; reachable only through SECURITY DEFINER functions.

| coloană | english |
|---|---|
| `firma_id` | Company of the account, so sign-in never needs to bypass row-level security |
| `email` | Sign-in email, kept equal to utilizator.email by a trigger |
| `parola_hash` | bcrypt hash of the password; null when the person does not sign in with a password |
| `pin_hash` | bcrypt hash of the workshop PIN; null when the person does not sign in from the workshop |
| `incercari_esuate` | Consecutive failed sign-in attempts |
| `blocat_pana` | Locked until; set after 5 failed attempts |
| `parola_schimbata_la` | Password last changed at |

## `culoare`

Colour.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `nume` | Colour name |

## `dezvoltare`

A model in development: pattern to make, sample, approval. Replaces the Situatie Tipare sheet.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `model` | Model name |
| `culori` | Colours requested, as marketing wrote them |
| `tip` | Kind of work: new pattern, pattern change, size grading, model variation |
| `marime_de_la` | Smallest size to grade |
| `marime_pana_la` | Largest size to grade |
| `prioritate` | Priority, 1 urgent to 5 lowest |
| `termen` | Deadline |
| `kam_id` | KAM who asked for it; approves the sample |
| `link_poze` | Drive folder with photos |
| `link_fisa` | Product sheet |
| `observatii` | Notes |
| `model_id` | Catalogue model created on approval |
| `creat_de` | Created by |
| `creat_la` | Created at |
| `manopera` | Labour cost per piece, on the product sheet |

## `dezvoltare_pas`

Step log of a model in development. Append-only; the status is derived from it.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `pas` | Step: inceput (started), proba (fitting), corecturi (corrections, with reason), tipar_gata (pattern done), mostra_gata (sample done), fisa_gata (product sheet done), aprobat (approved by the KAM), anulat (cancelled) |
| `la` | When |
| `de` | By whom |
| `observatii` | Notes; required for corrections |

## `dezvoltare_referinta`

References attached to a pattern request: Drive links, notes, photos. Photos marked with a colour appear on the product sheet.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `tip` | Kind: link, nota (note), poza (photo) |
| `text` | Note text, or the description of a link or photo |
| `url` | Link (Drive folder, video) |
| `fisier` | Photo bytes, up to 8 MB |
| `mime` | Photo media type |
| `culoare` | Colour the photo shows; such photos go on the product sheet |
| `creat_de` | Added by |
| `creat_la` | Added at |

## `dispozitiv`

Shared workshop device registered by an admin. Its token lets the people of that company sign in with a PIN.

| coloană | english |
|---|---|
| `nume` | Device name |
| `amprenta` | SHA-256 of the device token |
| `inregistrat_la` | Registered at |
| `revocat_la` | Revoked at; a revoked device cannot sign anyone in |

## `drept`

What a person may do, per area: see (vede) or change (modifica, which includes seeing). Admins need no rows: they may do everything.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `zona` | Area: comenzi (PSF/PSC orders), centralizator, kam (KAM efficiency), necesar (material requirement, recipes), planificare (planning), croit (cutting), banda (line), receptie (finished-goods receipt, labels), materiale (raw-material stock and stock counts), dezvoltare (product development), expediere (shipping) |
| `nivel` | Level: vede (see) or modifica (change) |

## `etapa_croit`

Cutting stage. Data, not checkbox columns: this company has nine, another has seven.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `cod` | Stage code |
| `nume` | Stage name |
| `ordine` | Stage order |

## `eticheta`

Label. Issued per order position (line plus size) when the order is launched, and never reused on another order. Scanning it is what credits goods to that order.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `cod` | Short opaque serial printed as Code 128 and QR: OCT-7F3K2M9. The order number and SKU are printed as readable text beside it, never encoded in the barcode, so a renumbered order does not invalidate printed labels. |
| `linie_id` | Order line this label belongs to |
| `marime_id` | Size this label belongs to |
| `pozitie` | Position number within the order, for humans: position 4 of 12 |
| `tiparita_de` | Printed by |
| `tiparita_la` | Printed at |
| `anulata_la` | Voided at |

## `firma`

Tenant. One garment company. Every other table carries firma_id and is isolated by row-level security.

| coloană | english |
|---|---|
| `nume` | Company name |
| `slug` | URL-safe short name |
| `activa` | Active |
| `creat_la` | Created at |

## `fisa_componenta`

Product sheet line: a material or accessory of the model, with supplier, code, consumption and price. Becomes the model recipe on approval.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `ordine` | Order on the sheet |
| `nume` | Component name: base fabric 1, contrast, lining, buttons |
| `tip` | Raw material or accessory |
| `unitate` | Unit |
| `consum` | Consumption per piece |
| `principal` | Main fabric |
| `furnizor` | Supplier |
| `cod` | Supplier code, when the same for every colour |
| `material_id` | Catalogue material, when the same for every colour |
| `pret` | Price per unit |

## `fisa_culoare_material`

Material of a product sheet component in one colour, when it differs by colour

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `culoare` | Colour, as on the request |
| `material_id` | Catalogue material, if it exists |
| `cod` | Supplier code of a new material |
| `denumire` | Name of a new material; created in the catalogue on approval |
| `pret` | Price per unit for this colour, if different |

## `fisa_masura`

Size chart line on the product sheet: bust, waist, hip, length, per size

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `ordine` | Order on the sheet |
| `nume` | Measurement name |
| `valori` | Value per size code |

## `inventar`

Physical stock count. Closing it writes the differences to the ledger as adjustments.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `data` | Count date |
| `descriere` | Description: full count, fabrics only |
| `deschis_la` | Opened at |
| `inchis_la` | Closed at; once closed, the count is final |
| `inchis_de` | Closed by |

## `inventar_linie`

One counted material in a stock count.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `cantitate_numarata` | Quantity physically counted |
| `stoc_scriptic` | Book stock at closing time; the adjustment is counted minus this |
| `numarat_la` | Counted at |

## `lot_croit`

Cutting batch. Cannot exist without a planning batch: that constraint is what prevents the orphan batches the spreadsheet accumulated.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `planificare_id` | Planning batch it came from, required |
| `numar_lot` | Batch number within that planning batch |
| `lansat_de` | Released by |
| `data_primire` | Date cutting received the batch |
| `responsabil_id` | Cutting room lead responsible |
| `observatii` | Notes |
| `croit_la` | When the cut was recorded. Null means still to cut. |
| `croit_de` | Who recorded the cut |
| `taiere_id` | The cut this batch was cut in |

## `lot_croit_cantitate`

What a cutting batch was asked to cut, per size: the planning batch's remaining pieces at release time. Fixed afterwards; the cut quantities are measured against it.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `cantitate` | Pieces asked of the cutting room |

## `lot_croit_efectiv`

Pieces actually cut, per size. Differs from planned when fabric runs short, and then carries a reason.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `lot_id` | References lot_croit. |
| `marime_id` | References marime. |
| `cantitate` | Pieces actually cut |
| `motiv_id` | Reason for the difference against the planned quantity |

## `lot_etapa`

Stage reached by a cutting batch, with who ticked it and when.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `lot_id` | References lot_croit. |
| `etapa_id` | References etapa_croit. |
| `bifat_la` | Ticked at |
| `bifat_de` | Ticked by |

## `magazin`

Shopify store of a brand. Its domain and access token live in the environment (SHOPIFY_SHOP_<cod>, SHOPIFY_TOKEN_<cod>), never in the database.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `cod` | Store code; suffix of its environment variables |
| `sincronizat_pana_la` | Orders updated up to this moment have been read |
| `activ` | Active |

## `marime`

Size. Rows, not columns: one company uses XXS-2XL, another 36-46. A size list in code would make the product unsellable.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `cod` | Primary size code as used on orders: XXS, M, 2XL |
| `ordine` | Display order, smallest first |
| `cod_numeric` | Parallel EU numeric name for the same size: 32, 38, 44 |

## `marime_alias`

Size alias. How an external system spells a size we already have: Shopify sends 2XS where we store XXS.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `marime_id` | References marime. |
| `sursa` | Source system: shopify, easyscan, partener |
| `alias` | Spelling used by that source |

## `material`

Raw material (fabric, lining) or accessory (zip, button, label) kept in stock.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `tip` | Kind: materie_prima (raw material, fabric) or accesoriu (accessory, trim) |
| `cod` | Material code, internal or supplier's |
| `denumire` | Material name |
| `culoare_id` | Colour of the material: a fabric or a button in red is a different material from the same in ivory, with its own stock |
| `unitate` | Unit of measure: m, kg, buc (pieces), set, m2 |
| `furnizor` | Supplier |
| `activ` | Active |
| `creat_la` | Created at |
| `familie` | Material family as purchasing groups it: fabric, buttons, haberdashery, elastic |
| `pret_referinta` | Reference unit price, RON, per unit of measure |

## `miscare_stoc`

Stock ledger for raw materials and accessories. Stock is the sum of this table, never a stored figure. Rows are append-only: mistakes are corrected with a reversing row.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `tip` | Movement kind: intrare (receipt from supplier), consum_croit (raw material used in cutting), consum_banda (accessories used on the line), ajustare_inventar (stock count correction), iesire (other issue), retur_furnizor (return to supplier) |
| `cantitate` | Signed quantity in the material's unit: positive in, negative out. The sign must match the kind. |
| `data` | Movement date |
| `furnizor` | Supplier, on receipts and returns |
| `document` | Supporting document: invoice, delivery note, receiving report |
| `pret_unitar` | Unit price, RON, on receipts |
| `lot_id` | Cutting batch that consumed it. Required on consumption. |
| `inventar_id` | Stock count that produced the adjustment. Required on adjustments. |
| `observatii` | Notes |
| `creat_de` | Recorded by |
| `creat_la` | Recorded at |
| `alimentare_id` | Line feeding tranche that consumed it. Required on line consumption. |

## `model`

Garment model, shared by all its colours: Trening Echo. The recipe belongs here, so a new colour needs no new recipe.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `cod` | Model code, as in the Shopify tag model:echo |
| `denumire` | Model name |
| `activ` | Active |
| `creat_la` | Created at |

## `model_componenta`

Recipe line of a model: which component, how much per finished piece. The material that fills it is chosen per product.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `nume` | Component name: main fabric, lining, zip |
| `tip` | Raw material (fabric, lining: spread and cut on the table, consumed at cutting) or accessory (thread, zips, buttons, interfacing: consumed at line feeding) |
| `unitate` | Unit the consumption is expressed in |
| `consum` | Consumption per finished piece, in that unit |
| `ordine` | Display order |
| `principal` | Main fabric of the model: the one cutting depends on. At most one per model. |

## `motiv`

Reason, from a fixed list. Free text here means nothing can be counted, and counting is the point: how many pieces did we lose to short fabric this year?

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `cod` | Reason code |
| `nume` | Reason as shown to the user, in Romanian |
| `contexte` | Where this reason may be picked: croit (cutting), receptie (goods receipt) |
| `activ` | Active |

## `parametru`

Company operating parameters: loss percentages and the like. Data, not code.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `cheie` | Parameter key |
| `valoare` | Value; percentages as fractions (0.05 = 5%) |
| `descriere` | What the parameter means |

## `planificare`

Planning batch. Decides how much of an order line goes into production now; one line may yield several batches.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `linie_id` | Order line being planned |
| `numar_transa` | Batch number within that line |
| `planificat_de` | Planned by |
| `data_planificare` | Planning date |
| `stadiu` | Stage: fara_cantitate (nothing planned), blocat_materiale (blocked, missing materials), gata_de_lansat (ready to release), lansat_spre_croit (released to cutting), in_croit (in cutting), incheiat (closed), anulat (cancelled) |
| `observatii` | Notes |
| `incheiat_la` | When the planning batch was closed: fully cut, or closed short. Closing releases its material reservation. |
| `motiv_incheiere_id` | Reason, when closed with pieces left uncut |
| `observatii_incheiere` | Notes on closing with pieces left uncut; required with a reason |
| `ordine_croit` | Order in which planning wants it cut; the cutting room sees what is left to cut in this order |

## `planificare_cantitate`

Planned quantity per size. What will actually be cut, which may be less than ordered.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `planificare_id` | References planificare. |
| `marime_id` | References marime. |
| `cantitate` | Quantity, pieces |

## `planificare_material`

Materials the planner confirmed are on hand for a planning batch, before sending it to cutting. Stock in the app may lag reality.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `bifat_de` | Who confirmed it |
| `bifat_la` | When |

## `produs`

Product. One row per model and colour, matching one Shopify product.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `cod_sku` | SKU prefix shared by all size variants: PSA-SOPHIE-NEGRU |
| `denumire` | Product name, identical to the Shopify title so sales match automatically |
| `brand_id` | References brand. |
| `culoare_id` | References culoare. |
| `categorie_id` | References categorie. |
| `activ` | Active |
| `creat_la` | Created at |
| `model_id` | Model this product is a colour of. Optional while products are being mapped; without it the product has no recipe. |

## `produs_material`

Which material fills each recipe component for one product (model + colour). Composite keys keep model, kind and unit consistent.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `tip` | Copied from the component; the composite key keeps it equal to the material's |
| `unitate` | Copied from the component; the composite key keeps it equal to the material's |

## `receptie`

Goods receipt. One scan of one label. Quantities are summed from here, never stored on the position, so the progress figure cannot drift.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `eticheta_id` | Label scanned |
| `cantitate` | Pieces received in this scan. Zero only when the row closes the position and carries notes. |
| `scanat_de` | Scanned by |
| `scanat_la` | Scanned at |
| `motiv_id` | Reason, required when the position is closed short |
| `inchide_pozitia` | Closes the position short: the rest is not coming |
| `observatii` | Notes. Required when the position is closed with zero pieces. |

## `sesiune`

Sign-in sessions. Only the SHA-256 of the token is stored; the token lives in the browser cookie.

| coloană | english |
|---|---|
| `firma_id` | Company of the session |
| `amprenta` | SHA-256 of the session token |
| `din_atelier` | Signed in from a workshop device with a PIN; such sessions last one shift |
| `creat_la` | Created at |
| `expira_la` | Expires at |
| `folosita_la` | Last used at |

## `taiere`

A cut: what the cutting room spreads and cuts at once — part of an order, or orders of the same model together. Each order's share is a cutting batch (lot_croit).

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `numar` | Cut number, shown as T12 |
| `ordine` | Order of creation in the cutting room |
| `creat_de` | Created by |
| `creat_la` | Created at |
| `trimis_la` | When the cut was put together in the cutting room |
| `trimis_de` | Who put it together |
| `observatii` | Notes |

## `taiere_material`

Material actually used by a cut, per component and colour: metres and fabric defects. The metres of a colour are split across its orders by pieces cut.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `componenta_id` | Material component of the model |
| `produs_id` | Product, that is the colour |
| `material_id` | Material of that colour for the component |
| `metri` | Metres actually used |
| `defecte` | Fabric defects found |
| `scris_de` | Who recorded it |
| `scris_la` | Recorded at |

## `taiere_operatie`

Work done on a cut, per material component: spreading, cutting, thermofusing; pairing for the whole cut. Who, from when to when.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `componenta_id` | Material component of the model (main fabric, lining, sequins). Null for pairing, which covers the whole cut. |
| `operatie` | Operation: intins (spreading), taiat (cutting), termocolat (thermofusing), imperecheat (pairing, sorting by colour, preparing for sewing) |
| `operator_id` | Who did it |
| `inceput_la` | Started at |
| `terminat_la` | Finished at. Null means still in progress. |
| `fata_verificata` | Spreading: the operator confirmed the right side of the fabric. Required to finish spreading. |
| `observatii` | Notes |
| `scris_de` | Who recorded it |
| `scris_la` | Recorded at |

## `utilizator`

User. Belongs to exactly one company.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `nume` | Full name |
| `email` | Email; required once sign-in exists, optional until then |
| `roluri` | Roles: kam (key account manager), head_of_sales, planificator (production manager), croit (cutting lead), banda (line lead), depozit (warehouse keeper), dezvoltare (product development), admin |
| `activ` | Active |
| `creat_la` | Created at |

## `vanzare`

One order line sold on a store: gross demand, before returns and cancellations. One row per order and SKU, whichever source brought it.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `nr_comanda` | Store order number: #21591 |
| `sku` | Variant SKU as sold |
| `data` | When the customer ordered |
| `produs_id` | Product the SKU belongs to; null when the SKU is not in the catalogue |
| `marime_id` | Size the SKU belongs to |
| `cantitate` | Pieces ordered |
| `valoare` | Line value, RON |
| `sursa` | Where the row came from: shopify (synced) or dashboard (imported history) |
