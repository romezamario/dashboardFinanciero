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
"Removed, then reintroduced: filtering by `cuenta`" bullet under Frontend below.

## Non-negotiable constraints

- PDFs and their raw text never leave the laptop — only normalized transactions sync to the cloud.
- Everything must fit in free tiers (Supabase free, Cloudflare Pages free, Cloudflare Access free). Budget: $0.
- Monetary amounts are `Decimal`/`numeric`, never `float`.
- Account numbers are masked to the last 4 digits before any data leaves the laptop.
- Every transaction must be auditable back to its exact source line (PDF page + masked raw text).
- Re-importing the same PDF must never duplicate transactions (idempotent upsert).
- No hardcoded Supabase credentials — environment variables only (`.env`, gitignored).
- No custom auth — Supabase Auth only.

**Known, accepted deviation (user's explicit decision, 2026-09-26)**: the "account numbers masked to
the last 4 digits" rule is only enforced for `cuentas.ultimos_4_digitos`. The original spec also
asked the Transformer to mask account numbers inside the audit text ("texto crudo de esa línea, ya
enmascarado"), but that was never implemented: `descripcion` and `linea_cruda` reach Supabase exactly
as the PDF prints them — e.g. Banamex checking SPEI blocks can carry a CLABE or destination account
number. A code review surfaced this and the user chose to leave it as is (not masking going forward,
not backfilling). Don't "fix" it silently: masking changes `linea_cruda`, which is part of the
upsert key, so re-syncing would duplicate every affected row unless stale rows are also deleted
(see "Stale rows" under Sincronizador) — it has to be a deliberate, coordinated change.

## Architecture

**Local pipeline** — entry point is a **Tkinter desktop app** (`app/main.py`), not a folder
watcher. The user explicitly redesigned this away from the original spec's automatic
watcher-on-`data/nuevos/` design, to get a manual review/validation step before anything is
considered final: load a PDF → see parsed transactions in a table → check the totals against the
statement → adjust categorization rules live → only then export.

Flow: user picks a bank + loads a PDF in the app → Extractor (`parsers/base.py`'s `BaseParser`,
one concrete implementation per bank — `RenglonCrudo.monto_texto` must carry sign: negative =
cargo) → `transform/transformador.py` (bank-agnostic: dates to ISO, amounts to signed-then-`Decimal`
split into `(monto, tipo)`, builds `TransaccionCanonica` with audit fields `pagina`/`linea_cruda`)
→ `transform/categorizador.py` (keyword rules loaded from `transform/reglas_categorizacion.json`,
gitignored — editable live from the app's "Reglas de categorización..." dialog, `VentanaReglas`)
→ user reviews the table and the "Totales de la tabla cargada" panel (the "Validación de totales" box — type the statement's total, compare via `validar_contra_total` — was removed from the UI 2026-10-02 at the user's request, they didn't use it; the function stays in `transform/transformador.py`, tested) →

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
the JSON) via `mover_a_procesados_junto_al_pdf` (`app/logica.py`): reuses that subfolder if it already exists,
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
statement only prints "DD MES" per row) — `crear_parser` (`app/logica.py`) tries
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
- `puede_procesar(ruta_pdf) -> bool` — a cheap, conservative check. `detectar_banco` (`app/logica.py`) tries
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
  `parsers/banamex_tdc.py` below). `App._al_leer_pdf` surfaces these in the load summary and a
  messagebox so the user knows to check that row by hand — it's a hint, not a recovery mechanism;
  nothing gets reconstructed automatically.

All three hooks are best-effort: on no match/exception they return the "unsupported"/empty
sentinel and the app silently falls back to whatever the user already has in the manual fields —
never a hard failure, never a silently wrong guess presented as certain.

**"Gastos recientes (Gmail)" tab (2026-10-04)**: `PestanaGastosGmail` in `app/pestana_gmail.py` drives
`sync.gmail_gastos.revisar_gmail()` (the CLI `main()` is now a thin wrapper over it; expected
problems are `ErrorGastosGmail` subclasses with Spanish messages). Its work runs in a background
thread via `correr_en_hilo` (`app/hilos.py`): the worker never touches widgets, it posts
progress/result/error to a `queue.Queue` that the UI drains with `after(100)` (Tkinter isn't
thread-safe), and `al_progresar`/`al_terminar`/`al_fallar` run on the UI thread. **Since
2026-10-08 "Cargar PDF..." and "Sincronizar a Supabase..." use the same helper** (they used to
freeze the window: glyph decoding, and network calls): `cargar_pdf` only does the file dialog and
then runs `leer_estado_de_cuenta` (`app/logica.py`: detect bank, extract, account info, warnings
→ suggestions, transform + categorize, recover manual rows/categories from the previous JSON —
no tkinter) in the thread; `_al_leer_pdf` fills the UI. `_marcar_ocupado` disables Cargar
PDF/Guardar/Sincronizar and shows "Leyendo …"/"Sincronizando…" meanwhile, restoring the previous
summary on failure. Use `correr_en_hilo` for any future long task. Google libraries are imported lazily inside
`crear_servicio_gmail`, so the app opens without them. "Revisar automáticamente al abrir" (off by
default, stored in `data/gastos_correo/preferencias.json`) passes `permitir_autorizar=False`: it
never opens a browser on startup, and shows problems in the tab instead of popups.
**Gmail quota (2026-10-04, real 403 "rateLimitExceeded" with a 90-day window)**: `revisar_gmail`
lists ids (`listar_ids`) and only downloads the ones not already in `data/gastos_correo/`
(`leer_mensajes`); saved ones are re-categorized locally from their stored `establecimiento`
(`recategorizar_guardados`), so a new rule still fixes old charges without re-fetching. Every Gmail
call uses `execute(num_retries=REINTENTOS_GMAIL)` (googleapiclient's exponential backoff on 429/403
rate limits). If it still fails mid-read, `LecturaInterrumpida` carries what was read, it is saved,
and the user sees `LimiteDeGmail` (Spanish) instead of a raw HttpError.
**Full-history load (2026-10-07, user's request)**: the desktop tab's "Días hacia atrás" box was capped at 90
(now `MAXIMO_DIAS_GMAIL` = 3650) and there was a **"Cargar todo el historial..."** button (removed 2026-10-08 at the user's request once the initial load was done; the CLI below remains) that called
`revisar_gmail(None, subir=True)` — `dias=None` searches Gmail without `newer_than` (`consulta_gmail`; CLI:
`python -m sync.gmail_gastos --todo --subir`). Because it can be thousands of messages and minutes, `leer_mensajes` now
calls `guardar_lote` every `LOTE_GUARDADO` = 50 messages (days + debits written as it goes, so closing the app or a
quota error only loses the last batch; Gmail lists newest first, so a partial load fills recent months first) and just
running it again continues where it stopped (saved ids are never re-downloaded). **Upload is incremental**
(`subir_todos`): with years of history it used to re-send one upsert per day file on every check; it now skips files whose
sha256 equals the last *successful* upload (`data/gastos_correo/_estado_subida.json`, failed files are retried;
`forzar=True` / `python -m sync.gastos_correo --forzar` re-sends everything, e.g. after deleting rows in Supabase by
hand) and returns only the files it tried. **Changed days travel together (2026-10-08)**: they are
grouped into calls of up to `MAXIMO_POR_LLAMADA` = 500 rows without splitting a day across calls
(before: one call per day — hundreds on a full-history load); a failing call marks all its days
failed (retried next time), an invalid day fails alone without being sent, and a `mensaje_id`
repeated in one call is sent once (Postgres rejects the whole call otherwise, error 21000). The dashboard's `obtenerGastosCorreo` no longer limits to 60 days: it pages
1,000 rows at a time ordered by fecha, hora **and id** (PostgREST's per-query cap).
**Debit notices are not expenses (2026-10-06, user's decision)**: "Retiro/Compra con cuenta
Banamex" notices from a debit account (`"Cheques M.N. ***123"`, `"CTA PRIORITY BNM M.N. ***123"`)
have amount/date but **no Establecimiento** — not even whether it was an ATM withdrawal or a purchase.
They used to be reported as "no se pudieron leer" (14 real ones). `parsear_debito` recognizes them
(account line `M.N. ***<digits>`, which card notices don't have); they're saved apart in
`data/gastos_correo/debitos.json` (never uploaded, never summed as gastos) so they aren't
re-downloaded, and the tab shows "N retiro(s)/compra(s) con tu cuenta de cheques (débito) por $X: no
se suman como gastos". `leer_mensajes` now returns `(avisos, ilegibles, debitos)`; `leer_avisos`
keeps its 2-tuple. City codes: the bank truncates the city to 3 letters (or sends the billing
city/phone for online charges, e.g. `+14`, `866`, `Ams`); the user confirmed 35 mappings in their
gitignored `ciudades.json`, online ones as "En línea".
**Upload uses the user's own session (user's decision, 2026-10-04)**: `sync/gastos_correo.py`
signs in with `SUPABASE_EMAIL`/`SUPABASE_PASSWORD` (`sincronizador.crear_cliente_autenticado`) and
upserts `gastos_correo` on `(user_id, mensaje_id)`, sending `user_id` explicitly. The original
design (anon key + `INGESTA_CORREO_SECRETO` + `ingestar_gastos_correo()`/`ingesta_correo`, meant for
a cloud scheduled task without the password) was dropped in
`20261004230000_gastos_correo_escritura_con_sesion.sql`, which adds the insert/update/delete RLS
policies and drops that function and table. If an unattended cloud uploader is ever wanted again,
it needs a new design — don't resurrect the anon-callable function without thinking it through.

**Dashboard "Gastos recientes" tab = month calendar (2026-10-04, user's request)**:
`GastosCorreoTab.tsx` used to be one collapsible `<details>` row per day; it is now `CalendarioGastos`
(a Sunday-first month grid, `semanasDelMes`/`desplazarMes`/`tituloMes` in `lib/gastosCorreo.ts`).
Each day with charges keeps exactly what its collapsed row showed — movimientos · tarjetas and the
day total (compact amount only on narrow screens) — and clicking it opens `PanelDia` (same header +
`TablaResumen` + `TablaDetalle`) *directly under that day's week row*; clicking the open day closes
it, only one day is open at a time, and the most recent day starts open (as the most recent row did
before). ‹ › move between months that have charges (the tab loads every `gastos_correo` row, paged; see "Full-history load" below). Selection survives month changes but its panel only shows in its own month. The phone
layout (cells collapse to number + compact total) was not verified in a real narrow viewport.
**Heat colors (user's request)**: each day's cell is tinted green → yellow → red by its total
(`colorCalor`: HSL hue 120 → 0, mixed 30% into `--surface-1` with `color-mix` so text stays readable in
light and dark; the amount is printed in every cell, color only reinforces). The scale is
`posicionEnEscala`: **logarithmic** between the cheapest and the most expensive day of *all* loaded
days (not just the visible month) — linear would paint everything green next to one $15k day — and all
days equal → 0.5. `LeyendaCalor` shows the gradient with those two amounts. **"Descargar Excel"** in
the day panel header (`lib/exportarGastosDia.ts`, dependency `write-excel-file`, loaded with a dynamic
`import()` so it's its own ~20 KB-gzip chunk) downloads `gastos-AAAA-MM-DD.xlsx` with three sheets:
*Resumen* and *Detalle* (what the screen shows, subtotals and styling included) and *Movimientos* (one
plain row per charge — the one to filter/pivot). Amounts are real numbers with a `"$"#,##0.00` format
(zeros left empty like on screen); the date column is ISO text so the browser time zone can't shift it.
`hojasDelDia()` builds the sheets without downloading, which is how it was checked (zip opened, sums
compared) — the actual "Guardar como" was not exercised.

**"Gastos recientes" has two sources (2026-10-07, user's request)**: `GastosRecientesTab.tsx` puts a
`Segmentado` ("Por correo | Por estado de cuenta", same pill as QQQ's; now its own file) over the
tab; it opens on "Por correo", which is exactly the view above (the calendar shell moved to
`CalendarioMensual.tsx` — generic over `ResumenDia`, with `renderPanel` — and the table pieces to
`TablasGastosDia.tsx`/`lib/gastosUI.ts`, no behavior change). **"Por estado de cuenta"**
(`GastosEstadoCuentaTab.tsx`, `lib/gastosEstadoCuenta.ts`) builds the same days from `transacciones`
(no new query; whole history, month `<select>` when >4 months, opens on the latest day). Differences,
all by the user's choice: columns are **cuentas** (`cuentas.alias`), not card endings; no hora/ciudad
(detail has descripción, tarjeta Titular/Adicional, evento); **only cargos of credit-card accounts whose
categoría is not hidden add up** to the day total, the heat color, the Resumen and Detalle tables —
abonos, **everything of the non-TDC account (Priority, `MovimientoDia.esDebito`; user's correction the
same day: its movements are shown but never counted)** and hidden categories (default:
`categoriasExcluidasPorDefecto`, i.e. Pago TDC/traspasos) go in a separate "No suman al total" table with the reason, and
the cell shows "+N sin sumar"; a day with only those has no heat color ("sin gasto"). **Own "Ocultar
categorías y eventos" row** (2026-10-08: events added at the user's request; a hidden event's cargos go to "No suman"
with the reason "Evento oculto", don't count in the day total/color/averages, and a refund of a hidden event doesn't mark the day
"Abono"; `eventosOcultos` stored in the same `estadosPorPestana["gastos-correo"]`, default none) (collapsed disclosure, independent from the Resumen's; stored in
`estadosPorPestana["gastos-correo"].categoriasOcultas`, `null` = default). Cell badges: one per
non-TDC account with movements that day ("Priority", `nombreCorto`) and "Abono" when there are abonos
of non-hidden categories (a card payment is not income). `$0` cargos (Invex V2 echo lines) are
dropped. **The chosen month/day is shared between the two sources** (`VistaCalendario`, state lives in
`GastosRecientesTab`, `CalendarioMensual` is controlled): switching keeps the month, clamped for display
to the other source's range (correo may start later than the statements) without overwriting the choice, so going back
returns to it. The correo data is fetched once by `GastosRecientesTab` (not by `GastosCorreoTab`, which
unmounts on every switch) so returning to "Por correo" doesn't flash "Cargando…" or re-query. A "Datos hasta:" line shows each cuenta's last date (⚠ after 45 days) because statements
arrive weeks late — an empty day after that date means "not loaded", not "no spending". The day panel
has **inline "Editar"** per movement (categoría/comercio/evento + "Quitar evento", same functions as the
bulk editor, then `recargarTransacciones`; same non-durable-against-reprocessing caveat) and its own
Excel (`lib/exportarGastosEstadoCuenta.ts`, `estado-de-cuenta-AAAA-MM-DD.xlsx`: Resumen, Detalle,
"No suman" when applicable, Movimientos with a "Suma al total" Sí/No column). Checked with a
throwaway harness and synthetic data (sums, hidden-category toggle, month select, editor, workbook
built); not checked in a real phone-width viewport. **Possible correo match (2026-10-08, user's request — a light version of the old "phase 2")**: clicking a movement row in the
statement view opens a floating, tooltip-style card (`CoincidenciaFlotante.tsx`, fixed-position next to the click, closes with
Esc / outside click / × / scroll or resize) with the correo notice that probably is the same charge, or says why there's none.
`lib/conciliarCorreo.ts` matches **exact amount to the cent and date ±1 day** (`TOLERANCIA_DIAS`); there is no shared id between
the two sources, so it's a hint ("posible coincidencia"), not a reconciliation. Rules: only TDC **cargos** (correo notices are
credit-card only; Priority/abonos get an explanatory message) and notices in MXN; **one-to-one** (a notice pairs with a single
charge — two identical charges and one notice don't both claim it; same-day pairs are assigned before ±1-day ones; ties by
fecha/hora/id) with `otrosCandidatos` shown as "hay N avisos más…"; computed over ALL transactions, not the visible days, so
hiding a category/event never changes which notice a charge gets. Rows with a match show a ✉ mark; unmatched rows still open the
card with the reason (no notice that amount/day, notices only start on <date> and the charge is older, still loading, load error).
The correo data is the one `GastosRecientesTab` already loads (passed down as `gastosCorreo`/`errorCorreo`); the row click is a
context (`ContextoCoincidencia`) so the description cell is a button (keyboard) and "Editar" stops propagation. **Still not
done on purpose**: a combined view that fills the days after the last cutoff with correo data, and persisting/confirming matches.

**Weekly daily-average vs. goal (2026-10-08, user's request: "el objetivo es tener un gasto diario de 1000")**: under each
week row of the calendar (both sources; `FranjaSemana` in `CalendarioMensual.tsx`, math in `lib/metaDiaria.ts`) a strip
shows the week's range (Sunday–Saturday, may cross months — the grid only draws the in-month days but the average uses all
7), the **average spend per day**, a bar filled to the goal `META_GASTO_DIARIO` = $1,000 (tick at 100%, green below / red
above, up to 150%), the difference in words ("✓ $200 por debajo" / "▲ $143 sobre la meta" — never color alone) and the
week total. A day with no movements *inside the known range* counts as a $0 day; days outside it are not counted:
`resumenDeSemana(fecha, totales, primera, corte)` counts only days between the first loaded day and `fechaCorte`, so the
current week (or the one after the last statement) averages its known days and says "(N días)" instead of looking cheap.
`fechaCorte` is **today** for "Por correo" (notices arrive almost live: no notices = a real $0 day) and the **latest
loaded movement date** for "Por estado de cuenta" (statements arrive weeks late). "Spend" is exactly each day's total
shown in the cell (so for statements: TDC cargos of non-hidden categories only, Priority/abonos excluded). **The same strip also shows the whole
month's average** (2026-10-08, user's request; blue border, above the weekday header, for the month on screen, "(N días de M)"
while the month is still partial; `resumenDeMes`/`resumenDeDias`) — it counts the month's days within the same
first-day..`fechaCorte` range, so a month spanning the cutoff averages only its known days. The goal is a
constant (no UI to change it). Covered by `lib/metaDiaria.test.ts` (Vitest: week boundaries, partial weeks, first week, no countable days)
and checked in the browser with synthetic data (cutoff per source, over/under).

**Main window layout (2026-10-04, user's request to improve look & usability)**: `_construir_ui`
packs the header (`_construir_encabezado`: bank → "Cargar PDF..." → "Inspeccionar PDF...", rules on
the right; account row below) and the footer (`_construir_pie`: summary, totals as three "cards" —
cargos, efectivo, abonos; "neto" was removed 2026-10-05, unused — and the Guardar/Sincronizar buttons) **before** the notebook, which
gets `expand=True`. Keep that order: when the notebook was packed first, a small window squeezed the
Guardar/Sincronizar buttons to empty slivers. The table has scrollbars, right-aligned amounts with
thousands separators, zebra rows (`_rayar_tabla`, recomputed after sorting), red text for
uncategorized rows, green text for abonos (2026-10-07; an uncategorized abono stays red), yellow background for manual rows, click-to-sort headers (`_ordenar_tabla` only
reorders the view; iids stay = index in `self.transacciones`), an empty-state label, and
"Agregar renglón manual..." next to Editar/Eliminar (enabled only when a manual row is selected).
Colors live in the `COLOR_*` constants at the top of `app/main.py`; the native "vista" theme is kept.
Compact sizing (2026-10-05, user's request): Segoe UI 9, row height 22. The "Estado de cuenta"
(`origen`) column is no longer shown (still saved in the JSON and synced) — the user doesn't use it.
Scripts that open `App()` for testing must patch `app.pestana_gmail.RUTA_PREFERENCIAS_GMAIL`/
`CARPETA_GASTOS_CORREO` (they moved there from `app.main` on 2026-10-08), or the user's real
"revisar al abrir" preference starts a real Gmail check.

**`app/` layout (split 2026-10-08; `main.py` was 2,200 lines)**: `main.py` = `App` (main window,
`PARSERS`, colors) + `main()`; `logica.py` = everything without widgets (`leer_estado_de_cuenta`,
`detectar_banco`, `crear_parser`, manual-row/category recovery, `mover_a_procesados_junto_al_pdf`,
`hash_pdf`, `PREFIJO_RENGLON_MANUAL`), tested in `tests/test_logica_app.py`; `ventanas.py` = the
dialogs (`VentanaReglas`, `VentanaInspeccion`, `VentanaRenglonManual`, `VentanaCategoriaManual`);
`pestana_gmail.py` = the Gmail tab and its preferences; `hilos.py` = `correr_en_hilo`. Checked
by driving the real app under Xvfb (Python 3.12 + tkinter) with temp folders: a synthetic Invex PDF
with an artificially slow extraction (the window kept processing events), save, reload recovering
a manual category, sync against the in-memory fake client, bad login, unreadable PDF → `errores/`,
every dialog opening, and the Gmail tab with a fake `revisar_gmail` reporting progress.

**PDF read once per load (2026-10-08)**: `parsers/comun.py` holds what the parsers used to copy
(`MESES`, `PATRON_PAGO_MINIMO`, `PATRON_INVEX`) and `textos_iniciales(ruta, n)`: the text of the
first `PAGINAS_INICIALES` = 3 pages, extracted once and cached by (path, mtime, size). Bank
detection tries every parser's `puede_procesar` and then `extraer_info_cuenta` runs — before, each
opened the PDF and re-extracted the same pages (5–6 times per load); `puede_procesar` and
`extraer_info_cuenta` of the three real parsers now read through it (`extraer` still opens the PDF
itself, it needs the page objects). That text can include the full account number, so
`leer_estado_de_cuenta` calls `olvidar_textos_iniciales()` in a `finally` — nothing stays in
memory past the load (the "only the last 4 digits" rule).

**Manual category on PDF-extracted rows (2026-10-05, user's request)**: double-click / "Editar..." on
a row that came from the PDF opens `VentanaCategoriaManual` (several selected rows at once is fine):
it changes only categoría/comercio — fecha/monto/descripción stay as the PDF prints them — and
creates **no rule** (for one-offs like "CIERRE COMPRA DIF" = Apple, where a rule would catch every
deferred purchase). Overrides live in `App.categorias_manuales`, keyed by `(pagina, linea_cruda)` (the
upsert key, unique per document); `recategorizar()` re-applies them after the rules so "Recargar
reglas" never overwrites them; `guardar_procesado` marks those rows `"categoria_manual": true` in the
JSON (the sync ignores that key) and `recuperar_categorias_manuales` restores them when the same PDF
is reloaded. The table shows them as "✎ <categoría>"; "Volver a la regla" removes the override.
A typed manual row still opens its full `VentanaRenglonManual` form.

**"Recargar reglas" button (2026-10-04, user's request)**: `App.recargar_reglas` re-reads `reglas_categorizacion.json` (e.g. after Claude or the user edits it outside the app) and, if a statement is loaded, runs `recategorizar()` and reports how many rows changed and the uncategorized count before → after — no restart needed. Refuses while `VentanaReglas` is open (that window works on its own copy and "Guardar y cerrar" would overwrite the reloaded file); an unreadable JSON keeps the previous rules.

**Categorization rule order matters — first match wins** (`categorizar()`): a more specific pattern
must come before a generic one that it contains (e.g. `"SU PAGO INTERBANCARIO"` before `"PAGO
INTERBANCARIO"`). `VentanaReglas` has "▲ Subir / ▼ Bajar" buttons (2026-09-26) because new rules are
appended at the end, where a specific rule would never win; before that, reordering meant editing
`reglas_categorizacion.json` by hand.

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

**Manual row entry** (`VentanaRenglonManual` in `app/ventanas.py`) is the other half of the
"transaction row rendered as an image" gap above — `advertencias()` only *flags* the unreadable
row, it can't recover it, so the "Agregar renglón manual..." button (next to "Inspeccionar
PDF...") lets the user type one in by hand: fecha, descripción, monto sin signo, tipo, and an
optional página (fill it in from the `advertencias()` message if you know which page it was on;
defaults to `0` otherwise). Requires a PDF already loaded — `App.ruta_pdf_actual` — because a
manual row still needs to belong to a document for `origen`/sync purposes; it does *not* require
that the extractor found any real transactions first. **Defaults come from the parser
(2026-10-02, user's request):** `BaseParser.sugerencias_renglon_manual()` (optional hook, default
`[]`, parallel to `advertencias()` — one `SugerenciaRenglonManual(fecha_texto, pagina, tarjeta)`
per warning that points at a missing transaction; `banamex.py`, `banamex_tdc.py` and `invex_tdc.py`
fill it next to each `_advertencias.append`) feeds `App.sugerencias_renglon_manual` (dates
converted to ISO with the parser's `formato_fecha` by `leer_estado_de_cuenta` in `app/logica.py`). The dialog's *Fecha* is an editable combo
listing those dates (first one preselected; today if the parser flagged nothing), choosing one
prefills *Página* and *Tarjeta*, and saving a row consumes its suggestion and jumps to the next.
*Tarjeta* is an editable combo (`(sin tarjeta)`, Titular, Adicional, Digital, plus any `tarjeta`
already in the load, e.g. Invex V2's last-4 fallback). **Categoría/comercio** are editable combos
(options from the load + the rules) pre-filled by `inferir_categoria_comercio()`
(`transform/categorizador.py`) every time the description changes: current rules first, then loaded
transactions with the same description, then loaded ones whose description *or `linea_cruda`*
contains the typed text (≥3 chars, case- and whitespace-insensitive), most frequent
`(categoria, comercio)` pair winning. The text first goes through the parser's
`descripcion_para_categorizar()` (optional `BaseParser` hook, identity by default): parsers that
rewrite a description *before* categorizing must do the same for typed rows, or what the PDF prints
never matches the rules — `BanamexTdcParser` maps the `"SU ABONO...GRACIAS"` courtesy line to
`"PAGO TDC <TIER>"` (tier stored in `_tipo_tarjeta_documento` by `extraer()`), which is exactly the
unreadable-image row this dialog exists for (typing it used to infer nothing, since the readable
equivalents in the load only carry the original text in `linea_cruda`); the dialog reaches the
parser through `App.parser_actual`; once the user edits either combo by hand it stops
being re-inferred, and leaving them empty saves the row uncategorized. Because the category of a
manual row is no longer purely rule-derived, `App.recategorizar()` and `recuperar_renglones_manuales`
keep a manual row's existing categoría/comercio when no rule matches it (a matching rule still wins;
extracted rows are unaffected and still go uncategorized when their rule disappears). (Before this,
the dialog only ever applied `categorizar()` with no way to choose — "add/edit a rule instead".) `pagina`
defaults to `0` and `linea_cruda` is built as `f"(manual) {fecha} | {descripcion} | {monto} |
{tipo}"` — distinct per entry so it can't collide with a real extracted line, and unique enough
across manual entries in the same document to not collide with each other on the sync upsert's
`(documento_id, pagina, linea_cruda)` constraint. The row is a plain `TransaccionCanonica`
appended to `self.transacciones`, so it flows through totals/validation/export/sync identically
to an extracted one — no special-casing anywhere downstream. Two rules added 2026-09-26: (1) two
*identical* manual rows (same fecha/descripción/monto/tipo, e.g. two unreadable identical tolls)
get `" (2)"`, `" (3)"`… appended to `linea_cruda`, same as `_desambiguar_renglones_duplicados` does
for extracted rows — otherwise the upsert rejects the whole document; (2) reloading a PDF recovers
its manual rows from its previous `data/procesados/<hash>.json` (`recuperar_renglones_manuales` in `app/logica.py`,
recognized by the `PREFIJO_RENGLON_MANUAL = "(manual) "` prefix, re-categorized with the current
rules) — before, reloading to recategorize and re-saving silently dropped every row the user had
typed in. **Editing/deleting manual rows (2026-10-02, user's request)**: manual rows show in yellow in the table (`manual` tag); double-click or "Editar renglón manual..." reopens `VentanaRenglonManual` with `editando=` (prefilled, "Guardar cambios" replaces the row in place, found by identity), and "Eliminar renglón manual" removes it after a confirmation. Extracted rows are refused (they come from the PDF — fix the rule instead). An edit **keeps the original `linea_cruda`** on purpose: with `pagina` it's the upsert key, so re-syncing updates the already-synced row instead of leaving the wrong one plus a new one (stale rows are never deleted); changing `pagina` does change the key, so that case warns. Deleting an already-synced manual row leaves it in Supabase — the confirmation says to remove it by hand there. Changes persist only after "Guardar archivo procesado".

**"Sin categorizar" tab (added 2026-09-26)** — the transaction table area is now a `ttk.Notebook`
with two tabs: "Transacciones" (the `Treeview` that always existed) and "Sin categorizar", a
plain read-only `tk.Text` listing the *unique* descriptions (not every occurrence — pasting the
same "UBER" fifty times over doesn't help) of transactions whose `categoria` is `None`, one per
line, plus a "Copiar todo" button (same `clipboard_clear`/`clipboard_append` pattern already used
by `VentanaInspeccion`). User's explicit request: they'd been taking screenshots of the table to
paste into a chat with Claude asking for a categorization proposal — this replaces that with a
plain-text list they can copy directly. `App._refrescar_sin_categorizar()` is called from inside
`_refrescar_tabla()`, so it's already implicitly kept in sync everywhere that method already runs
(after `cargar_pdf`, and after `recategorizar()` — which `VentanaReglas` calls on close) without
needing new call sites. Deliberately just descriptions, no categoria/comercio/monto columns — the
point is a minimal paste-ready list, not a second view of the table (that's what the other tab is
for).

**"Sugerir reglas con Claude..." (2026-10-08, user's request: stop pasting the list into a chat)**:
same tab. `transform/sugerencias_ia.py` (no tkinter, tested in `tests/test_sugerencias_ia.py`) runs
**Claude Code's CLI** headless (`claude -p --output-format json`, prompt on stdin, `cwd` = temp dir so
it doesn't load this CLAUDE.md, `CREATE_NO_WINDOW`) — the user chose it over the Anthropic API (per-use
cost, breaks the $0 budget) and Ollama (weak at Mexican merchants/RFCs): it uses their Claude
subscription. `buscar_claude` also checks `~/.local/bin` and `%APPDATA%
pm` because the app is
opened from a desktop shortcut (`pythonw -m app.main`) that may not inherit a console's PATH. What
leaves the laptop: the unique uncategorized descriptions + all current rules (as style examples) —
same as pasting into the chat. The prompt encodes the user's conventions (literal distinctive
pattern/RFC, existing categories, bank movements comercio = categoría except Domiciliación, GBM →
"GBM", **null when unsure instead of guessing**). Runs in `correr_en_hilo`; results open
`VentanaSugerenciasIA` (`app/ventanas.py`): one row per description, preselected if acceptable and
confidence ≠ "baja"; `problema_de` greys out unknown merchant, pattern not literally in the
description, < `MINIMO_CARACTERES_PATRON` = 4 chars, or duplicate pattern; each row can be edited
below the table, which also shows the note and "también atraparía" (other pending descriptions the
pattern matches). `App.agregar_reglas` re-reads the rules file from disk, **appends** the accepted
rules (appending can only catch currently-uncategorized rows — earlier rules still win, so no
regression check is needed), saves, recategorizes, enables "Guardar". Refuses while `VentanaReglas`
is open (same reason as "Recargar reglas"). Not done: the Gmail tab's uncategorized merchants.
**Setup is handled by the app (2026-10-09, user's request: "no que el usuario tenga que estar corriendo
comandos")**: `_ejecutar_claude` raises `FaltaClaudeCode` (not found) or `FaltaIniciarSesion` (CLI
output matches `PATRON_SIN_SESION`: login / API key / authenticat…). `App.sugerir_reglas_con_ia`
then asks and runs `instalar_claude()` in the thread (`npm install -g @anthropic-ai/claude-code` if
npm exists, else Anthropic's official `irm https://claude.ai/install.ps1 | iex`), then
`abrir_inicio_de_sesion()`: `claude` in its own console (`cmd /k`, `CREATE_NEW_CONSOLE`) where the
user logs in via the browser; the app polls the process every second (`after`) and, when that
window is closed, retries the request by itself. Login itself can't be automated (the user's own
credentials, in the browser). Checked with fakes driving the real window (install → login → proposals
→ rule saved); the real install/login was not run from here.

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
that one conditional. Every query in `src/lib/queries.ts` (`transacciones` by foreign keys plus
the `categorias`/`eventos`/`documentos(cuentas(alias, bancos(nombre)))` catalogs, joined in the
browser — see "Data loading & writes") is deliberately **not** filtered by `user_id` in code — RLS is the only access boundary, by design, so a bug in
the frontend query can't leak another user's rows. Aggregation (by-month, by-category, running
balance per account) happens client-side in plain functions in `queries.ts`, kept separate from
the React components so they're unit-testable without rendering anything (and are: see Tests).
The README's "Qué muestra" section describes every tab for the user, in Spanish — **update it
when a tab is added, removed or changes what it shows**; it went stale once already (it described
the first dashboard until 2026-10-09).

**Charts**: `IngresosGastosChart` (ingresos vs. gastos por mes) and "ingresos y gastos por
categoría / comercio / evento", which since 2026-10-08 are ONE component,
`IngresosGastosPorDimensionChart` (`dimension` prop; it replaced three near-identical
`GastoPor{Categoria,Comercio,Evento}Chart` files), fed by the generic `agruparPor(transacciones,
claveDe)` in `queries.ts` (`categoriaDe` / `comercioDe` / `eventoDe`). Top-8 horizontal bars,
cross-filter. Only categoría folds the rest into a non-clickable "Otros" (`plegarResto`);
comercio and evento have **no** "Sin comercio/evento" bucket and no fold: they are optional by
design (only rules that explicitly set a comercio populate it — see the `comercio` bullet earlier
in this doc), so `claveDe` returns null and those transactions are skipped rather than lumped
into a noisy catch-all the way `categoriaDe()`'s `SIN_CATEGORIA` fallback does for categories.
(The comercio chart was added 2026-09-20, replacing an earlier `TendenciaSaldoChart` — see below.)

**Resumen tab = former Resumen + former Indicadores, merged (2026-09-26, user's request)**:
`VistaResumen.tsx` is the single view for the "Resumen" tab *and* every non-credit-card account tab; the separate
"Indicadores" tab/`IndicadoresTab.tsx` is gone (its presentational pieces live in
`IndicadoresUI.tsx`: `Tile`, `Delta`, `Tabla`; calculations stay in `src/lib/indicadores.ts`).
Tabs: Resumen, Eventos, Categorías y Comercios, Tarjetas de crédito (all TDCs in one comparison
tab), then one per remaining account (e.g. Priority). The merge unified three controls whose **scopes
differ on purpose** (user chose each one explicitly) — keep them this way:

- **Period (applies to everything)**: `rangoMeses` "Desde/Hasta" month `<select>`s over months with
  data → `resolverPeriodo` → a list of months (no filter = last 3 *complete* months; one side empty =
  that single month). There is no longer a `mes`/`anio` cross-filter: clicking a month bar in
  `IngresosGastosChart` sets the period to that month, clicking a year (Meses/Años toggle,
  `VistaTiempo`) sets it to that year's first..last month *with data* (`rangoDeAnio`, so missing
  months don't average in as $0); clicking the same bar again resets to the default. That chart is
  the one that *chooses* the period, so it highlights the period (`resaltados`, others dimmed)
  instead of being trimmed to it. Its toggle is "13 meses | Todo | Años" (`VistaTiempo` =
  `"recientes" | "meses" | "anios"`); **the default is "13 meses"** (2026-10-03, user's request):
  the current month plus the 12 before it, widened back to the period's first month if the chosen
  period starts earlier so the highlight never falls off the chart; "Todo" is the whole history. Indicators count only the period's
  months, average over the period's month count, and compare against the immediately preceding
  period of the same length (Aug vs. Jul). Deliberate exceptions that look outside the period:
  recurring expenses (6 months ending at the period's last month — needs history; charges with an
  `evento` are skipped, an event is a one-off by definition), the 12-month savings rate shown as
  long-run context, the "vs. your previous monthly average" reference (up to 12 months before the
  period, only months since the first statement), and `FlujoNetoChart` (≥12 months ending at the
  period, period highlighted). The old 3/12-month average KPI tiles (`StatTile`,
  `calcularPromedios`) were removed — the period-based tiles replace them.
- **Ocultar categorías (applies to everything)**: one pill row; `categoriasOcultas` is removed from
  the whole history *before* anything else (`ocultarCategorias`). Defaults to hiding transfers
  between the user's own accounts (`categoriasExcluidasPorDefecto`: names matching
  `pago tdc|entre cuentas|traspaso` — paying the card from checking would otherwise count as both
  expense and income). The default is stored as `null` in `EstadoVista` and resolved at render
  (`categoriasOcultas ?? categoriasOcultasPorDefecto` in `Dashboard`) — storing a copy at state
  creation caused a real bug twice (the first change to *another* field created the state from
  empty and silently re-counted "Pago TDC"). The pill list derives from the raw transactions so a
  hidden category never disappears from its own toggle. Hiding vs. click-isolating the same
  category cross-clears (`alternarCategoriaOculta`/`seleccionarCategoria`). The bulk editor's search
  is exempt from hiding.
- **Click filters / cross-filter, Power BI style (detail only)**: `Filtros` = categoría, comercio,
  cuenta, tarjeta, evento (pill rows + chart clicks, chips to clear). They filter the *spending
  detail*: category/comercio charts, the transactions table, the Sankey, gasto hormiga
  (`calcularGastoHormiga`), categorías al alza (+ sparklines), and the income-vs-expenses chart.
  They do **not** filter the financial-health indicators (hero savings rate, net flow, average
  spend, months covered, recurring, `FlujoNetoChart`) — a savings rate of just "Comida" means
  nothing; `calcularIndicadores` gets the hidden-categories set but never `filtros` (a note under
  the chips says so). `aplicarFiltros(transacciones, filtros, excluir?)` — `excluir` (a key or an
  array) is the cross-filter trick: each chart is computed with every *other* active dimension but
  not its own, so it still shows the other options to click. Non-selected marks dim to ~0.3 via
  `<Cell fillOpacity>`. The "Otros" fold of the category chart is not clickable.

**Filter layout (2026-10-03, user's request — "se ve amontonado")**: the Resumen's pill rows live in
one card, `PanelFiltros.tsx` (presentational only; every click handler stays in `VistaResumen`):
click filters (Cuenta/Tarjeta/Evento) as rows with an aligned label column (label above the pills on
a phone), then, below a divider, a collapsed-by-default "Excluir del análisis" disclosure whose
header lists what is currently excluded (hidden categories + discarded events, e.g. "· Pago TDC")
and expands to the Categorías/Eventos exclusion pills. Same behavior as the old separate rows —
only the layout changed. Active-filter chips stay above the card.

**"Categorías y Comercios" tab handles income-only selections (2026-10-02)**: its first chart
(`GastoConPromedioMovilChart`, monthly total + 3-month moving average) used to sum only cargos, so
picking a category that is all abonos — e.g. "Transferencia recibida" — showed $0 every month.
`ladoDominante(transacciones)` (in `indicadores.ts`) returns `"ingreso"` only when the filtered
selection has abonos and **no** cargo at all, otherwise `"gasto"` (so a mixed category, or no
filter, behaves exactly as before); that `lado` flips the series to ingresos (blue bars, "Ingreso
mensual", title "Ingreso mensual y promedio móvil de …") and also makes the "mayores" table list
the largest abonos instead of cargos. `PuntoGastoConPromedioMovil.gastos` was renamed `monto`
since it now holds either side. Not touched: the two "Ingresos y gastos por categoría/comercio"
charts, which already plot both series. Related latent bug fixed in the same pass: `Tabla`
(`IndicadoresUI.tsx`) keyed its rows by the first cell (the description), but this tab's top-10
list routinely repeats descriptions (several "UBER…"), so React logged duplicate-key errors and
left stale rows in the DOM when the filter changed — keys now include the row index.

**Click-a-month on that tab's first chart (2026-10-07, user's report: "el clic tipo Power BI no funciona")**: the
monthly bars of `GastoConPromedioMovilChart` are now a cross-filter like the other charts: a click anywhere on a month's
column (chart-level `onClick` + `activeLabel`, not just the thin bar) sets `mes` (local state in `DetalleDimensionTab`),
which narrows the category/comercio bar charts, the "mayores" table and the transactions table to that month; the monthly
chart itself is **not** trimmed (it excludes its own dimension, `transaccionesSinMes`) — the chosen month stays full and
the rest dim to 0.3. Same click again, the "Mes: AAAA-MM ×" chip or "Limpiar todos los filtros" clear it. `lado`
(ingreso vs gasto) is decided without the month so the chart doesn't flip labels.

**"Categorías y Comercios" tab: comercio options follow the category (2026-10-03, user's request)**:
with a category chosen (select or bar click), the "Filtrar por comercio" select in
`DetalleDimensionTab.tsx` lists only the comercios that have movements in that category
(`comerciosDeCategoria`); with no category, all of them. Choosing a category also clears an
already-chosen comercio that has no movements in it (`conCategoria`), so the pair never ends up
empty. The category select itself still lists every category.

**"Tarjetas de crédito" tab (2026-10-03, user's request — replaced the per-card tabs)**: the
credit cards (Invex TDC, TDC Beyond, TDC Conquista, TDC Platino) no longer get one tab each; they
share a single comparison tab, `TarjetasCreditoTab.tsx` (calculations in `src/lib/tarjetas.ts`,
charts in `ComparativoTarjetasCharts.tsx`). A card is an account whose bank name or alias contains
"TDC" (`esTarjetaCredito` — bank names come from the desktop app's `PARSERS` keys, "Banamex TDC"/
"Invex TDC"); the user explicitly asked to keep the checking account out ("no incluyas la
Priority"), so every non-TDC account still gets its own tab with the full `VistaResumen`. "Card"
here means the account/card product (`cuentas.alias`), *not* `transacciones.tarjeta`
(Titular/Adicional/Digital). Contents, all over the same period control as the Resumen
(`SelectorPeriodo`, now shared in `IndicadoresUI.tsx`; default last 3 complete months; stored in
`estadosPorPestana["tarjetas-credito"].rangoMeses`): a 100% bar of how spending splits across cards
with direct labels; a per-card table (spend, purchases, average ticket, change vs. the previous
period of the same length, payments/refunds, top category, 12-month sparkline in the card's color);
monthly spend stacked by card over 12 months with the period highlighted; and spend per category
stacked by card ("para qué usas cada tarjeta", top 8 + "Otras"). **"Gasto" = cargos only**; abonos
(card payments, refunds) are reported separately as "Pagos y abonos" — netting them would cancel
the spending. `$0.00` cargos are excluded from purchase counts (Invex V2 echo lines, see the Invex
parser notes). **Click-filters (added 2026-10-03, user's request —
the first version left them out)**, same Power BI cross-filter as the Resumen and stored the same
way (`estadosPorPestana["tarjetas-credito"].filtros`): clicking a card (distribution bar, table
row, either chart's legend) sets `filtros.cuenta`; clicking a category bar sets
`filtros.categoria` ("Otras" isn't clickable); clicking a monthly bar makes that month the period
(again = back to default), exactly like the Resumen's `IngresosGastosChart`; chips above clear
them. Each view excludes its own dimension (`aplicarFiltros(..., "cuenta" | "categoria")`): the
per-card views (distribution, table, monthly chart) are computed with the category filter but
not the card filter — so with "Comida" picked they compare the cards *on Comida only* — and dim
the non-selected cards; the category chart uses the card filter but not its own, so with a card
picked it shows only that card's categories, with the selected category dimming the rest. A
`TransaccionesTabla` at the bottom lists the period's movements with every filter applied (its
empty message says "nothing matches", not "nothing synced"). Still no category hiding here; for a
card's Sankey/indicators/bulk editor use the Resumen's "Cuenta" pill filter. **Card colors**: categorical
slots 1–4 of the dataviz palette (`--series-1..4`, `colorTarjeta` in `lib/tarjetas.ts`), assigned
by fixed alphabetical order of *all* cards so a card keeps its color across periods; validated with
`validate_palette.js` in both modes (passes adjacent-pair CVD/normal-vision; light-mode aqua/yellow
are below 3:1 contrast, hence the mandatory direct labels + table). A 5th card would fall back to
`--text-muted` — add and validate a `--series-5` rather than cycling hues. **Percentages (2026-10-03, user's
request)**: both bar charts' tooltips list each card's amount *and* its share of that row (month or
category) plus the row total (`TooltipPorTarjeta`); the monthly chart labels each segment's share of
its month *only* inside the highlighted period months and only when the segment is ≥12% and big
enough to fit (selective labels, per the dataviz skill — not a number on every bar; on a phone the
bars are too narrow, so the tooltip carries it); the category chart puts one "amount · % of the
period's card spend" label at the end of each bar. In-segment label text is near-black on every
fill — measured ≥4.5:1 against all four card colors in both modes, white dropped to 2.2:1 on light
yellow. **Recharts gotcha**: `<Bar>` drops zero-size bars *before* handing them to `<LabelList>`, so
the `index` a custom label `content` receives is the position in that filtered list, not in the
data array — one card at $0 in some month shifted every later label to the wrong row. Labels here
use `valueAccessor` to receive their row's `etiqueta` and look the row up by name; and the
category end-label hangs off the last card *with an amount* in that row (the last card in the list
may be $0 there and not drawn at all).

**Alertas automáticas (2026-10-03, user's request)**: `AlertasPanel.tsx` sits at the very end of
`VistaResumen`, after the bulk editor (moved there from above the hero savings rate at the user's
request, 2026-10-03) (so the Resumen and every non-TDC account tab get it); calculations are pure
functions in `src/lib/alertas.ts` (`calcularAlertas(visibles, periodo)`). Same scope as the health
indicators: period + hidden categories/discarded events, **never the click filters**. Five kinds,
phrased as sentences: (1) savings rate changed ≥2 pts vs. the previous period, explained by
whichever moved more — spending (naming the category with the biggest change) or income — always
listed first; (2) *possible* duplicate charge: same account + comercio (or description) + amount +
day — "possible" on purpose, identical Televia tolls are legitimate; (3) subscription price change:
per comercio, only months with exactly one charge (a supermarket with several charges a month has no
"price"), two equal previous charges (±2%) then one in the period that differs by ≥3% and ≥$10 but
≤50% (a bigger jump is a different purchase, not a price change); (4) new subscription: comercio
first seen in the last 3 months, ≥2 single monthly charges of the same amount; (5) unusual charge:
≥$1,000, ≥3× the category's median **and** above its max over the 12 months before the period, with
≥6 historical charges (top 3). Charges with an `evento` are skipped by 3–5 (one-offs by definition);
$0 cargos (Invex V2 echo lines) never alert. Rest sorted "revisar" → "favorable" → "info", then by
pesos at stake; 4 shown, "Ver N más". Tones carry icon + text label (⚠ Revisar / ✓ Buena noticia / ℹ
Para saber), never color alone. "Ver movimientos" sets the alert's comercio/categoría click filter.
Subscriptions/price changes only see what the rules tag with `comercio`, same as recurrentes.

**"QQQ / TQQQ" tab (2026-10-02, user's request)** — technical analysis for trading, unrelated to
the personal finances; it only lives in this dashboard to keep everything in one place, so it
doesn't touch Supabase or the transactions and shows even with no synced data. Daily candles (10
years) come from `frontend/functions/api/cotizaciones.ts`, a **Cloudflare Pages Function** (free,
same domain → behind the same Cloudflare Access, no CORS problem) that proxies Yahoo Finance's
public, unofficial chart endpoint — no API key; whitelisted to `SIMBOLOS_PERMITIDOS` so it isn't an
open proxy. The upstream fetch uses `cf: { cacheTtl: 300, cacheEverything: true }` (2026-10-08) so
Cloudflare's edge cache serves repeat requests for 5 minutes instead of hitting Yahoo every time
(public data, same for everyone; ignored in `npm run dev`). For it to deploy, `deploy.yml` runs `wrangler pages deploy dist` with
`workingDirectory: frontend` (wrangler picks up `functions/` from its cwd); in `npm run dev`,
`vite.config.ts` mounts the same handler as middleware. If Yahoo ever changes/blocks it, only this
tab shows an error. Indicators are pure functions in `src/lib/tecnico.ts` (SMA 50/200, Bollinger
20/2, Wilder RSI 14 and ATR 14, MACD 12/26/9, drawdown, QQQ-vs-TQQQ comparison table with beta
and "3× QQQ vs real" leverage decay — its base-100 and drawdown charts were removed at the user's
request, 2026-10-02, only the table remains), computed over the full 10 years and then trimmed to the
visible range so the SMA 200 has history from the first visible day. UI in `AnalisisTecnicoTab.tsx`
(price/volume/RSI/MACD charts synced with `syncId`; candles only up to 1 year — beyond that they're
1–2 px wide). Colors reuse palette slots 1–4: up/down polarity = series-1/2 (like
`FlujoNetoChart`), SMA 50 = series-3, SMA 200 = series-4. Readings are
phrased as indicator states, never as buy/sell recommendations.
**Support/resistance levels (2026-10-08, user's request, from a reference image)**:
`calcularNiveles` (`tecnico.ts`, tested) works on the last `SESIONES_NIVELES` = 126 sessions of the
*full* series (not the visible range, so zooming doesn't move them): pivots (high/low of ±5
sessions) clustered within 0.75 ATR into zones (min half-width ±0.25% of price); resistance = the
nearest zone above the close, or the 6-month high when the price is at highs; supports below =
"inmediato" and "intermedio" (two nearest) and "estructural" (most touches among the rest, ≥2);
SMA 50 / SMA 200 become "Soporte mayor"/"Soporte largo plazo" (or resistance if above) and absorb a
pivot zone within 0.5 ATR. Drawn as dashed `ReferenceLine`s (resistance `--status-critical`,
supports `--status-good`, the SMA levels in their own color and only dashed when that SMA layer is
off) plus an HTML label column to the right (`ANCHO_ETIQUETAS`; the volume chart reserves the same
padding so the bars stay aligned). To place labels on the same scale as the lines, `GraficaPrecio`
computes the Y domain itself and passes it with `allowDataOverflow` (otherwise Recharts "nices" the
domain and the pixels drift); `separarEtiquetas` pushes overlapping labels apart. Only levels within
the visible price range ±3% are drawn (a TQQQ support 25% below would squash the chart); all are
listed in the "Soportes y resistencias" table, which is also how a phone sees the names (no label
column there). Toggle "Soportes y resistencias", on by default.
**Volume, levels audit and chart patterns (2026-10-08, user's request; branch `feature/patrones-chartistas`)**:
all detection lives in `src/lib/patrones/` and **every parameter is in one file, `config.ts`
(`CONFIG_DETECCION`)** — pivot window (5 each side), ATR period, volume window (20) and threshold (1.5×),
level tolerances (`niveles.*`; `calcularNiveles` moved to `patrones/niveles.ts` and is re-exported by
`tecnico.ts`), quality cut-offs and each pattern's rules. Detectors take the config as a parameter so tests
can vary it. Data: OHLCV already comes from the Yahoo Pages Function (volume included, no key), so no provider
was added. **Volume panel**: bars colored vs. the *previous close* (`PuntoTecnico.alzaDelDia`, blue up /
orange down), the 20-session average line, a dot on days above 1.5× (`volumenAlto`, also said in the
tooltip) and a legend. **Levels are auditable**: each `NivelTecnico` keeps its `pivotes` (date, price,
candle), `velasOrigen` and a `motivo` (distance in % and ATR, touches, SMA coincidence); the "Soporte
estructural" is the floor of the latest lateral range (rectangle detector) when there is one, else the
zone with the most touches. Hovering a label shows the pivot dates (a floating card), clicking pins it and
opens a *Trazabilidad* panel with the exact candles (fecha, OHLC, volumen); the table has a "Pivotes
(fechas)" column and "Ver velas" (phones). **Patterns** (`rectangulo`, `hch` + inverted, `bandera` bull/bear,
`taza` with handle, `murcielago`, `dobles`): all work on alternated fractal pivots; a pattern exists only if
ALL its *obligatory* rules pass (the quality rules never block it, they only set `puntaje` → alta/media/baja
and show as ✓/✗ in the card). H-C-H and double top/bottom require the breakout to be *confirmed by a close*;
rectangle and flag allow "en formación". Detection runs on the **visible range** (user's choice — it changes
with the 3M…10A zoom, unlike the levels) and at most `maximoPorFamilia` = 4 latest per family are kept; chips
enable each family and show "No detectado" (disabled) when none passes. Interpretations worth knowing:
bat tolerance is ±3% *relative* on each ratio, "BC 1.618–2.618" is read as **CD = 1.618–2.618 × BC** (user
confirmed), D = 0.886 of XA measured from A, and its "objetivo" is the 0.618 retracement of A→D; the cup
adds a *round base* rule (`baseRedondaMax`) because a parabola also fits a "V" with R² ≈ 0.94. Drawing is
`components/dibujoPatrones.tsx` (Recharts `ReferenceArea/Line/Dot` from the pivots' dates and prices; labels
in Spanish; rectangle touches are dots without text), cards/panel in `PanelPatrones.tsx`, generic floating
card `TarjetaFlotante.tsx` (also used by the statement↔correo match). Tests: `lib/patrones/*.test.ts` with
synthetic series from `src/test/series.ts` (rectangle, H-C-H both ways, flag both ways, cup, bat, doubles,
and series with no patterns). Not verified in a real phone-width viewport (emulation doesn't apply here).
**Macro EE.UU. section (2026-10-02, user's request)**: a "Análisis técnico | Macro EE.UU." switch at
the top of the same tab. `frontend/scripts/fred.ts` downloads the fixed `SERIES_MACRO` list from
FRED's public `fredgraph.csv` endpoint — no API key (the JSON API needs one) — **with its own
User-Agent: FRED hangs requests that fake a browser UA**. **It can't run on Cloudflare**: first
shipped as a Pages Function (`/api/macro`) and FRED answered **520** to every request from
Cloudflare in production (it works from a laptop or GitHub runner), and FRED sends no CORS headers,
so the browser can't call it either. So `deploy.yml` runs `node scripts/descargar-macro.ts` (Node's
built-in TS type stripping, no extra dependency) before the build, which writes
`public/macro.json` (gitignored) and ships it as a static file; the workflow also runs on a
`schedule` (weekdays 15:00 and 23:00 UTC) and `workflow_dispatch` just to refresh it. On a
scheduled run a total download failure fails the job, so the previous deploy (with yesterday's
data) stays live; on a push it's `continue-on-error` so FRED being down never blocks a code
deploy (the section then shows "todavía no se han generado" until the next run). In `npm run dev`,
`vite.config.ts` serves `/macro.json` by downloading live. A series that fails arrives empty with
its error in `errores` instead of failing the whole file. `src/lib/macro.ts` turns them into tiles (`MacroEeuu.tsx`): Fed target
range + date of its last move, real rate (midpoint − core PCE YoY), 2y/10y yields, 10y−2y curve,
PCE/CPI headline and core YoY, payrolls monthly change, unemployment, initial claims, wage growth,
JOLTS, real GDP, retail sales MoM, Michigan sentiment, VIX. Each tile shows the reference period
(not the release date), the change vs. the previous observation (daily series: vs. the previous
month's close) colored green/red **at the user's request (2026-10-02; the first version was
deliberately neutral)** by whether that move is usually good news for the Nasdaq-100
(`favorableSi` per definition: lower inflation/rates/yields/VIX/wage growth/claims/unemployment,
higher payrolls/JOLTS/GDP/retail sales/sentiment; a Fed cut is green, a hike red; the 10y−2y curve
stays uncolored; "sin cambio" when the change rounds to zero) — the footnote says a very strong
jobs print can read the other way, and a min-max scaled mini trend (~2 years) with a dashed reference (2% target,
0) when relevant. **Clicking a tile (2026-10-02, user's request) opens its history chart**
(`DetalleIndicador` in `MacroEeuu.tsx`) below that group: 1A/2A/5A/10A over `serieCompleta` (FRED
download is 10 years, ~0.4 MB / ~70 KB gzip), bars with blue/orange polarity for changes around 0
(payrolls, GDP, retail sales), a step line for the Fed (tooltip shows the range), a line for the
rest; the 2% target / 0 reference uses `ifOverflow="extendDomain"` (otherwise Recharts silently
drops a reference line outside the data's range). **Next-release dates (2026-10-02, user's request)**: `fred.ts` also
scrapes "Next Release Date" from each non-daily series' FRED HTML page (`SERIES_CON_CALENDARIO`; there's
no keyless CSV for it) and the FOMC decision days (last day of each meeting, current + next year) from
federalreserve.gov's `fomccalendars.htm`; both are best-effort (missing → the tile just shows no
date) and go into `macro.json` as `proximasPublicaciones` / `reunionesFomc`. Each tile shows "Próximo
dato" (the Fed tile "Próxima decisión"; the real-rate tile follows core PCE; daily series say "Se
actualiza cada día hábil"), and when fewer than `DIAS_PUBLICACION_CERCANA` = 5 days remain it's
highlighted with a yellow (`--series-4`) badge plus "hoy / mañana / en N días" text; a box at the top
lists the releases within 5 days grouped by date. Days are counted from the browser's *local* date
(`fechaLocalHoy`, not UTC). **Calendar-only events (2026-10-05, user's request — they missed the
ISM/PMI and the FOMC minutes)**: `eventosCalendario` (`macro.ts`) adds, with no value, the next
**FOMC minutes** (decision + 21 days, from `reunionesFomc`, which now also includes the previous
year so December's minutes show in January), **ISM + S&P Global manufacturing PMI** (1st US
business day of the month) and **services PMI** (3rd business day) — the final S&P Global PMIs come
out the same days; flash PMIs have no fixed rule and aren't listed. Business days skip weekends and
the only federal holidays that can fall in a month's first days (New Year's and July 4 with their
observed day, Labor Day). All three are labeled "estimada" (the Fed can move minutes a day around a
holiday; ISM rarely moves). They appear in the "próximos 5 días" box and in a "Calendario (sin dato
en el tablero)" section. **Their values are not included on purpose**: ISM and S&P Global PMIs are
licensed (ISM pulled its series from FRED in 2016) and no free keyless source was verified — the
cloud sandbox's network couldn't even reach ismworld.org to test a scraper; don't add one without
checking terms and testing it from GitHub Actions.

Per-tab view state (`filtros`, `categoriasOcultas`, `rangoMeses`, `vistaTiempo`) still lives in
`Dashboard`'s `estadosPorPestana: Record<tabId, EstadoVista>`, passed to each view as controlled
props, so filtering in one tab never touches another and a tab keeps its selection when you switch
away and back. The bulk editor inside a per-account tab only *searches* that account's
transactions, but gets the full list via `EditorTransacciones.catalogo` for suggestions, the
destination-account list and the account-change impact count.

The "Categorías al alza" table has a "Tendencia 12 meses" column (`Sparkline.tsx`, hand-rolled
inline SVG fed by `gastoMensualPorCategoria` over the 12 months ending at the period's last month):
context line in `--text-muted`, period months + last point in `--series-2`, each series scaled
0→its own max (shape, not cross-category magnitude), native `<title>` tooltip per month, and an
`aria-label` with every value.

**Removed, then reintroduced: filtering by `cuenta`.** `TendenciaSaldoChart` (2026-09-20, user's
explicit request, no risk flagged — a straightforward swap, not a correction of a bug) plotted one
line per account's running `saldo` over time and was, at the time, the *only* UI source of the
`cuenta` filter dimension — removing the chart made that whole dimension unreachable, so
`Filtros.cuenta` and its `aplicarFiltros` branch were deleted too rather than left as dead code with
no way to trigger it. (The `saldoActual` KPI tile mentioned in older notes no longer exists; balance
surfaces as "Meses cubiertos con tu saldo", computed from the latest `saldo` per account.)
**`Filtros.cuenta` came back on 2026-09-25**, alongside the "Per-card tabs" feature below: a "Cuenta:"
pill row in `VistaResumen.tsx` (shown whenever `cuentasConocidas.length > 1`, i.e. in Resumen but not
inside a single account's own tab) gives it a new UI entry point, letting Resumen cross-filter down
to one account without switching tabs. This note was originally left stale after that change — if a
future pass finds `Filtros.cuenta` "unreachable" again, check the "Cuenta:" pill row in
`VistaResumen.tsx` before assuming it's dead code to remove. `TendenciaSaldoChart` itself is still
gone; only the filter dimension returned, through a different UI surface.

Chart colors/specs follow this repo's `dataviz` skill: the categorical palette (blue for ingresos
and magnitude comparisons, orange for gastos) is validated with the skill's `validate_palette.js`
script against CVD and contrast in both light and dark mode before use; category-magnitude
comparisons (gasto por categoría, gasto por comercio) deliberately use a single hue, not
categorical colors, since the axis labels already carry identity. `--series-3`/`--series-4`
(aqua/yellow, palette slots 3–4) were re-added 2026-10-03 for the "Tarjetas de crédito" tab, where
the cards *are* the series — don't add further palette entries speculatively; add (and validate)
them only alongside a chart that needs them.
CSS custom properties for the palette live in `src/index.css`, keyed by role (`--series-1`,
`--text-secondary`, etc.) and redefined for dark via both `prefers-color-scheme` and a
`[data-theme]` override — same pattern artifacts use. If you add a chart, re-run the dataviz
skill's procedure (form → color → validate) rather than picking colors by eye.

**Data loading & writes (reworked 2026-10-08 for latency)**: `Dashboard` holds
`DatosTransacciones` = the raw `transacciones` rows (foreign keys only:
`categoria_id`/`evento_id`/`documento_id`) **plus** `Catalogos` (categorias, eventos, documentos
with their cuenta + banco, fetched separately in parallel), and derives the nested `Transaccion[]`
the rest of the app uses with `armarTransacciones` (same shape PostgREST used to return when the
relations were nested per row — that nesting repeated the same alias/bank JSON thousands of times
and was most of the payload; now every row of a document shares one object). Every list goes
through `obtenerTodasLasPaginas` (also used by `obtenerGastosCorreo`): `.range()` ordered by a
total key (`fecha` **and `id`** — ordering by date alone isn't stable for same-day rows, so offset
paging could return a row twice and skip another at a page boundary), first page with
`count: "estimated"` (cheap, unlike a full `COUNT(*)`), the estimated remaining pages in
parallel, then one at a time while the last page came back full (the estimate can be short).
**After an edit, only the edited rows are re-fetched**: `onActualizado(ids)` →
`recargarTransacciones(ids)` re-reads the catalogs (a new categoría/evento or a document moved to
another cuenta lives there) + those ids, and `reemplazarFilas` swaps them in; `onActualizado()`
without ids reloads everything. A failed reload never unmounts the dashboard: it shows a
"Los cambios se guardaron, pero no se pudo recargar la vista … Reintentar" banner (only the
*initial* load failing shows the full-page error). Errors from PostgREST are wrapped into real
`Error`s (`comoError`) so callers can show their message. Bulk updates
(`actualizarCategoriaComercioYEvento`, `quitarEventoDeTransacciones`,
`actualizarCuentaDeDocumentos`) send ids in batches of 150 (`enLotes`) because `.in("id", ids)`
goes in the URL and hundreds of UUIDs exceeded the server's URL limit; `porLotes` sends up to
`LOTES_EN_PARALELO` = 4 batches at a time. Tabs other than Resumen/per-account are `React.lazy`
(own chunks, downloaded when first opened; `cargarPestana` reloads the page ONCE if a chunk fails
to load — after a deploy Cloudflare no longer serves the previous version's files, so a dashboard
left open would otherwise break on the next tab click; checked by 404-ing a chunk in Playwright)
and Recharts is its own `recharts` chunk
(`manualChunks` in `vite.config.ts`) so it stays cached across deploys. Number/date formatters
live once in `src/lib/formato.ts` (`moneda`, `monedaConCentavos`, `compacto`, `porcentaje`,
`decimal`, `fechaCorta`) — don't re-create `Intl.NumberFormat` per component. `Dashboard` memoizes the
default-hidden categories and the per-account transaction lists so their identity is stable across
renders — `VistaResumen` memoizes every calculation on those references. `EventosTab`'s own filters
are local component state (unlike the per-tab `EstadoVista`), so they reset when leaving that tab.

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
for clearing a field to null, only reassigning it), and `actualizarCategoriaComercioYEvento` in
`queries.ts` applies it via `supabase.from("transacciones").update(...).in("id", ids)`. This
relies entirely on the existing RLS `update` policy — same authenticated session as every read,
no new credentials, no service_role, no new migration needed. `categoria` is a special case
because `transacciones.categoria_id` is a FK, not free text: `buscarOCrearId("categorias" |
"eventos", nombre)` does the find-or-create as ONE upsert on the unique `(user_id, nombre)`
(`onConflict: "user_id,nombre"`, `user_id` from its `auth.uid()` default; race-free, one round
trip — it used to be select-then-insert, same as `sync/sincronizador.py`) so typing
a brand-new category name from the browser creates it in `categorias` on the fly, same as the
desktop app does locally. Category/comercio autocomplete suggestions come from
`Array.from(new Set(transacciones.map(...)))` over the already-loaded transacciones — no extra
Supabase query for that. After a successful edit, `Dashboard` re-reads the edited rows (and the
catalogs) from Supabase rather than patching local state by hand, so what's on screen is what
Supabase actually has — see "Data loading & writes".

**Account changes made here are not durable either**: since 2026-10-09 re-syncing a document
moves it back to the account in its JSON (see `_buscar_o_crear_documento` under Sincronizador).

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

Tables: `bancos` (shared catalog, no `user_id`) and `cuentas`/`categorias`/`documentos`/
`transacciones`/`eventos`/`gastos_correo` (all RLS-scoped to the row's `user_id`, four policies
each — select/insert/update/delete; `gastos_correo` is described under the Gmail tab above). `eventos` (added in `20260922010000_add_eventos.sql`) is a per-user
catalog like `categorias` (find-or-create by `nombre`, unique per user) referenced by
`transacciones.evento_id`; events are assigned from the frontend only (Eventos tab / bulk editor),
never by the desktop pipeline, and the sync upsert doesn't send `evento_id`, so re-syncing a
document keeps its events. `bancos` had **no RLS** until `20260926120000_bancos_rls.sql`: with RLS
off, the `anon` role (whose key ships in the frontend bundle) could insert/rename/delete banks
through the REST API without logging in. Now authenticated users may select and insert (what the
frontend's nested read and the sync's find-or-create need) and nobody may update/delete via the
API. Known, accepted gap for a single-user app: the insert/update policies only check `user_id =
auth.uid()` on the row itself, not that the referenced `documento_id`/`categoria_id`/`evento_id`/
`cuenta_id` belong to the same user. **Policies are written `user_id = (select auth.uid())`**, not
`user_id = auth.uid()` (`20261008120000_rls_auth_uid_initplan.sql` altered all 24 in place): the
subselect is evaluated once per query (an InitPlan) instead of potentially once per row, which
matters for the dashboard's full-history reads — Supabase's advisor flags the bare form as
`auth_rls_initplan`. Write any new policy the same way. Checked by applying every migration to a
throwaway local Postgres 16 with a stub `auth.uid()`: plan shows the InitPlan, RLS still isolates
users, and the frontend's `categorias` upsert on `(user_id, nombre)` works under it.
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
  **Per-run cache + batched categories (2026-10-08)**: `sincronizar_todos` shares a `CacheIds`
  dict across the documents of one run, so banco and cuenta ids are looked up once (dozens of
  statements of the same card used to repeat the same selects), and categories go through
  `_ids_de_categorias`: one `select(...).in_("nombre", [...])` for the names not yet cached and one
  `insert([...])` with the missing ones — it used to be a select (and maybe an insert) per category
  per document; `forzar_todos` over the whole history was hundreds of round trips. postgrest-py's
  `in_` quotes names with commas/parentheses (checked against the installed library). The cache
  lives only for one run.
  **`cuentas` is the one exception to "insert only if missing" (2026-10-02,
  `_buscar_o_crear_cuenta`)**: it finds by `(banco, últimos 4)`, but if the row exists with a
  *different* `alias` it updates the alias to the document's (last synced wins). The alias is what
  groups the dashboard's per-card tabs, so fixing how a card type is detected (e.g. "TDC Mensual"
  → "TDC Platino") must be able to rename accounts that already exist — before, the only way was
  editing Supabase by hand. Side effect to know: re-syncing an old document with a *different*
  alias typed in the app renames that account too.
  **`documentos` follows the same rule (user's decision, 2026-10-09, `_buscar_o_crear_documento`)**:
  found by `hash`, but if it already exists under a *different* `cuenta_id` it is moved to the
  JSON's account — so fixing the last 4 digits (or bank) of an already-synced statement in the app
  and re-syncing reassigns it (transactions keep their ids; no duplicates). Before, the document
  stayed on the old account forever. Side effect: re-syncing a JSON undoes a "cambiar cuenta" made
  in the dashboard's bulk editor for that document (same last-synced-wins as categories).
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
  content hash (sha256 of the raw JSON bytes, via `huella` in `sync/estado_incremental.py`, shared
  with the gastos_correo upload) matches what it was the last
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
- **Robustness** (2026-09-26): reading/parsing each JSON happens inside the per-file `try`, so a
  corrupt or half-written file is reported as that file's failure and the rest still sync (before,
  one unreadable JSON aborted the whole run); `_estado_sync.json` is written in a `finally`, so
  files that did sync stay recorded even if the loop is cut short.
- **Stale rows are never deleted (user's explicit decision, 2026-09-26)**: `sincronizar_documento`
  only inserts/updates. If a re-processed document no longer contains a row (a parser fix changed
  a `linea_cruda`, a line is no longer extracted, a manual row wasn't re-added), the old row stays
  in Supabase alongside the new one — a duplicate that inflates totals. The user chose not to add
  deletion; if duplicates show up after reprocessing a statement, they have to be removed by hand
  (Supabase Table Editor, filtering by `documento_id`).
- **`documentos.ruta_local`** receives the full local path of the moved PDF
  (`ruta_pdf_original` in the JSON), which can include the OS user name — by design of the original
  schema, but worth knowing since it's the only local path that leaves the laptop.
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
  unsupported) that `leer_estado_de_cuenta` (`app/logica.py`) calls to pre-fill those fields automatically when a parser
  implements it — `BanamexParser` does, reading "Cuenta <Tipo>" and "Número de cuenta de
  cheques <N>" off the cover page (page 1). **Hard rule for any implementation**: the full
  account number must never be stored in any variable, log, or return value beyond the `[-4:]`
  slice — take the last 4 digits and let the rest go out of scope immediately. Auto-fill always
  stays user-editable; the app labels it as "verify before saving," never silently trusted.
  `App._al_leer_pdf` **clears both fields on every load** before filling in whatever was detected
  (2026-09-26): previously, loading a PDF whose account wasn't detected kept the *previous* PDF's
  alias/last-4 in the fields, so "Guardar" would silently attach the statement to the wrong account.
- `monto`/`saldo` travel through the exported JSON and into the Supabase payload as decimal
  strings ("199.00"), never Python floats — Postgres casts them to `numeric` server-side.

## CI/CD

Three GitHub Actions workflows, each gated by path filters so they don't fire on unrelated
commits:

- `.github/workflows/ci.yml` (added 2026-10-08) — triggers on every push (any branch) and PR
  that touches `frontend/**` or the local pipeline (listed below); job `frontend`: `tsc -b`, `npm run lint`, `npm test`. `deploy.yml` doesn't lint or test, and
  changes go straight to `main`, so this is the safety net. A second job (`python`, added the
  same day) runs `python -m unittest discover -s tests -t .` on Python 3.12 with
  `requirements.txt`; the workflow also triggers on `app/`, `parsers/`, `transform/`, `sync/`,
  `tests/` and `requirements.txt`.
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

All workflows pin action versions that run natively on Node 24 (`actions/checkout@v5`,
`actions/setup-node@v5`, `actions/setup-python@v6`, `supabase/setup-cli@v3`,
`cloudflare/wrangler-action@v4`) — when bumping
any GitHub Action in this repo, check its `action.yml` `runs.using` value to avoid reintroducing
the Node 20 deprecation warning.

Account-side setup (Cloudflare tokens, Supabase tokens, GitHub secrets) is documented in
[README.md](README.md) — that's manual, one-time, and outside the code.

## Tests

`tests/` (stdlib `unittest`, no extra dependency; added 2026-09-26; 113 tests as of 2026-10-08,
also run by CI) — one file per module:

- `test_transformador.py` — signed amounts, deterministic duplicate-line suffixes, total validation.
- `test_categorizador.py` — first-match rules, `inferir_categoria_comercio` (rules → same
  description → substring incl. `linea_cruda`).
- `test_sincronizador.py` — against an in-memory fake Supabase client: corrupt JSON doesn't abort
  the run, unchanged files are skipped, re-sync is idempotent (the fake raises Postgres' error 21000
  on duplicate upsert keys), alias rename, a document moving to its corrected account (and no
  update when it's already right), and the per-run id cache / batched categories (counts the
  calls per table).
- `test_gastos_correo.py` — gastos_correo upload: Decimal amounts, validation, incremental state,
  batching days into calls, a failing call marks all its days, duplicated message ids.
- `test_gmail_gastos.py` — Gmail notice parsing, debit notices, quota/permission errors, the
  `revisar_gmail` flow with fake Gmail and Supabase (2 tests skip without the Google libraries).
- `test_banamex.py` — checking-account parser warnings.
- `test_banamex_tdc.py` — tier detection (name / last 4), courtesy-line rewrite, 2024 format.
- `test_invex_tdc.py` — V1 sign convention, V2 "CR" convention, card sections/roles, detection vs.
  Banamex TDC, and that detection + account info open the PDF once (`parsers/comun.py` cache).
- `test_glifos.py` — glyph decoding of image-rendered rows.
- `test_sugerencias_ia.py` — Claude rule proposals: prompt, parsing a fenced/wrapped answer, unacceptable proposals, CLI errors (fake `subprocess.run`).
- `test_logica_app.py` — `app/logica.py`: reading a PDF with a fake parser (detection, ambiguity,
  extractor error, suggestions, manual rows/categories recovered, cache forgotten), moving to
  `procesados/`.

Run from the repo root (needs `requirements.txt` installed, for pdfplumber):

```
python -m unittest discover -s tests -t .
```

Real PDFs can't be fixtures (they never leave the laptop), so parser tests feed synthetic
`(pagina, linea)` tuples to `_procesar_documento` or a fake `pdfplumber.open`. The Tkinter
windows have no automated tests (CI has no display); their logic lives in `app/logica.py`, which
does. To check the real window, run it under Xvfb (see "`app/` layout" above).

**Desktop thresholds and rules (constants)** that change behavior and were only in the code:

| Constant (file) | Value | Rule |
|---|---|---|
| `CATEGORIA_DISPOSICION_EFECTIVO` (app/main.py) | "Disposición de efectivo" | cargos of this category go to the "Disposición de efectivo" total, not "Cargos" — must match the rule's category exactly |
| `PREFIJO_RENGLON_MANUAL` (app/logica.py) | "(manual) " | marks typed rows; recovered on reload |
| `PAGINAS_INICIALES` (parsers/comun.py) | 3 | pages read for bank detection / account info |
| `MAXIMO_POR_LLAMADA` (sync/gastos_correo.py) | 500 | rows per gastos_correo upsert |
| `LOTE_GUARDADO` (sync/gmail_gastos.py) | 50 | Gmail messages read before saving to disk |
| `CIUDADES_CONFIRMADAS` (sync/gmail_gastos.py) | MCA→McAllen, APO→Apodaca | built-in city codes; the rest come from the gitignored `ciudades.json` |
| `MAXIMO_GLIFOS_SUELTOS` / `DISTANCIA_MAXIMA_SUELTOS` (parsers/glifos.py) | 3 / 6.0 pt | a group of ≤3 glyph boxes within 6 pt is merged into the nearest row ("$", ",", "-") |
| `MINIMO_CARACTERES_COINCIDENCIA_PARCIAL` (transform/categorizador.py) | 3 | min typed chars for substring inference in the manual-row dialog |

**Frontend** (added 2026-10-08): Vitest (dev dependency only), `cd frontend && npm test`;
`vitest.config.ts` fills in fake `VITE_SUPABASE_*` because `supabase.ts` throws without them —
no test touches the network (network helpers like `obtenerTodasLasPaginas` take the query as a
parameter). Tests live next to their module as `src/lib/*.test.ts`, with a `transaccion()` factory
in `src/test/fabrica.ts`: `queries` (agruparPor, cross-filter exclusion, month gap filling,
armarTransacciones/reemplazarFilas, paging with short/over estimates and error wrapping),
`indicadores` (resolverPeriodo incl. year crossing, rangoDeAnio, default-hidden categories,
ladoDominante, gasto hormiga), `alertas` (duplicates, $0 echo lines, price change incl. the >50%
and several-charges-a-month cases, new subscription), `gastosEstadoCuenta` (only TDC cargos of
non-hidden categories add up; sinSumar reasons; day order; esTarjetaCredito) and `tecnico`
(SMA, RSI edges). `npx tsc -b` and `npm run lint` are the other checks; CI runs all three.

**Dashboard thresholds and rules (constants)** — the numbers that decide what the user sees,
in one place (change the constant, not a copy of it):

| Constant (file) | Value | Rule |
|---|---|---|
| `UMBRAL_GASTO_HORMIGA` (indicadores.ts) | 200 | cargo < $200 = gasto hormiga |
| `VENTANA_RECURRENTES` / `MESES_MINIMOS_RECURRENTE` (indicadores.ts) | 6 / 3 | recurring = comercio in ≥3 of the 6 months ending at the period |
| `MESES_PERIODO_POR_DEFECTO` (indicadores.ts) | 3 | default period = last 3 complete months |
| `PATRON_EXCLUIDA_POR_DEFECTO` (indicadores.ts) | `pago tdc\|entre cuentas\|traspaso` | categories hidden by default |
| `TOPE_SANKEY_INGRESOS` / `TOPE_SANKEY_GASTOS` (indicadores.ts) | 5 / 8 | Sankey nodes before folding |
| `TOLERANCIA_MONTO_FIJO` (alertas.ts) | 2% | two charges count as "the same price" |
| `CAMBIO_PRECIO_MINIMO` / `_PESOS` / `_MAXIMO` (alertas.ts) | 3% and $10 / 50% | price-change alert bounds |
| `MESES_SUSCRIPCION_NUEVA` (alertas.ts) | 3 | "new" subscription window |
| `MULTIPLO_INUSUAL` / `MONTO_MINIMO_INUSUAL` / `HISTORIAL_MINIMO_INUSUAL` / `TOPE_CARGOS_INUSUALES` (alertas.ts) | 3× / $1,000 / 6 / 3 | unusual-charge alert |
| `ALERTAS_VISIBLES` (AlertasPanel.tsx) | 4 | alerts shown before "Ver N más" |
| `TOPE_CATEGORIAS_TARJETAS` (tarjetas.ts) | 8 | categories in the per-card chart before "Otras" |
| `DIAS_ESTADO_ATRASADO` (GastosEstadoCuentaTab.tsx) | 45 | ⚠ on "Datos hasta" |
| `TAMANO_PAGINA` / `TAMANO_LOTE_IDS` / `LOTES_EN_PARALELO` (queries.ts) | 1000 / 150 / 4 | paging and write batches |

## Working locally with Supabase CLI

No global install — invoke it via `npx supabase <command>` (e.g. `npx supabase db push --dry-run`
to preview pending migrations against the linked project).

## Implementation status & working style

The original spec asks to implement phases sequentially and pause for review before starting the
next one (see "Fases sugeridas de implementación" in `prompt-claude-code.md`). Follow that unless
the user directs otherwise — as happened with phase 6 (CI/CD), which was pulled forward ahead of
phases 2-5 at the user's explicit request.

**Shipping changes** (user's standing instruction, 2026-09-25): once a change is validated (typecheck/
build/tests pass), merge it straight into `main` (which auto-deploys) without asking for confirmation
each time.

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
