# Dashboard Financiero

Dashboard personal de finanzas: parsea estados de cuenta bancarios (PDF) localmente,
normaliza y categoriza las transacciones, y sincroniza solo los datos ya normalizados
(nunca el PDF ni su texto crudo) hacia Supabase para exponerlos en un frontend web.

## Restricciones de diseño

- Los PDFs y su texto crudo nunca salen de la laptop; solo se sincronizan transacciones normalizadas.
- Montos como `Decimal`/`numeric`, nunca `float`.
- Números de cuenta enmascarados a los últimos 4 dígitos antes de sincronizar.
- Cada transacción es auditable hasta la línea exacta del PDF de origen.
- Reimportar el mismo PDF no duplica transacciones (upsert idempotente).
- Sin credenciales hardcodeadas: todo vía variables de entorno (`.env`, ignorado por git).
- Auth vía Supabase Auth (sin autenticación propia).

## Estructura

```
parsers/    # BaseParser + un extractor por banco
transform/  # normalización al esquema canónico + categorización
sync/       # cliente de Supabase, upsert idempotente
watcher/    # vigila data/nuevos/ y orquesta el pipeline
db/         # schema.sql y policies.sql (Supabase)
frontend/   # React + Vite + Tailwind + Recharts
data/
  nuevos/       # PDFs pendientes de procesar
  procesados/   # PDFs procesados con éxito
  errores/      # PDFs que fallaron algún extractor
```

## Estado

- [x] Fase 1 — Esquema SQL (`db/schema.sql`) + políticas de RLS (`db/policies.sql`)
- [ ] Fase 2 — `BaseParser` + extractor de ejemplo
- [ ] Fase 3 — Transformador + Categorizador
- [ ] Fase 4 — Watcher + Sincronizador
- [ ] Fase 5 — Frontend
- [ ] Fase 6 — Deploy (Cloudflare Pages + Access)

## Setup de Supabase (fase 1)

1. Crea un proyecto en Supabase (tier free).
2. En el SQL Editor, corre `db/schema.sql` y luego `db/policies.sql`.
3. Copia `.env.example` a `.env` y completa `SUPABASE_URL` y `SUPABASE_KEY`.

## Setup de Cloudflare (fase 6 — pasos manuales, una sola vez)

El deploy está automatizado en [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):
cada push a `main` que toque `frontend/` compila y publica a Cloudflare Pages.
Ese workflow solo empezará a correr en serio cuando exista `frontend/` (fase 5),
pero los pasos de cuenta hay que dejarlos listos antes:

### 1. Cloudflare Pages

1. Crea una cuenta de Cloudflare (tier free) si no tienes una.
2. En el dashboard → **Workers & Pages**, copia tu **Account ID** (aparece en la barra lateral derecha).
3. Ve a **My Profile → API Tokens → Create Token** → "Create Custom Token" con el permiso
   `Account · Cloudflare Pages · Edit`. Copia el token (solo se muestra una vez).
4. No hace falta crear el proyecto Pages a mano: `wrangler pages deploy` lo crea en el primer
   deploy si no existe (nombre `dashboard-financiero`, definido en el workflow).

### 2. GitHub Secrets

En el repo → **Settings → Secrets and variables → Actions → New repository secret**, agrega:

| Secret | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN` | El token del paso anterior |
| `CLOUDFLARE_ACCOUNT_ID` | El Account ID de Cloudflare |
| `VITE_SUPABASE_URL` | URL de tu proyecto Supabase (misma que en `.env`) |
| `VITE_SUPABASE_ANON_KEY` | La `anon key` pública de Supabase (protegida por RLS, no el `service_role`) |

### 3. Cloudflare Access (gate de red, capa adicional a Supabase Auth)

Esto se configura fuera del código, en el dashboard de Cloudflare Zero Trust:

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Dominio: el que te asigne Cloudflare Pages (`dashboard-financiero.pages.dev` o tu dominio propio).
3. En la política de acceso, restringe por tu email (o el método de login que prefieras: One-Time PIN, Google, etc.).
4. Guarda. A partir de ahí, cualquier visita al sitio pide login de Cloudflare Access antes de llegar
   siquiera a la pantalla de login de Supabase Auth.
