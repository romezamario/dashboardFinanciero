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

## Arquitectura

**Pipeline local** (corre en tu laptop, disparado por un watcher sobre `data/nuevos/`):

```
PDF nuevo en data/nuevos/
      │
      ▼
  Watcher ──detecta el archivo──▶ Extractor (uno por banco, implementa BaseParser)
                                        │  renglones crudos: fecha/desc/monto en texto,
                                        │  número de página, texto completo de la línea
                                        ▼
                                  Transformador (agnóstico de banco)
                                        │  fechas → ISO, montos → Decimal, tipo cargo/abono,
                                        │  cuentas enmascaradas, campos de auditoría
                                        ▼
                                  Categorizador (reglas de palabra clave, configurables)
                                        ▼
                                  Sincronizador (upsert idempotente vía supabase-py)
                                        │
                                        ▼
                              data/procesados/ (éxito) o data/errores/ (falló algún extractor)
```

Solo las transacciones ya normalizadas cruzan a la nube — el PDF y su texto crudo nunca salen
de la laptop (la única excepción es la línea de auditoría ya enmascarada, `linea_cruda`, que sí
se sincroniza porque es lo que permite rastrear cada transacción hasta su origen).

**Nube**: Supabase (Postgres + Auth + RLS) es la única fuente de verdad remota. El frontend
(React + Vite, fase 5) le habla directo vía `supabase-js` — no hay backend intermedio. Cloudflare
Pages lo hostea; Cloudflare Access agrega un login a nivel de red *delante* de Cloudflare Pages,
como capa extra antes de siquiera llegar a la pantalla de login de Supabase Auth.

## Modelo de datos

Cinco tablas en Supabase (definidas en `supabase/migrations/`):

- **`bancos`** — catálogo compartido (ej. "BBVA", "Santander"), sin `user_id`, sin RLS: es
  información pública, no datos personales.
- **`cuentas`** — tus cuentas bancarias, identificadas solo por alias + últimos 4 dígitos.
- **`categorias`** — categorías de gasto/ingreso, definidas por ti (reglas en el Categorizador).
- **`documentos`** — un registro por PDF procesado (hash para detectar duplicados, periodo, ruta local).
- **`transacciones`** — cada movimiento, con su categoría, monto (`numeric`, nunca float),
  y los campos de auditoría (`pagina`, `linea_cruda`) que lo atan a su línea exacta de origen.

Las últimas cuatro tienen Row Level Security: cada política restringe select/insert/update/delete
a `user_id = auth.uid()`, así que aunque el frontend hable directo con Postgres, cada usuario solo
puede ver y tocar sus propios datos.

## CI/CD

Dos pipelines de GitHub Actions, cada uno disparado solo por los archivos que le corresponden:

- **`db-migrate.yml`** — cuando cambia algo en `supabase/migrations/`, aplica esas migraciones
  al proyecto remoto. El esquema de la base de datos se versiona como código: todo cambio es un
  archivo de migración nuevo, nunca un `ALTER TABLE` manual en el dashboard de Supabase.
- **`deploy.yml`** — cuando cambia algo en `frontend/`, compila y publica el sitio a Cloudflare Pages.

Cada uno solo corre cuando le toca, así que trabajar en el pipeline local (parsers/transform/sync)
no dispara ninguno de los dos.

## Estructura

```
parsers/    # BaseParser + un extractor por banco
transform/  # normalización al esquema canónico + categorización
sync/       # cliente de Supabase, upsert idempotente
watcher/    # vigila data/nuevos/ y orquesta el pipeline
supabase/
  migrations/  # schema + políticas de RLS, aplicadas vía GitHub Actions
frontend/   # React + Vite + Tailwind + Recharts
data/
  nuevos/       # PDFs pendientes de procesar
  procesados/   # PDFs procesados con éxito
  errores/      # PDFs que fallaron algún extractor
```

## Estado

- [x] Fase 1 — Esquema SQL + políticas de RLS (`supabase/migrations/`, aplicadas vía Actions)
- [ ] Fase 2 — `BaseParser` + extractor de ejemplo
- [ ] Fase 3 — Transformador + Categorizador
- [ ] Fase 4 — Watcher + Sincronizador
- [ ] Fase 5 — Frontend
- [ ] Fase 6 — Deploy (Cloudflare Pages + Access)

## Setup de Supabase (fase 1)

Las migraciones (`supabase/migrations/`) se aplican automáticamente desde
[`.github/workflows/db-migrate.yml`](.github/workflows/db-migrate.yml) en cada push a `main`
que las toque — no se corren a mano en el SQL Editor. Pasos de cuenta, una sola vez:

1. Crea un proyecto en Supabase (tier free). Guarda la contraseña de la base de datos que
   definas al crearlo — la vas a necesitar para el secret `SUPABASE_DB_PASSWORD`.
2. **Project ref**: en **Settings → General**, copia el "Reference ID".
3. **Access token**: en tu cuenta de Supabase → **Account → Access Tokens → Generate new token**
   (token personal, no es el `anon key` ni el `service_role`).
4. En GitHub → **Settings → Secrets and variables → Actions**, agrega:

   | Secret | Valor |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | El access token del paso 3 |
   | `SUPABASE_PROJECT_ID` | El Reference ID del paso 2 |
   | `SUPABASE_DB_PASSWORD` | La contraseña de la base de datos del paso 1 |

5. Con eso configurado, el primer push a `main` que toque `supabase/migrations/` corre el
   workflow y aplica `schema` + `policies` contra tu proyecto remoto.
6. Para desarrollo local del pipeline (parsers/transform/sync), copia `.env.example` a `.env`
   y completa `SUPABASE_URL` (Settings → API → Project URL) y `SUPABASE_KEY` (la `anon key`
   de esa misma página).

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

Estos dos últimos son los mismos valores que `SUPABASE_URL`/`SUPABASE_KEY` de tu `.env` local
(fase 1) — la `anon key`, nunca el `service_role`.

### 3. Cloudflare Access (gate de red, capa adicional a Supabase Auth)

Esto se configura fuera del código, en el dashboard de Cloudflare Zero Trust:

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Dominio: el que te asigne Cloudflare Pages (`dashboard-financiero.pages.dev` o tu dominio propio).
3. En la política de acceso, restringe por tu email (o el método de login que prefieras: One-Time PIN, Google, etc.).
4. Guarda. A partir de ahí, cualquier visita al sitio pide login de Cloudflare Access antes de llegar
   siquiera a la pantalla de login de Supabase Auth.
