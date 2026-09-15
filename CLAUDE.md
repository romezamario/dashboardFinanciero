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

That JSON is the handoff contract for the still-unbuilt Sincronizador (next phase): it must upsert
those transactions to Supabase keyed by `documento_hash`, idempotently. Failed-to-parse PDFs move
to `data/errores/` with a `.log` of what went wrong (see `App._mover_a_errores`).

When adding a real bank, register its `BaseParser` subclass in the `PARSERS` dict at the top of
`app/main.py` — that's what populates the "Banco" dropdown. Some parsers need extra context the
PDF doesn't print (e.g. `PriorityParser` needs a year, since the statement only prints "DD MES"
per row) — `App.cargar_pdf` tries `parser_cls(ano_estado_de_cuenta=anio)` and falls back to
`parser_cls()` on `TypeError`, so a parser only needs that constructor param if it actually uses it.

The app can be packaged as a standalone `.exe` via `DashboardFinanciero.spec` (PyInstaller,
`--windowed`, icon from `app/icono.ico` — see README's "Empaquetar como ejecutable"). Build deps
(pyinstaller, pillow) live in `requirements-dev.txt`, not `requirements.txt` — they're not needed
to just run `python -m app.main`. `build/` and `dist/` are gitignored; the `.spec` file is
versioned since it's the build's source of truth.

**Cloud**: Supabase (Postgres + Auth + RLS, sole remote source of truth) + Cloudflare Pages
(frontend hosting) + Cloudflare Access (network-level login gate in front of Pages, additive to
Supabase Auth, not a replacement for it).

**Frontend** (not yet built — phase 5): React + Vite + Tailwind + Recharts, talks to Supabase
directly via `supabase-js` — no backend server in between. Access control is entirely RLS-enforced.

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

## CI/CD

Two independent GitHub Actions workflows, each gated by path filters so they don't fire on
unrelated commits:

- `.github/workflows/db-migrate.yml` — triggers on `supabase/migrations/**`. Applies pending Supabase migrations.
- `.github/workflows/deploy.yml` — triggers on `frontend/**`. Builds the frontend and deploys to
  Cloudflare Pages via `wrangler pages deploy`, using secrets `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

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

- [x] Phase 1 — DB schema + RLS policies (as Supabase migrations, applied via Actions)
- [x] Phase 6 (partial) — CI/CD scaffolding for DB migrations and Cloudflare Pages deploy (the
      deploy workflow won't run meaningfully until `frontend/` exists)
- [x] Phase 2 — `BaseParser` + one documented example extractor (`parsers/base.py`, `parsers/ejemplo.py`)
- [x] Phase 3 (redesigned) — Transformer + Categorizer as libraries (`transform/`), driven by a
      Tkinter desktop app (`app/main.py`) instead of the originally-planned watcher — user's
      explicit request, see Architecture above
- [ ] Phase 4 — Sincronizador only (upserts `data/procesados/*.json` to Supabase, idempotent on
      `documento_hash`; no watcher to build — the app replaced that role)
- [ ] Phase 5 — Frontend
- [ ] Phase 6 (remainder) — Configure Cloudflare Access once the frontend is deployed
