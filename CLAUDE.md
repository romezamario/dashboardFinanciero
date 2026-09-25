# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Personal finance dashboard: a local Python pipeline parses bank statement PDFs, normalizes and
categorizes transactions, and syncs only the normalized data (never the PDF or its raw text) to
Supabase, which a React frontend reads directly (protected by Row Level Security).

The full original spec — architecture, exact DB schema, folder layout, phased implementation plan —
lives in [prompt-claude-code.md](prompt-claude-code.md). Read it before making structural changes;
it's the source of truth for what to build next, **except** for the local pipeline's entry point,
which was deliberately redesigned away from that spec's automatic watcher — see Architecture below
— and except for the frontend's dashboard chart set, where "tendencia de saldo" (mentioned in the
spec) was later replaced by "gasto por comercio" at the user's explicit request — see the
"Removed: `TendenciaSaldoChart`" bullet under Frontend below.

## Non-negotiable constraints

- PDFs and their raw text never leave the laptop — only normalized transactions sync to the cloud.
- Everything must fit in free tiers (Supabase free, Cloudflare Pages free, Cloudflare Access free). Budget: $0.
- Monetary amounts are `Decimal`/`numeric`, never `float`.
- Account numbers are masked to the last 4 digits before any data leaves the laptop.
- Every transaction must be auditable back to its exact source line (PDF page + masked raw text).
- Re-importing the same PDF must never duplicate transactions (idempotent upsert).
- No hardcoded Supabase credentials — environment variables only (`.env`, gitignored).
- No custom auth — Supabase Auth only.

## Architecture

**Local pipeline** — entry point is a **Tkinter desktop app** (`app/main.py`), not a folder
watcher. The user explicitly redesigned this away from the original spec's automatic
watcher-on-`data/nuevos/` design, to get a manual review/validation step before anything is
considered final: load a PDF → see parsed transactions in a table → validate the calculated total
against the real total from the statement → adjust categorization rules live → only then export.

Flow: user picks a bank + loads a PDF in the app → Extractor (`parsers/base.py`'s `BaseParser`,
one concrete implementation per bank — `RenglonCrudo.monto_texto` must carry sign: negative =
cargo) → `transform/transformador.py` (bank-agnostic: dates to ISO, amounts to signed-then-`Decimal`
split into `(monto, tipo)`, builds `TransaccionCanonica` with audit fields `pagina`/`linea_cruda`)
→ `transform/categorizador.py` (keyword rules loaded from `transform/reglas_categorizacion.json`,
gitignored — editable live from the app's "Reglas de categorización..." dialog, `VentanaReglas`)
→ user validates the sum against the statement's own declared total (`validar_contra_total`) →

Each `Regla` maps a `patron` to both a `categoria` (required) and an optional `comercio` (e.g.
pattern `"TELEVIA"` → categoria `"Transporte"`, comercio `"Televia"`) — `comercio` was added after
`categoria` existed, so it defaults to `None` and older rules in `reglas_categorizacion.json`
that predate it keep working unchanged. `categorizar()` returns `(categoria, comercio)` together
since one keyword match should set both at once; `TransaccionCanonica.comercio` and the
`transacciones.comercio` column follow the same "plain nullable text, no catalog/FK" pattern
(deliberately simpler than `categoria`, which resolves through the `categorias` table) — chosen
because merchant names don't need cross-account uniqueness or their own management UI the way
categories do. Requested specifically for credit-card statements, where the raw description
mixes merchant + reference number and a category alone ("Transporte") loses which specific
merchant it was.


"Guardar archivo procesado" writes `data/procesados/<sha256_del_pdf>.json` **and** moves the
source PDF itself into a `procesados/` subfolder of whatever folder it was loaded from (e.g.
`C:\...\00Estadosdecuenta\procesados\`, not the project's `data/procesados/` — that's only for
the JSON) via `App._mover_a_procesados_junto_al_pdf`: reuses that subfolder if it already exists,
no-ops if the PDF is already inside a folder named `procesados` (avoids nesting
`procesados/procesados` on a reload-to-fix-something), and appends `" (1)"`, `" (2)"`, ... on a
same-name collision with an unrelated file rather than overwriting it silently.

That JSON is the handoff contract for `sync/sincronizador.py` (see its own section below): it
upserts those transactions to Supabase keyed by `documento_hash`, idempotently. Failed-to-parse
PDFs move to `data/errores/` with a `.log` of what went wrong (see `App._mover_a_errores` — a
different, project-local destination, for the "couldn't even extract" case rather than the
"successfully processed" case above).

When adding a real bank, register its `BaseParser` subclass in the `PARSERS` dict at the top of
`app/main.py` — that's what populates the "Banco" dropdown, used as a manual fallback. Some
parsers need extra context the PDF doesn't print (e.g. `BanamexParser` needs a year, since the
statement only prints "DD MES" per row) — `App.cargar_pdf` tries
`parser_cls(ano_estado_de_cuenta=anio_respaldo)` and falls back to `parser_cls()` on `TypeError`,
so a parser only needs that constructor param if it actually uses it. `BanamexParser.extraer()`
then tries to **self-correct** that year from the PDF's own cover page ("Fecha de corte" /
"Periodo" both print the full year in plain text) before processing any transaction lines — the
constructor value (`anio_respaldo`, the current year, computed with `datetime.now()`) is only the
fallback if detection fails.

There used to be a manual "Año" field in the UI for this fallback (added after a real bug: the
user was reusing the app across statements from different months without updating it, silently
mis-dating transactions — fixed at the time by adding the auto-detection above). Once
auto-detection made the field redundant in the common case, the user explicitly asked to remove
it from the UI (2026-09-20) **after being told the trade-off**: if `BanamexParser`'s cover-page
detection ever fails on a future PDF (unexpected formatting, unreadable page 1, or a bank whose
parser doesn't implement year auto-detection at all), there is no UI way to correct the year
anymore — it silently falls back to the current year, and the only fix is code-level (pass a
different `ano_estado_de_cuenta` explicitly, or debug why detection failed), not something the
user can type into the app. Known gap the field wouldn't have fixed anyway even when it existed:
if a statement's period crosses a calendar year boundary (e.g. Dec 15 – Jan 14), every transaction
gets the single detected year (the cutoff date's year) — December rows would be wrong. Not yet
seen in practice; if it comes up, detection needs to move from once-per-document to
per-transaction (using the month within the block to decide which side of the boundary it's on).

Similarly, the "Formato de fecha" UI field was removed in the same pass — `BaseParser` now
declares `formato_fecha: str = "%d/%m/%Y"` as a class attribute (overridable per subclass)
instead, since every extractor already needs to know its own bank's date format to write its
regex in the first place, so hardcoding it there is strictly more reliable than depending on the
user re-typing the right `strptime` format string per load. No known real bank needs to override
the default yet — both `BanamexParser` and `BanamexTdcParser` already normalize `fecha_texto` to
`DD/MM/AAAA` internally.

**Auto-detection, so the user doesn't have to pick the bank manually**: `BaseParser` has two
optional hooks, both defaulting to "unsupported" so old/simple parsers (`EjemploParser`) don't
need to implement them:
- `puede_procesar(ruta_pdf) -> bool` — a cheap, conservative check. `App._detectar_banco` tries
  every registered parser's `puede_procesar` against the loaded PDF; if exactly one matches, that
  bank is used and the dropdown is updated to show it. Zero or multiple matches fall back to
  whatever the dropdown is currently set to (ambiguity always degrades to manual, never guesses).
  **The bank name alone is not enough once an issuer has more than one document type**:
  `BanamexParser` (checking) originally matched on bare "BANAMEX" in the first 3 pages, which
  worked until `BanamexTdcParser` (credit card) was added — both documents say "BANAMEX"
  somewhere, so that check alone made every Banamex PDF match both parsers (ambiguous, silently
  losing auto-detection for both). Fixed by requiring a structural marker unique to each document
  *type*, not just the issuer: checking requires "BANAMEX" **and** the transaction table header
  "FECHA CONCEPTO RETIROS" (the TDC statement has no such column); TDC requires "BANAMEX" **and**
  "PAGO MÍNIMO" (checking has no minimum-payment concept). When adding a second product for a
  bank you've already written a parser for, go back and tighten that parser's `puede_procesar`
  the same way — don't assume the existing check is still selective enough.
- `extraer_info_cuenta(ruta_pdf) -> (alias, ultimos_4) | (None, None)` — reads the account alias
  and last-4-digits off the cover page so the user doesn't retype them per statement (see the
  "Account info" bullet under Sincronizador below for the hard rule on never keeping the full
  account number in memory past the `[-4:]` slice).
- `advertencias() -> list[str]` — non-fatal warnings about the *last* `extraer()` call, e.g. a
  line that structurally looks like a transaction (right position, right prefix) but whose
  content couldn't be read as text (see the "row rendered as an image" lesson under
  `parsers/banamex_tdc.py` below). `App.cargar_pdf` surfaces these in the load summary and a
  messagebox so the user knows to check that row by hand — it's a hint, not a recovery mechanism;
  nothing gets reconstructed automatically.

All three hooks are best-effort: on no match/exception they return the "unsupported"/empty
sentinel and the app silently falls back to whatever the user already has in the manual fields —
never a hard failure, never a silently wrong guess presented as certain.

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
  vanishing — `App.cargar_pdf` shows it in the resumen and a messagebox so the user knows to
  capture that row by hand before trusting `validar_contra_total`. This is the general escape
  hatch for "PDF renders this row as an image" cases in any future parser, not just this one.
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
  product from the same issuer is not automatically a new document *format*.
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
  (which `App._detectar_banco` treats as an unresolvable tie, degrading *both* to manual selection
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

**Manual row entry** (`VentanaRenglonManual` in `app/main.py`) is the other half of the
"transaction row rendered as an image" gap above — `advertencias()` only *flags* the unreadable
row, it can't recover it, so the "Agregar renglón manual..." button (next to "Inspeccionar
PDF...") lets the user type one in by hand: fecha, descripción, monto sin signo, tipo, and an
optional página (fill it in from the `advertencias()` message if you know which page it was on;
defaults to `0` otherwise). Requires a PDF already loaded — `App.ruta_pdf_actual` — because a
manual row still needs to belong to a document for `origen`/sync purposes; it does *not* require
that the extractor found any real transactions first. Categoría/comercio are auto-assigned by
the same `categorizar()` call as any extracted row (no separate manual-override field — if you
need different categorization, add/edit a rule instead, same as for extracted rows). `pagina`
defaults to `0` and `linea_cruda` is built as `f"(manual) {fecha} | {descripcion} | {monto} |
{tipo}"` — distinct per entry so it can't collide with a real extracted line, and unique enough
across manual entries in the same document to not collide with each other on the sync upsert's
`(documento_id, pagina, linea_cruda)` constraint. The row is a plain `TransaccionCanonica`
appended to `self.transacciones`, so it flows through totals/validation/export/sync identically
to an extracted one — no special-casing anywhere downstream.

The app can be packaged as a standalone `.exe` via `DashboardFinanciero.spec` (PyInstaller,
`--windowed`, icon from `app/icono.ico` — see README's "Empaquetar como ejecutable"). Build deps
(pyinstaller, pillow) live in `requirements-dev.txt`, not `requirements.txt` — they're not needed
to just run `python -m app.main`. `build/` and `dist/` are gitignored; the `.spec` file is
versioned since it's the build's source of truth.

**Cloud**: Supabase (Postgres + Auth + RLS, sole remote source of truth) + Cloudflare Pages
(frontend hosting) + Cloudflare Access (network-level login gate in front of Pages, additive to
Supabase Auth, not a replacement for it).

**Frontend** (`frontend/`): React + Vite (TS) + Tailwind v4 + Recharts, talks to Supabase directly
via `supabase-js` — no backend server in between. `src/App.tsx` gates on `supabase.auth`
session state (`onAuthStateChange`) and renders `Login` or `Dashboard` — no routing library, just
that one conditional. Every query in `src/lib/queries.ts` reads `transacciones` with nested
selects (`categorias(nombre)`, `documentos(cuentas(alias, bancos(nombre)))`) and is deliberately
**not** filtered by `user_id` in code — RLS is the only access boundary, by design, so a bug in
the frontend query can't leak another user's rows. Aggregation (by-month, by-category, running
balance per account) happens client-side in plain functions in `queries.ts`, kept separate from
the React components so they're unit-testable without rendering anything.

**Charts**: `IngresosGastosChart` (ingresos vs. gastos por mes), `GastoPorCategoriaChart`, and
`GastoPorComercioChart` (added 2026-09-20, replacing an earlier `TendenciaSaldoChart` — see
below). `GastoPorComercioChart` mirrors `GastoPorCategoriaChart`'s exact shape (top-8 horizontal
bars, single hue, cross-filter) but deliberately has **no** "Sin comercio" fallback bucket and no
"Otros" fold: `comercio` is optional by design (only rules that explicitly set it populate it —
see the `comercio` bullet earlier in this doc), so `agruparGastoPorComercio` in `queries.ts` just
skips transactions with `comercio === null` rather than lumping them into a noisy catch-all the
way `categoriaDe()`'s `SIN_CATEGORIA` fallback does for categories (categorization is expected to
eventually cover everything; comercio tagging isn't and that's fine).

**Cross-filter (Power BI style)**: `Dashboard` holds one `filtros: Filtros` state
(`{mes?, categoria?, comercio?}`) and `queries.ts`'s `aplicarFiltros(transacciones, filtros, excluir?)`
does the filtering — the `excluir` param is the whole trick: each chart is computed from
transacciones filtered by every *other* active dimension but not its own, so clicking a bar still
shows every other bar/category/comercio to click next (self-filtering would collapse a chart down
to one visible option after the first click, which isn't how Power BI cross-filter reads). KPIs and
the table use the fully-filtered set — except `saldoActual`, which is deliberately taken from the
*unfiltered* `transacciones` (it's a fact about the account's current balance, not an aggregate
that should shrink when you filter by category/month). Click handlers live in the chart
components (`onClickMes`/`onClickCategoria`/`onClickComercio` props) and call a shared
`alternarFiltro` in `Dashboard` that toggles: clicking the already-selected value clears it, same
as clicking a chip in the filter-chips row above the KPIs. Non-selected marks dim to ~0.3 opacity
via per-bar `<Cell fillOpacity>` rather than being hidden, so the full shape of the data stays
visible while showing what's filtered. The "Otros" fold in `GastoPorCategoriaChart` (categories
past the top 8) is explicitly not clickable — it has no single real category name to filter by.

**Per-card tabs (added 2026-09-25, user's request)**: besides "Resumen" and "Eventos", `Dashboard`
renders one tab per account (`cuentaDe` = `cuentas.alias`, e.g. "TDC Beyond", "Invex TDC") — "tarjeta"
here means the account/card product, *not* `transacciones.tarjeta` (Titular/Adicional/Digital,
whose values repeat across accounts; it stays available as a pill filter inside each tab). Each tab
is the same `VistaResumen` component (the whole former Resumen body — KPIs, charts, cross-filter,
hide-categories, table, bulk editor) fed only that account's transactions. Filter state
(`filtros` + `categoriasOcultas`) is **per tab**: `Dashboard` keeps `estadosPorPestana:
Record<tabId, EstadoVista>` and passes each `VistaResumen` its own slice as controlled props, so
filtering in one tab never touches another and a tab keeps its selection when you switch away and
back (state living inside `VistaResumen` would be lost on unmount). The bulk editor inside a card
tab only *searches* that card's transactions, but gets the full list via
`EditorTransacciones.catalogo` for category/comercio suggestions, the destination-account list and
the account-change impact count — otherwise you couldn't move a document to a different account
from a card tab.

**Hide categories (the inverse of cross-filter, added 2026-09-20)**: the "Ocultar categorías" pill
row (right under the active-filter chips, above the KPIs) is deliberately a *separate* mechanism
from `filtros.categoria`, not another value it can hold — cross-filter *isolates* exactly one
category everywhere except its own chart (so you can still see and switch to another); hiding
*removes* however many categories you pick from the whole dashboard, including their own chart
(`Gasto por categoría` shouldn't keep showing a bar for something you just asked to hide). Backed
by `categoriasOcultas: Set<string>` state in `Dashboard` and `queries.ts`'s
`ocultarCategorias(transacciones, categoriasOcultas)`, applied *before* `aplicarFiltros` in the
pipeline — everything downstream (KPIs except `saldoActual`, every chart, the table) computes off
that already-narrowed set, not off the raw `transacciones`. The pill list itself is derived from
the *raw* `transacciones` (`categoriasConocidas`, unaffected by hiding) so a category doesn't
disappear from its own toggle once you hide it — otherwise there'd be no way to click it again to
bring it back. The two mechanisms can contradict each other (isolate category X while also hiding
X), so `alternarCategoriaOculta`/`seleccionarCategoria` cross-clear: hiding a category that's
currently isolated clears the isolation, and clicking a chart bar for a category that's currently
hidden un-hides it first. `EditorTransacciones`'s search is deliberately exempt from hiding (still
receives raw `transacciones`) — hiding is a *view* preference, not a restriction on what you can
find and bulk-edit.

**Removed: `TendenciaSaldoChart` / filtering by `cuenta`** (2026-09-20, user's explicit request,
no risk flagged — it was a straightforward swap, not a correction of a bug). It plotted one line
per account's running `saldo` over time and was the *only* UI source of the `cuenta` filter
dimension, so removing it made that whole dimension unreachable — `Filtros.cuenta` and its
`aplicarFiltros` branch were removed too rather than left as dead code with no way to trigger it.
`saldoActual` (the KPI tile) is unaffected — it was always computed independently via
`calcularTotales`, never from this chart's data. If per-account balance trend is wanted again
later, it needs a new UI entry point (chart, toggle, whatever), not just restoring the deleted
files — the underlying `saldo` data was never removed from the query/select.

Chart colors/specs follow this repo's `dataviz` skill: the categorical palette (blue for ingresos
and magnitude comparisons, orange for gastos) is validated with the skill's `validate_palette.js`
script against CVD and contrast in both light and dark mode before use; category-magnitude
comparisons (gasto por categoría, gasto por comercio) deliberately use a single hue, not
categorical colors, since the axis labels already carry identity. A third categorical color
(`--series-3`, only ever used for a 3rd+ account line in the now-removed `TendenciaSaldoChart`)
was removed from `src/index.css` along with it — don't reintroduce an unused palette entry
speculatively; add it back (and re-validate) only alongside whatever chart actually needs it.
CSS custom properties for the palette live in `src/index.css`, keyed by role (`--series-1`,
`--text-secondary`, etc.) and redefined for dark via both `prefers-color-scheme` and a
`[data-theme]` override — same pattern artifacts use. If you add a chart, re-run the dataviz
skill's procedure (form → color → validate) rather than picking colors by eye.

`monto`/`saldo` come back from PostgREST as JSON numbers (not the decimal-strings the Python
pipeline uses) — intentional: this is display-only aggregation in the browser, not writing back
to the ledger, and IEEE-754 doubles are exact at personal-finance magnitudes. The "never float"
rule is about the ingestion/storage pipeline (parsers/transform/sync), not every downstream read.

**Bulk editor (`EditorTransacciones.tsx`, added 2026-09-20)** is the frontend's first *write* path
— every other query in `queries.ts` only reads. User searches by a substring of `descripcion`
(`buscarPorDescripcion` — empty search intentionally matches nothing, so the whole table never
lists by accident), checks one or more rows (or "Seleccionar todas las coincidencias", which
selects every match, not just the ones rendered under the `TOPE_RESULTADOS = 100` display cap),
types a new categoría and/or comercio (either blank = "don't touch that field" — there's no UI
for clearing a field to null, only reassigning it), and `actualizarCategoriaYComercio` in
`queries.ts` applies it via `supabase.from("transacciones").update(...).in("id", ids)`. This
relies entirely on the existing RLS `update` policy — same authenticated session as every read,
no new credentials, no service_role, no new migration needed. `categoria` is a special case
because `transacciones.categoria_id` is a FK, not free text: `buscarOCrearCategoriaId` mirrors
`sync/sincronizador.py`'s Python find-or-create (select by `nombre`, insert if missing) so typing
a brand-new category name from the browser creates it in `categorias` on the fly, same as the
desktop app does locally. Category/comercio autocomplete suggestions come from
`Array.from(new Set(transacciones.map(...)))` over the already-loaded transacciones — no extra
Supabase query for that. After a successful edit, `Dashboard` calls `obtenerTransacciones()` again
(`recargarTransacciones`, extracted from the initial `useEffect` so both paths share it) rather
than patching local state, trading a bit of latency for certainty that what's on screen matches
what Supabase actually has.

**Known interaction, not a bug**: this write does *not* touch `documento_id`/`pagina`/`linea_cruda`
— the audit trail back to the source PDF line stays intact, per the non-negotiable constraint. But
it also means an edit made here is **not durable against reprocessing the same PDF**: if the user
later reloads that statement in the desktop app and hits "Sincronizar a Supabase..." again, the
upsert on `(documento_id, pagina, linea_cruda)` will overwrite `categoria_id`/`comercio` back to
whatever `transform/categorizador.py`'s current rules produce for that description, silently
discarding the manual edit. This wasn't flagged to the user as a decision to make (unlike the
"Año" field removal) since it's an inherent property of the existing idempotent-upsert design
documented under Sincronizador below, not a new risk introduced by adding this editor — but it's
worth knowing: the more durable fix for a systematic mis-categorization is still to add/edit a
rule in `reglas_categorizacion.json`, not to hand-edit every occurrence in the dashboard. This
editor is best used for merchant/category names the rules don't (or can't cleanly) capture, or
for one-off corrections on transactions that won't be resynced again.

## Database schema & migrations

`supabase/migrations/*.sql` is the only source of truth for the schema — **never edit the remote
schema by hand in the Supabase SQL Editor or Table Editor**. Any schema change (new table, column,
policy, index) must be a new file, never an edit to an existing one (no automatic rollback — a
mistake gets reverted by a later migration, not by rewriting history):

```
supabase/migrations/YYYYMMDDHHMMSS_description.sql
```

Migrations apply automatically via `.github/workflows/db-migrate.yml` on every push to `main` that
touches `supabase/migrations/**`, or manually via that workflow's `workflow_dispatch` trigger in
the GitHub Actions UI. It runs `supabase link` + `supabase db push` using three repo secrets:
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`.

Tables: `bancos` (shared catalog, no `user_id`, no RLS) and `cuentas`/`categorias`/`documentos`/
`transacciones` (all RLS-scoped to `user_id = auth.uid()`, four policies each — select/insert/update/delete).
`transacciones.comercio` (added in `20260920145914_add_comercio.sql`) and `transacciones.tarjeta`
(added in `20260920180242_add_tarjeta.sql`) are both plain nullable text columns, not catalog
tables with their own FK like `categoria_id` — see the `comercio` bullet in Architecture above
and the `tarjeta` bullet under `parsers/banamex_tdc.py`'s lessons for why that's the deliberate
choice for each.

## Sincronizador (`sync/sincronizador.py`)

Uploads `data/procesados/*.json` to Supabase. Key design decisions, explicitly chosen by the
user over the simpler alternative — don't silently change these:

- **Auth**: signs in as a real Supabase Auth user (`SUPABASE_EMAIL`/`SUPABASE_PASSWORD` in
  `.env`) rather than using the `service_role` key. This means RLS applies to the sync path the
  same way it will to the frontend — the sync script has no more privilege than the user
  themselves would have. Requires a Supabase Auth user to already exist (created once via the
  Supabase dashboard, since there's no signup UI yet — phase 5).
- **Idempotency**: `bancos`/`cuentas`/`documentos`/`categorias` use a manual find-or-create
  (`_buscar_o_crear`: select by unique key, insert only if missing) rather than relying on
  `.upsert()`'s return-row semantics, which vary across supabase-py/PostgREST versions.
  `transacciones` uses real `.upsert(..., on_conflict="documento_id,pagina,linea_cruda")` since
  that's a bulk operation where per-row select-then-insert would be wasteful — the `on_conflict`
  columns match the table's actual unique constraint exactly. **This assumes `(pagina,
  linea_cruda)` is unique per real transaction within one document — confirmed false in
  production** (2026-09-20): a real statement printed two separate Televia toll charges, same
  day, same amount, with byte-identical line text (no reference number distinguishing them). A
  batch containing two rows with the same `on_conflict` key makes Postgres reject the *entire*
  upsert with `ON CONFLICT DO UPDATE command cannot affect row a second time` (error 21000) —
  not just those two rows, so even the unrelated transactions in that batch failed to sync ("1/2
  archivo(s) sincronizados" in the app's error dialog is what this looks like). Fixed upstream in
  `transform/transformador.py`'s `_desambiguar_renglones_duplicados` (called from
  `transformar_renglones` before anything else runs): any renglón sharing `(pagina, linea_cruda)`
  with an earlier one gets `" (2)"`, `" (3)"`, etc. appended to its `linea_cruda`, deterministically
  by order of appearance — so reprocessing the same PDF again assigns the same suffixes to the
  same transactions and the upsert stays idempotent. A JSON already exported *before* this fix
  (still has the raw colliding `linea_cruda`) needs to be regenerated — reload that PDF in the app
  (it's already sitting in its `procesados/` subfolder next to the original PDF location) and
  re-save; that produces a fresh JSON with the disambiguated lines, safe to resync.
- **Incremental sync** (2026-09-22): `sincronizar_todos` used to re-upload every `*.json` in
  `data/procesados/` on every run, even ones already synced with no changes — harmless
  (idempotent upsert) but slow, and it got noticeably worse as the folder accumulated one file
  per statement ever loaded. User reported syncing 4 new records took as long as syncing the
  entire history, because it *was* syncing the entire history. Fixed by skipping a file whose
  content hash (sha256 of the raw JSON bytes, via `_hash_contenido`) matches what it was the last
  time it synced *successfully* — tracked in `data/procesados/_estado_sync.json` (gitignored
  along with the rest of that folder; excluded from `sincronizar_todos`'s own `*.json` glob by an
  explicit name check, `NOMBRE_ARCHIVO_ESTADO_SYNC`, rather than relying on dotfile-glob
  conventions that differ between git/Python's glob/Windows Explorer). Deliberately hash-based,
  not filename- or mtime-based: a JSON's filename is the source PDF's hash, so reprocessing the
  same PDF after a categorization-rule change (see the duplicate-`linea_cruda` fix above, which
  already required a "reload and re-save" step) produces the same filename with different
  content — that case must still sync, and content-hash comparison catches it correctly where a
  filename-only check would have silently skipped the update. A file that fails to sync is never
  written into `_estado_sync.json` (mirrors this module's existing "never lose an update"
  posture, same as the duplicate-line fix above) — the next run retries it automatically, exactly
  like before this change, just without re-touching everything else that already succeeded.
  `forzar_todos=True` bypasses the saved state for a full re-push (state corruption, or wanting
  to re-verify everything against Supabase) — not wired to any UI button, only a code-level
  escape hatch for now. `App.sincronizar()` in `app/main.py` distinguishes "no files in
  `data/procesados/` at all" from "files exist but none changed" in its messagebox, since an
  empty `resultados` list from `sincronizar_todos` now means either.
- **Testability**: `sincronizar_documento`/`sincronizar_todos` take an already-authenticated
  client as a parameter rather than constructing one internally, so the find-or-create/upsert
  logic can be verified against an in-memory fake client (mimicking `.table().select().eq()
  .execute()` / `.insert()` / `.upsert(on_conflict=)`) without needing real Supabase credentials.
  There is no live-Supabase integration test in this repo (and can't be, without embedding real
  credentials) — but the user has confirmed a real sync against their own Supabase project
  worked end-to-end via the app's "Sincronizar a Supabase..." button (bancos/categorias/cuentas/
  documentos/transacciones all populated correctly, verified in the Supabase Table Editor).
- **Account info**: the schema requires `cuentas.alias`/`ultimos_4_digitos`. The app has manual
  entry fields for both ("Alias de cuenta" / "Últimos 4 dígitos", validated to be exactly 4
  digits) — `guardar_procesado()` refuses to write the JSON without them. `BaseParser` also has
  an optional `extraer_info_cuenta(ruta_pdf) -> (alias, ultimos_4) | (None, None)` hook (default:
  unsupported) that `App.cargar_pdf` calls to pre-fill those fields automatically when a parser
  implements it — `BanamexParser` does, reading "Cuenta <Tipo>" and "Número de cuenta de
  cheques <N>" off the cover page (page 1). **Hard rule for any implementation**: the full
  account number must never be stored in any variable, log, or return value beyond the `[-4:]`
  slice — take the last 4 digits and let the rest go out of scope immediately. Auto-fill always
  stays user-editable; the app labels it as "verify before saving," never silently trusted.
- `monto`/`saldo` travel through the exported JSON and into the Supabase payload as decimal
  strings ("199.00"), never Python floats — Postgres casts them to `numeric` server-side.

## CI/CD

Two independent GitHub Actions workflows, each gated by path filters so they don't fire on
unrelated commits:

- `.github/workflows/db-migrate.yml` — triggers on `supabase/migrations/**`. Applies pending Supabase migrations.
- `.github/workflows/deploy.yml` — triggers on `frontend/**`. Builds the frontend and deploys to
  Cloudflare Pages via `wrangler pages deploy`, using secrets `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Assumes the
  `dashboard-financiero` Pages project already exists (it does, in production) — current Wrangler
  doesn't auto-create it on first deploy the way older versions did (a hard error: "The Pages
  project ... does not exist"). Two things were tried and reverted here, worth knowing before
  re-attempting either: a bare `pages project create` step failed outright once the project
  existed (no `continue-on-error`, so it blocked the real deploy step every run); a variant that
  first grep'd `wrangler pages project list --json` to skip creation when already present also
  failed in CI — the grep didn't reliably match the real API response shape, and by the time
  that surfaces the project already exists in production, so it's not worth re-diagnosing without
  live credentials to test against. If the project is ever deleted and needs recreating, run
  `npx wrangler pages project create dashboard-financiero --production-branch=main` locally by
  hand (with `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` in the environment) before pushing —
  don't put creation logic back in the workflow without a way to verify it against a real account.
  User confirmed the workflow now runs clean end to end (straight from Build to the real Deploy
  step, no failing step in between) after this was removed.

Both workflows pin action versions that run natively on Node 24 (`actions/checkout@v5`,
`actions/setup-node@v5`, `supabase/setup-cli@v3`, `cloudflare/wrangler-action@v4`) — when bumping
any GitHub Action in this repo, check its `action.yml` `runs.using` value to avoid reintroducing
the Node 20 deprecation warning.

Account-side setup (Cloudflare tokens, Supabase tokens, GitHub secrets) is documented in
[README.md](README.md) — that's manual, one-time, and outside the code.

## Working locally with Supabase CLI

No global install — invoke it via `npx supabase <command>` (e.g. `npx supabase db push --dry-run`
to preview pending migrations against the linked project).

## Implementation status & working style

The original spec asks to implement phases sequentially and pause for review before starting the
next one (see "Fases sugeridas de implementación" in `prompt-claude-code.md`). Follow that unless
the user directs otherwise — as happened with phase 6 (CI/CD), which was pulled forward ahead of
phases 2-5 at the user's explicit request.

All six phases are complete and verified end-to-end in production (PDF → desktop app → Supabase →
frontend, behind Cloudflare Access + Supabase Auth) — this project is functionally done; further
work is enhancement, not completion.

- [x] Phase 1 — DB schema + RLS policies (as Supabase migrations, applied via Actions)
- [x] Phase 2 — `BaseParser` + one documented example extractor (`parsers/base.py`, `parsers/ejemplo.py`)
- [x] Phase 3 (redesigned) — Transformer + Categorizer as libraries (`transform/`), driven by a
      Tkinter desktop app (`app/main.py`) instead of the originally-planned watcher — user's
      explicit request, see Architecture above
- [x] Phase 4 — Sincronizador (`sync/sincronizador.py`), find-or-create for
      bancos/cuentas/documentos/categorias, upsert on `(documento_id, pagina, linea_cruda)` for
      transacciones. Triggered from the app's "Sincronizar a Supabase..." button. User confirmed
      a real sync populated all 5 tables correctly (verified in the Supabase Table Editor).
- [x] Phase 5 — Frontend (`frontend/`) — React + Vite + Tailwind + Recharts, login + dashboard,
      RLS-only access control (no `user_id` filters in query code), charts built per this repo's
      `dataviz` skill and validated with its palette script
- [x] Phase 6 — CI/CD (DB migrations + Cloudflare Pages deploy) and Cloudflare Access. User
      confirmed the live site now shows two logins in sequence — Cloudflare Access (email + PIN)
      first, then Supabase Auth — and the dashboard renders real synced data correctly.
