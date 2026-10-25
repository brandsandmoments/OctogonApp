# Glosar RO → EN

Numele din schemă sunt în română; descrierile sunt în engleză și stau în baza de
date, nu într-un fișier care se desincronizează. `SELECT * FROM glosar;` le arată
oricând. Fișierul ăsta e aceeași informație, pentru citit pe hârtie.

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

## `culoare`

Colour.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `nume` | Colour name |

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
| `unitate` | Unit of measure: m, kg, buc (pieces), set, m2 |
| `furnizor` | Supplier |
| `activ` | Active |
| `creat_la` | Created at |

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
| `tip` | Raw material or accessory |
| `unitate` | Unit the consumption is expressed in |
| `consum` | Consumption per finished piece, in that unit |
| `ordine` | Display order |

## `motiv`

Reason, from a fixed list. Free text here means nothing can be counted, and counting is the point: how many pieces did we lose to short fabric this year?

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `cod` | Reason code |
| `nume` | Reason as shown to the user, in Romanian |
| `contexte` | Where this reason may be picked: croit (cutting), receptie (goods receipt) |
| `activ` | Active |

## `planificare`

Planning batch. Decides how much of an order line goes into production now; one line may yield several batches.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `linie_id` | Order line being planned |
| `numar_transa` | Batch number within that line |
| `planificat_de` | Planned by |
| `data_planificare` | Planning date |
| `stadiu` | Stage: fara_cantitate (nothing planned), blocat_materiale (blocked, missing materials), gata_de_lansat (ready to release), lansat_spre_croit (released to cutting), in_croit (in cutting), anulat (cancelled) |
| `observatii` | Notes |

## `planificare_cantitate`

Planned quantity per size. What will actually be cut, which may be less than ordered.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `planificare_id` | References planificare. |
| `marime_id` | References marime. |
| `cantitate` | Quantity, pieces |

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

## `utilizator`

User. Belongs to exactly one company.

| coloană | english |
|---|---|
| `firma_id` | Owning company. Row-level security filters every query by it. |
| `nume` | Full name |
| `email` | Email, unique within the company; used to sign in |
| `roluri` | Roles: kam (key account manager), planificator (planner), croit (cutting), banda (assembly line), depozit (warehouse), admin |
| `activ` | Active |
| `creat_la` | Created at |
