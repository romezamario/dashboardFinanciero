# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Personal finance dashboard: a local Python pipeline parses bank statement PDFs, normalizes and
categorizes transactions, and syncs only the normalized data (never the PDF or its raw text) to
Supabase, which a React frontend reads directly (protected by Row Level Security).

The full original spec — architecture, exact DB schema, folder layout, phased implementation plan —
lives in [prompt-claude-code.md](prompt-claude-code.md). Read it before making structural changes;
it's the source of truth for what to build next, **except** for the local pipeline's entry point,
which was deliberately redesigned away from that spec's automatic watcher — see Architecture below.

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
"Guardar archivo procesado" writes `data/procesados/<sha256_del_pdf>.json`.

That JSON is the handoff contract for `sync/sincronizador.py` (see its own section below): it
upserts those transactions to Supabase keyed by `documento_hash`, idempotently. Failed-to-parse
PDFs move to `data/errores/` with a `.log` of what went wrong (see `App._mover_a_errores`).

When adding a real bank, register its `BaseParser` subclass in the `PARSERS` dict at the top of
`app/main.py` — that's what populates the "Banco" dropdown, used as a manual fallback. Some
parsers need extra context the PDF doesn't print (e.g. `BanamexParser` needs a year, since the
statement only prints "DD MES" per row) — `App.cargar_pdf` tries
`parser_cls(ano_estado_de_cuenta=anio)` and falls back to `parser_cls()` on `TypeError`, so a
parser only needs that constructor param if it actually uses it.

**Auto-detection, so the user doesn't have to pick the bank manually**: `BaseParser` has two
optional hooks, both defaulting to "unsupported" so old/simple parsers (`EjemploParser`) don't
need to implement them:
- `puede_procesar(ruta_pdf) -> bool` — a cheap, conservative check (e.g. `BanamexParser` searches
  the first 3 pages' `extract_text()` for "BANAMEX", case-insensitive — the logo on page 1 is an
  image, not selectable text, so page 1 alone isn't enough; the bank name shows up reliably in
  transaction concepts like "CREDITO NOMINA BANAMEX" from page 2 on). `App._detectar_banco` tries
  every registered parser's `puede_procesar` against the loaded PDF; if exactly one matches, that
  bank is used and the dropdown is updated to show it. Zero or multiple matches fall back to
  whatever the dropdown is currently set to (ambiguity always degrades to manual, never guesses).
- `extraer_info_cuenta(ruta_pdf) -> (alias, ultimos_4) | (None, None)` — reads the account alias
  and last-4-digits off the cover page so the user doesn't retype them per statement (see the
  "Account info" bullet under Sincronizador below for the hard rule on never keeping the full
  account number in memory past the `[-4:]` slice).

Both hooks are best-effort: on no match/exception they return the "unsupported" sentinel and the
app silently falls back to whatever the user already has in the manual fields — never a hard
failure, never a silently wrong guess presented as certain.

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

Chart colors/specs follow this repo's `dataviz` skill: the categorical palette (blue/orange/aqua
for series identity — ingresos vs. gastos, one line per cuenta) is validated with the skill's
`validate_palette.js` script against CVD and contrast in both light and dark mode before use;
category-magnitude comparisons (gasto por categoría) deliberately use a single hue, not
categorical colors, since the axis labels already carry identity. CSS custom properties for the
palette live in `src/index.css`, keyed by role (`--series-1`, `--text-secondary`, etc.) and
redefined for dark via both `prefers-color-scheme` and a `[data-theme]` override — same pattern
artifacts use. If you add a chart, re-run the dataviz skill's procedure (form → color → validate)
rather than picking colors by eye.

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
  `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. A `pages project create`
  step runs first with `continue-on-error: true` — current Wrangler no longer auto-creates the
  Pages project on first deploy (it used to; that's now a hard error: "The Pages project ...
  does not exist"), so this step creates it once and then harmlessly "fails" (already exists)
  on every subsequent run.

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
