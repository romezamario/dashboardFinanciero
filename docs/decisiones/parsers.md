# Parsers: historial de decisiones y lecciones

Movido desde `CLAUDE.md` (2026-10-10) para que ese archivo quede con las reglas vigentes. Aquí está
el *porqué* de cada detalle de `parsers/banamex.py`, `parsers/banamex_tdc.py` (incl. `glifos.py`) e
`parsers/invex_tdc.py`, con las fechas y los PDFs reales que lo confirmaron. Léelo antes de cambiar
uno de esos parsers o de escribir uno nuevo. Se conserva en inglés, como estaba.

**Lessons from writing `parsers/banamex.py`, worth checking before writing any new bank parser:**
- `pagina.extract_tables()` is not reliable — some banks' PDFs look like ruled tables visually but
  have no real vector gridlines pdfplumber can detect (confirmed via the app's anonymized
  "Inspeccionar PDF..." output: 0 tables found). Try it, but be ready to fall back to
  `extract_text()` + block-grouping by a leading date pattern.
- Don't infer cargo/abono from the description text or from which "column" a printed amount
  looked like it was in — real statements lie (e.g. Banamex prints "CREDITO NOMINA ... A SU TC"
  for what is actually an automatic charge to a credit card, saldo going *down*). Derive the
  signed amount from the delta between consecutive running-balance ("saldo") values instead —
  the statement always prints saldo correctly, even when the description is misleading.
- A transaction can be split across a page boundary (concept lines end on one page, the
  closing amount+saldo line starts the next, no repeated date). Process the whole document as
  one flat stream of `(pagina, linea)` tuples, not per-page, or you'll silently drop or fork
  transactions at page breaks.
- **`BanamexParser.advertencias()`** (added 2026-09-26): the checking parser used to drop a
  transaction silently in three cases — a dated block that never closed with amount+balance before
  the next date, a block before the "SALDO ANTERIOR" anchor (no previous balance to diff against),
  and a block still open at the end of the document. Each now produces a warning the app shows
  like the TDC parsers' ones. A "balance changed with no open block" warning was considered and
  left out: summary/total lines at the end of a real statement may also end in two amounts, and
  without a real PDF to check against it risked false positives.

**`parsers/banamex_tdc.py`** (Banamex credit card, e.g. TDC Platino) is a structurally different
document from the checking account above, despite being the same bank — don't assume a second
statement from a bank you already support will look anything like the first one:
- No running-balance column per transaction at all, so the delta-of-saldo trick doesn't apply
  here — this parser trusts the printed `+`/`-` sign directly: `+` = cargo (compra, increases
  balance owed), `-` = abono (pago, decreases it). **Confirmed against a real "-" row**
  (2026-09-20, a TDC Beyond statement): a line reading `"...SU ABONO...<texto> - $X,XXX.XX"` — the
  `-` sign next to the word "ABONO" in the concept corroborates the mapping as implemented; no
  longer a best-effort assumption.
- Each transaction is exactly one line (`fecha_compra fecha_aplicacion concepto +$monto`) — no
  multi-line concept blocks to group, unlike the checking account's SPEI-transfer paragraphs.
- The year rides along in every row's own date (`"DD-mon-AAAA"`, lowercase abbreviated month) —
  no cover-page year detection needed here, unlike the checking account. Converted to `DD/MM/AAAA`
  via a small `MESES` lookup (`strptime`'s `%b` is locale-dependent and would need the system
  locale set to Spanish to parse "jun" — don't rely on it).
- **`puede_procesar` must not require "BANAMEX" as plain text**: the first version gated on
  "BANAMEX" **and** "PAGO MÍNIMO" both appearing in the first 2 pages (mirroring the checking
  parser's pattern) — but confirmed against a real TDC statement, "BANAMEX" never appears as
  selectable text on those pages at all (the cover-page logo is an image; unlike the checking
  account, this statement doesn't repeat the bank name in any transaction concept either), so
  auto-detection silently never fired and the user had to pick the bank manually every time.
  Fixed by dropping the "BANAMEX" requirement — "PAGO MÍNIMO" alone is already exclusive to a
  credit-card statement (the checking account has no minimum-payment concept), so it's a
  sufficient marker on its own. Lesson: don't assume a marker that worked for one Banamex
  document type transfers to another — verify against the real anonymized dump, not just what
  seems structurally similar.
- **A transaction row can be visually present but textually unrecoverable**: confirmed on a real
  statement — an "abono" (payment received) row prints in bold as a highlighted confirmation line
  ("SU ABONO...GRACIAS"), and `extract_text()` only picks up the row's two leading dates; the
  concept and amount are rendered as an image, not selectable text, so there is nothing for a
  regex to match — the amount genuinely cannot be recovered from `extract_text()`. Added
  `PATRON_PREFIJO_FECHAS` + `BaseParser.advertencias()` (new optional hook, default `[]`, same
  best-effort pattern as `puede_procesar`/`extraer_info_cuenta`) so a line matching the two-date
  prefix but not the full transaction pattern gets surfaced as a warning instead of silently
  vanishing — `App._al_leer_pdf` shows it in the resumen and a messagebox so the user knows to
  capture that row by hand before trusting the totals. This is the general escape
  hatch for "PDF renders this row as an image" cases in any future parser, not just this one.
- **Older "2024 format" (statements up to 2024-10) — same parser, second variant (2026-10-05)**:
  confirmed on 7 real statements (Platino, Beyond, Conquista; 2024-08 → 2024-10) that previously
  extracted **0 rows** while still being auto-detected. Rows are `"Mes día CONCEPTO monto"` with
  **no year** (taken from the cover's period, `"Del … al <día> de <mes> de <año>"`; months after
  the cutoff month belong to the previous year, for periods crossing Dec→Jan), **no `+`** (a cargo
  has nothing; an abono ends in `" -"`), and foreign-currency purchases take **two lines** (concept
  line without amount, then `"EURO 50.00 950.00"` / `"U.S. DOLLAR …"`, sometimes with `"TC1* …"`
  exchange-rate info first — the MXN amount is always the last number; `linea_cruda` joins both
  with `" | "`). Only lines between `"Detalle de Operaciones"` and the next `"Detalle de Pagos"` (SPEI
  detail, which repeats the PAGO INTERBANCARIO rows already listed), `"… EN PESOS MONEDA NACIONAL"`
  (MSI / deferred-purchase tables whose `"Abr 10 … 3 de 12 …"` rows are NOT period movements) or
  `"RESUMEN DE SU …"` are read. Card = "Titular" until `"Por su Tarjeta Adicional: …"`. A one-line
  `"PAGO INTERBANCARIO … -"` abono becomes `"PAGO RECIBIDO"` (the generic rule would call it an
  outgoing transfer); the `"SU ABONO…"` courtesy rewrite still applies. Validated: on all 7 PDFs the
  sum of extracted cargos and abonos matches the cover totals to the cent, 0 warnings; the 65
  current-format statements produce byte-identical output to before. Handled by
  `procesar_linea_2024` inside `extraer()`, which runs before the current-format logic and only
  claims lines in that section, so it can't affect current-format documents.
- **Image rows are now READ, not just flagged (2026-10-02, `parsers/glifos.py`)**: checked against
  the user's 144 real PDFs, the "image" rows aren't one picture — each character is its own 1-bit
  image mask placed where the letter goes, and the bank always uses the same bitmap for the same
  character (7,585 glyph images in those rows = only 66 distinct bitmaps). So no OCR: `GLIFOS` maps
  a bitmap fingerprint (`_huella`: sha1 of size + decoded data) to `(character, advance)`; spaces
  aren't images, they're inferred when the next glyph starts farther than that glyph's normal
  advance + `UMBRAL_ESPACIO` (advances measured from the same PDFs; positions are quantized to
  0.3 pt). "I" and "l" share one bitmap (resolved by whether the previous letter is lowercase).
  Some boxes ("$", ",", "-") sit a few pt lower and are merged back into the nearest row
  (`_agrupar_en_renglones`) — without that, amounts came out as "$00 000.00" with no comma or sign.
  `completar_lineas_con_imagenes` only touches a line that is *just the two dates*
  (`PATRON_SOLO_FECHAS`) and the block it opens (until the next line starting at the same left
  margin), rebuilding each row from its text words + glyphs by x position — there are blocks where
  everything but the dates is an image ("SU ABONO...GRACIAS"), and PAGO INTERBANCARIO blocks where
  labels and amount are images but values are text on the same row. Result on the real PDFs: all
  113 previous warnings became rows (98%+ of decoded words also appear in the PDFs' normal text);
  no previously-extracted row changed except one 2024-12 statement whose image-rendered "Tarjeta
  adicional" header is now read, so 69 rows went from no `tarjeta` to "Adicional" (same upsert key,
  no duplicates). A glyph not in `GLIFOS` leaves the row as before (warning + manual entry); to
  add one, get its `_huella()` and label it. Reloading a PDF whose image rows the user had typed
  by hand: `descartar_ya_capturadas_a_mano` (transformador) drops the newly-extracted row when a
  recovered manual row has the same fecha/monto/tipo and **keeps the manual one** — it may already
  be in Supabase under its own key, and the sync never deletes rows.
  **Section headers in images too (2026-10-04)**: in 15 statements (2024-10 → 2025-05) the
  "Tarjeta titular/adicional/digital: ..." headers are image rows outside any transaction block,
  and "titular" uses a lowercase "u" that wasn't in `GLIFOS` (added u/é/y). Every row in those
  statements had `tarjeta = None`. `completar_lineas_con_imagenes(..., es_encabezado=)` now also
  inserts, at their position, image rows outside blocks whose decoded text passes `es_encabezado`
  (Banamex TDC passes `PATRON_SECCION_TARJETA`); other image rows (logos, notices) are still
  ignored. On the real PDFs: 803 rows → Titular, 263 → Adicional, 1 → Digital; no other field of
  any row changed (same upsert keys, so re-syncing just fills `tarjeta`).
- **Normalize known variant spellings instead of capturing verbatim, when the output feeds a
  stable identifier**: `extraer_info_cuenta`'s alias used to capture whatever word followed
  "Estado de Cuenta" on its own line (`PATRON_ALIAS`) and build `f"TDC {esa_palabra}"` verbatim —
  fragile (only matches if that exact line stands alone) and inconsistent (a PDF that happened to
  say "Platinum" in English would produce a different alias than one saying "Platino", splitting
  what should be the same account across two `cuentas` rows since `alias` is part of the
  find-or-create key). Fixed (2026-09-20) by searching the whole page text (not a line-anchored
  regex) for each known card-tier keyword and normalizing to a fixed alias:
  `TIPOS_TARJETA_CONOCIDOS`, a `[(patrón, alias_normalizado), ...]` list — `platino`/`platinum` →
  `"TDC Platino"`, `beyond` → `"TDC Beyond"` (added the same day a real Beyond statement showed
  up, confirming the list needed to be extensible rather than a single hardcoded pattern).
  `PATRON_ALIAS` (the old line-anchored capture) stays as a last-resort fallback for a future
  tier not yet in the list.
- **One parser class covers every TDC tier, not one class per tier**: when the Beyond statement
  arrived, the transaction line format, sign convention, date format, and card-number extraction
  all turned out identical to Platino's — the *only* difference was which keyword identifies the
  tier on the cover page. Rather than forking a near-duplicate `BanamexTdcBeyondParser`,
  `BanamexTdcParser` stayed one class and just grew `TIPOS_TARJETA_CONOCIDOS` by one entry.
  `puede_procesar` already didn't gate on a specific tier (just "Pago mínimo", which every TDC
  statement has) so it needed no change at all. Lesson for a future tier: verify structural
  identity against the real anonymized dump before assuming a new class is needed — a new card
  product from the same issuer is not automatically a new document *format*. **Confirmed again
  2026-09-26** with a third tier, Conquista (the current name for what used to be called
  Prestige — same normalize-to-one-alias treatment as Platino/Platinum, both patterns mapping to
  `"TDC Conquista"` in `TIPOS_TARJETA_CONOCIDOS`): transaction format, sign convention, card
  sectioning, and the `PAGO INTERBANCARIO` multi-line block were all identical to Platino/Beyond,
  so this was a one-line addition to `TIPOS_TARJETA_CONOCIDOS` plus its own
  `"PAGO TDC CONQUISTA"` rule in `reglas_categorizacion.json` — no parser logic changed.
- **A real Conquista statement also revealed a `PAGO INTERBANCARIO` shape not seen before: a
  one-line variant with the amount inline**, `"SU PAGO INTERBANCARIO - $X,XXX.XX"` — distinct from
  the multi-line block above (which opens with bare `"PAGO INTERBANCARIO"`, no amount, and needs
  `PATRON_PAGO_INTERBANCARIO_INICIO`/`_CIERRE` to reconstruct it). Because this one-line version
  already has fecha/concepto/signo/monto all on one line, it matches `PATRON_TRANSACCION` directly
  and needed no parser change — but it *does* contain the substring `"PAGO INTERBANCARIO"`, so
  without a fix it fell into the generic `"PAGO INTERBANCARIO"` → `"Transferencia enviada"` rule,
  mislabeling an incoming abono (confirmed sign `"-"` in the real statement) as an outgoing
  transfer — the exact wrong-direction mistake the multi-line block's custom `"PAGO RECIBIDO
  {concepto}"` description was already built to avoid, just not for this second shape. Fixed with
  a `"SU PAGO INTERBANCARIO"` rule (categoria `"Transferencia recibida"`) placed before the
  generic `"PAGO INTERBANCARIO"` rule in `reglas_categorizacion.json` — a pure categorization-rule
  fix, since the parser already extracts fecha/monto/signo correctly for this line; only
  `categorizar()`'s first-match-wins ordering was wrong. Deliberately generic (`"Transferencia
  recibida"`, not tier-specific `"Pago TDC"`) rather than extending the `PATRON_ABONO_CORTESIA`
  parser rewrite to cover this too — a smaller, more conservative fix for now since the concept
  text here doesn't say who's on the other end the way `"SU ABONO...GRACIAS"` does.
- **`tarjeta` (Titular/Adicional/Digital): a TDC with supplementary cards groups its transaction
  table into sections**, each opened by a line matching `PATRON_SECCION_TARJETA` —
  `^Tarjeta\s+(Titular|Adicional|Digital)\b` (case-insensitive; confirmed 2026-09-20 against a
  real statement's exact section-header text, e.g. `"Tarjeta digital: 43912001xxx"`). `extraer()`
  tracks the current section in a single loop-scoped variable (`tarjeta_actual`) that updates
  whenever that pattern matches and is stamped onto every `RenglonCrudo` built afterward — state
  spans the *whole document*, not per-page, since a section stays open across a page break just
  like everything else this parser tracks (see the page-boundary lesson under `banamex.py`
  above). This is a new bank-agnostic field on `RenglonCrudo`/`TransaccionCanonica` (`tarjeta:
  str | None = None`, default `None` for any parser without this concept — the checking account
  never sets it) and a real `transacciones.tarjeta` column (plain nullable text, no catalog/FK —
  same reasoning as `comercio`: a small fixed set of values scoped to one document, not something
  needing its own management UI). Flows through the whole pipeline the same way `comercio` does:
  app table column, JSON export, `sincronizador.py`'s upsert payload, frontend `Transaccion` type
  + select + both `TransaccionesTabla` and `EditorTransacciones` display columns. `Editar
  categoría/comercio en lote` deliberately does *not* gain a `tarjeta` field — only display, not
  bulk-editable, since nothing asked for that and a wrong bulk edit here couldn't be traced back
  to a rule the way categoría/comercio mistakes can. `VentanaRenglonManual` also grew an optional
  "Tarjeta" text entry, for consistency with every other field a manual row can carry.
- **"Casi todas las transacciones son una línea" had an exception: `PAGO INTERBANCARIO`** (a SPEI
  received directly to the card) — confirmed on a real Beyond statement (2026-09-20) that this
  breaks the one-line-per-transaction assumption the whole parser was built on. It opens with
  `"DD-mon-AAAA DD-mon-AAAA PAGO INTERBANCARIO"` — two dates and nothing else, no sign/monto at
  the end — followed by detail lines (`PAGO RECIBIDO DE:`, `POR ORDEN DE:`, `CLAVE DE RASTREO:`,
  `CONCEPTO:`) and closes with `"...REFERENCIA: <ref> <signo> $<monto>"`, where the actual
  amount lives. Before this fix, the opening line matched `PATRON_PREFIJO_FECHAS` but not
  `PATRON_TRANSACCION`, so every one silently became an `advertencias()` false-positive ("posible
  transacción no capturada") even though the data was fully present in the following lines — just
  not on one line. `PATRON_PAGO_INTERBANCARIO_INICIO`/`_CIERRE` bracket the block; a
  loop-scoped `bloque_interbancario` dict buffers the lines in between (captured into
  `linea_cruda` joined with `" | "`, same convention as the checking parser's multi-line SPEI
  blocks) and extracts the `CONCEPTO:` value to build `descripcion_texto =
  f"PAGO RECIBIDO {concepto}"` — deliberately *not* including the literal "PAGO INTERBANCARIO"
  header text, because this repo already has a `"PAGO INTERBANCARIO"` rule mapped to categoria
  `"Transferencia enviada"` (listed before `"PAGO RECIBIDO"` → `"Transferencia recibida"` in
  `reglas_categorizacion.json`) — since every such block seen so far on a *credit card* statement
  is money coming *in* (an abono, sign `"-"`), including that header text would have let the
  wrong, earlier-listed rule win and mislabel a received payment as a sent one. If an outgoing
  variant of this block is ever confirmed, that assumption needs revisiting — verify against the
  real dump before generalizing description-building further. `abandonar_bloque_interbancario`
  handles the defensive cases (a new tarjeta-section header, a new transaction, or end-of-document
  arriving before the block's closing line): it surfaces the whole accumulated block as an
  `advertencias()` entry instead of silently swallowing whatever real transaction line triggered
  the abandonment — mirrors this repo's standing rule of never guessing on malformed structure.
- **`_detectar_tipo_tarjeta(texto_pagina)`** is a shared helper (extracted 2026-09-20 from what
  was duplicated inline logic) used by both `extraer()` and `extraer_info_cuenta()` — one source
  of truth for "which tier is this document" against `TIPOS_TARJETA_CONOCIDOS`. `extraer()` now
  also tracks the document's tier (`tipo_tarjeta_documento`, detected once from whichever early
  page mentions it, same lazy pattern as `tarjeta_actual`/section tracking) so it can apply
  **tier-conditional description rewriting**: the generic bank courtesy line after a payment
  (`"SU ABONO...GRACIAS"`, `PATRON_ABONO_CORTESIA`) gets its `descripcion_texto` replaced with
  `f"PAGO TDC {tier}"` (`tier` = `tipo_tarjeta_documento` with the `"TDC "` prefix stripped and
  upper-cased, e.g. `"BEYOND"`, `"PLATINO"`) whenever `tipo_tarjeta_documento is not None` — on an
  undetected tier the line is left exactly as the PDF prints it, uncategorized, same as before.
  User's explicit request (2026-09-20, first for Beyond only, generalized the same day once they
  confirmed a Platino statement needed the identical treatment — `"Pago TDC"` / `"Pago TDC
  Platino"`): each detected tier categorizes as `"Pago TDC"` / comercio `"Pago TDC <Tier>"`. Since
  `categorizar()` in `transform/categorizador.py` only ever sees `descripcion` text and has zero
  awareness of which bank/tier produced it, the only way to make a rule conditional on tier is for
  the *parser* (which does know the tier) to bake that distinction into the description text
  itself before it ever reaches the categorizador — same technique already used for the
  `PAGO INTERBANCARIO` block's reconstructed description above. `linea_cruda` is untouched (still
  the PDF's real "SU ABONO...GRACIAS ..." text) so the audit trail doesn't lose anything even
  though `descripcion` no longer matches it verbatim for this one case. **Adding a tier to
  `TIPOS_TARJETA_CONOCIDOS` does not automatically categorize its courtesy line** — each tier
  needs its own `"PAGO TDC <TIER>"` rule added to `reglas_categorizacion.json` by hand (two exist
  so far: `"PAGO TDC BEYOND"` and `"PAGO TDC PLATINO"`); the parser only builds the description
  text, it doesn't touch the rules file.
- **Statements from 2024-10/11 onward don't print the tier name at all** (confirmed 2026-10-02,
  running the parser over the user's PDF folder: no page of those documents mentions
  Platino/Beyond/Conquista/Prestige — the cover just says "Estado de Cuenta Mensual", and the tier
  only lived in the user's own file names). Keyword matching in `TIPOS_TARJETA_CONOCIDOS` can't fix
  that, so `_detectar_tipo_tarjeta` falls back to the card number: `_ultimos_4_de_texto()` (the
  `"Número de tarjeta: ..."` line, `[-4:]` only) looked up in `TIPOS_POR_ULTIMOS_4` — same "known
  list, falls through if not listed" shape as `ROLES_TARJETA_CONOCIDOS` in `invex_tdc.py`, and just
  as specific to this user's cards — **kept in the code on purpose (user's decision, 2026-10-09)**, same
  for `ROLES_TARJETA_CONOCIDOS` (invex_tdc.py), `CIUDADES_CONFIRMADAS` (gmail_gastos.py) and
  `NOMBRES_TARJETA`/`ORDEN_TARJETAS` (frontend `lib/gastosCorreo.ts`, which ships in the site's JS):
  moving them to a gitignored config was offered and declined (each tier was reissued under a new number more than once: Conquista
  5482/1236/8423, Beyond 4391/4904, Platino 5491/6599/2989 — the last one confirmed by the user).
  A name in the text still wins over the number. Three ordering details that mattered: (1) `extraer_info_cuenta` keeps the
  `"Estado de Cuenta <Palabra>"` alias (`PATRON_ALIAS`) as a *last-resort* (`alias_respaldo`) applied
  only after the first 3 pages found no tier — accepting it on sight (cover = page 1) hid the page
  that carries the card number, which is what produced the `"TDC Mensual"` alias/account; (2)
  `extraer()` resolves the tier from the first 3 pages *before* reading any row, so a courtesy line
  can't be read before the tier is known; (3) `descripcion_para_categorizar` (manual-row dialog) uses
  the stored `_tipo_tarjeta_documento`. **A card not in `TIPOS_POR_ULTIMOS_4` still falls through to the old
  behavior** (alias `"TDC Mensual"`, courtesy line uncategorized) — add its last 4 when its tier
  is known. Cards can share an alias across card numbers (Conquista has three, Platino three) —
  that's how the dashboard's per-card tabs group them (`cuentaDe` = alias), and each number still
  gets its own `cuentas` row. Accounts already synced as "TDC Mensual" get renamed the next time a
  document of that card is synced (see `_buscar_o_crear_cuenta` under Sincronizador); on 2026-10-02
  the six local JSONs for 6599/2989 were re-aliased to "TDC Platino" with a one-off script (their
  `SU ABONO...GRACIAS` rows included), so a "Sincronizar a Supabase..." renames those two accounts.
- **A fully-legible transaction line can still fail to match if a stray page-footer artifact
  lands on the same physical line, with no newline in between** — confirmed on a real Beyond
  statement (2026-09-20): the last transaction row on a page's movements table came through
  `extract_text()` as `"...TIENDA X REF1 + $68.00 .."` — note the trailing `" .."` glued directly
  onto the amount. `PATRON_TRANSACCION` originally anchored its end with `\s*$` right after
  `monto`, so those two extra characters made the *whole* match fail even though every field
  (fecha, concepto, signo, monto) was completely legible — the line fell through to
  `PATRON_PREFIJO_FECHAS` and got reported as a false-positive "posible transacción no
  capturada" `advertencias()` entry, identical in symptom to the genuinely-unrecoverable
  image-rendered rows but with a completely different (and fixable) cause. Fixed by relaxing the
  trailing anchor on both `PATRON_TRANSACCION` and `PATRON_PAGO_INTERBANCARIO_CIERRE` from `\s*$`
  to `[\s.]*$` — tolerates trailing whitespace *and* stray dots after the monto without weakening
  what actually gets captured (the `(?P<monto>...)` group itself is unchanged, still exactly
  `[\d,]+\.\d{2}`). Lesson: when `advertencias()` flags something as unreadable, don't assume
  it's the "rendered as an image" case by default — check whether the raw line genuinely has no
  parseable amount, or whether it's fully legible and just failing a too-strict anchor;
  the fix looks completely different depending on which one it is.

**`parsers/invex_tdc.py`** (Invex credit card, added 2026-09-21) is the second TDC issuer
supported — **not** the same bank as Banamex TDC, so it's its own module rather than a special
case inside `BanamexTdcParser`. Unlike Banamex, where one transaction format covers every card
tier (see that module's "one parser class covers every TDC tier" lesson), Invex turned out to
have **two structurally different document formats for the same product**, confirmed against two
real statements a day apart (2026-09-21 and 2026-09-22) — not a tier difference, cause unknown
(account age, a mid-year template migration by the bank, something else). `extraer()` tries both
patterns per line (V1 first, then V2) so a document could in principle mix both without breaking:
- **V1** (first statement seen): `"DD-Mon-AAAA DD-Mon-AAAA CONCEPTO CIUDAD +$MONTO"` — two dates,
  month abbreviated with a capital first letter (`"01-May-2026"`, unlike Banamex's lowercase
  `"01-may-2026"` — doesn't affect the case-insensitive regex or `_normalizar_fecha_v1`, which
  lowercases before its `MESES` lookup either way), explicit `+`/`-` sign: `+` = cargo, `-` = abono.
- **V2** (second statement seen, next day): `"DD/MM/AAAA CONCEPTO $MONTO[ CR]"` — a single date
  with slashes (already in `BaseParser.formato_fecha`'s default `DD/MM/AAAA`, so no conversion
  needed, unlike V1), and **no `+`/`-` character in the text at all** — asked the user directly
  since it genuinely couldn't be inferred from an anonymized dump (anonymization hides letters):
  a literal trailing `"CR"` after the monto marks an abono, its *absence* marks a cargo. This is
  the inverse of V1's shape (there, a symbol explicitly marks the cargo; here, the absence of a
  marker means cargo) — easy to invert by mistake if this gets touched again, worth re-reading the
  regex comment before changing it. V2 also has echo/annotation lines after several transactions
  (`"XXXXXX XXXX XXXXXX ... $0.00"` in the anonymized dump, exact real text unconfirmed) that
  match the same transaction pattern and almost always carry `$0.00` — left as ordinary extracted
  rows instead of guessing which ones to filter out, since they don't affect the total either way.
- No multi-line block like Banamex's `PAGO INTERBANCARIO` has been seen in either format yet — if
  one appears, add that handling then (see the Banamex TDC module as reference), not before.
- **`tarjeta` (Titular/Adicional): confirmed 2026-09-22 that a V2 statement with a supplementary
  card DOES group its transactions into sections**, same idea as Banamex TDC's
  `PATRON_SECCION_TARJETA` — the initial assumption that Invex had no repeating card sections was
  wrong, just hadn't been tested against a statement with more than one card yet. The *label*
  available to identify each section differs by format, though, so `extraer()` tries two patterns
  per line, V1-style first:
  - **V1**: prints the role as a word, `"Tarjeta Titular ************1234 ..."` —
    `PATRON_SECCION_TARJETA_CON_ROL` captures `"Titular"/"Adicional"/"Digital"` directly, same as
    Banamex.
  - **V2**: does **not** print any role word anywhere on that line — confirmed against the real
    dump, it's just `"************1234 NOMBRE APELLIDO"` (the cardholder's name, no "Titular"/
    "Adicional" text at all). There is nothing in the document to say which physical card is "the
    titular" vs "the adicional" — that's something only the account owner knows, not something
    the PDF states in extractable text. `tarjeta` falls back to the masked card's last 4 digits as
    the section identifier (e.g. `"1096"`, `"5005"`), then `ROLES_TARJETA_CONOCIDOS` (a small
    `{últimos_4: rol}` dict, confirmed by the user 2026-09-22: `"1096"` → Titular, `"5005"` →
    Adicional) translates known numbers to a readable role — same "known list + fallback to the
    raw value" shape as Banamex TDC's `TIPOS_TARJETA_CONOCIDOS`. This is deliberately specific to
    this user's own account (there's no way to derive it from the document), which is fine for a
    single-user personal finance tool — an unrecognized card number just falls back to showing its
    last 4 digits until the user confirms its role and a new entry gets added.
  - `PATRON_TARJETA_ENMASCARADA` (already used by `extraer_info_cuenta` for the account's overall
    last-4) doubles as the V2 section-boundary detector when matched with `.match()` anchored at
    line start — a transaction line never starts with asterisks, so there's no collision risk
    between "this is a section header" and "this is a transaction."
- **`puede_procesar` needed a real bank-name check this time, unlike Banamex TDC's**: both TDC
  parsers key off "Pago mínimo" (exclusive to a credit-card statement over a checking account),
  but with two TDC issuers now sharing that marker, "Pago mínimo" alone stopped being enough —
  confirmed by testing the same synthetic PDF against both parsers and getting `True` from both
  (which `detectar_banco` treats as an unresolvable tie, degrading *both* to manual selection
  instead of picking the right one). Unlike Banamex TDC's own history (where dropping the
  "BANAMEX" requirement was safe because no other TDC parser existed yet to collide with),
  `InvexTdcParser.puede_procesar` requires "INVEX" **and** "Pago mínimo" both present, and
  `BanamexTdcParser.puede_procesar` was updated to add `and not PATRON_INVEX.search(...)` as an
  explicit exclusion (see its own module — re-adding a positive "BANAMEX" requirement there isn't
  an option since that text still isn't selectable on a real Banamex TDC statement, per its
  existing documented lesson). This cross-exclusion approach is a stopgap that works for exactly
  two issuers sharing one generic marker; a third TDC issuer with the same "Pago mínimo, no
  selectable bank name" shape would need this rethought rather than mechanically repeated.
- **Unverified risk, flagged rather than resolved**: whether "INVEX" actually appears as
  selectable text on a real statement (vs. being image-only, the same trap that bit the original
  "BANAMEX" check) still hasn't been directly confirmed — confirm on a real load and tighten the
  marker then if needed, same iterative pattern used throughout this file.
- **Alias/últimos 4 dígitos source changed after the format split**: V1's cover page has a
  "No. Tarjeta XXXX XXXX XXXX 1234" label (`PATRON_LINEA_TARJETA` — originally written by analogy
  with Banamex TDC's "Número de tarjeta" wording *before ever seeing an Invex cover page*,
  confirmed wrong the same day and fixed to accept both spellings); **V2's cover page doesn't have
  that label at all**. What both formats *do* share reliably is the masked card-number line inside
  the movements table itself, `"************1234 ..."` (`PATRON_TARJETA_ENMASCARADA`, 12+
  asterisks then exactly 4 digits, unambiguous against any other number on the line) — so
  `extraer_info_cuenta` now tries that first and only falls back to the portada-label method
  (which only V1 has) if it comes up empty. No tier concept confirmed for either format (unlike
  Banamex's Platino/Beyond) — alias is a fixed `"Invex TDC"` string. Lesson repeated twice now in
  this one module: a label or format that looks structurally identical to another bank's, or even
  to *the same bank's own earlier statement*, isn't guaranteed to hold — verify against the real
  document before trusting a hook that "should" work by analogy.
