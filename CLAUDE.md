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
  here — this parser trusts the printed `+`/`-` sign directly. **Best-effort, not yet verified
  against a real "-" (payment) row**: assumed `+` = cargo (compra, increases balance owed) and
  `-` = abono (pago, decreases it) — the standard reading, but flag it to the user the first time
  a real payment row appears in case it needs inverting in `extraer()`.
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
`transacciones.comercio` (added in `20260920145914_add_comercio.sql`) is a plain nullable text
column, not a catalog table with its own FK like `categoria_id` — see the `comercio` bullet in
Architecture above for why that's the deliberate choice here.

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
  columns match the table's actual unique constraint exactly.
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
