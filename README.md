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

**Pipeline local** — a diferencia del plan original (un watcher 100% automático sobre
`data/nuevos/`), el punto de entrada es una **app de escritorio (Tkinter)**: tú cargas el PDF a
mano, la app te deja revisar y corregir antes de que nada se sincronice. Esto da control y permite
validar montos contra el total real del estado de cuenta antes de confiar en el resultado.

```
Tú abres la app (python -m app.main) y cargas un PDF
      │
      ▼
Extractor (uno por banco, implementa BaseParser)
      │  renglones crudos: fecha/desc/monto en texto (monto con signo:
      │  negativo = cargo), número de página, texto completo de la línea
      ▼
Transformador (transform/transformador.py, agnóstico de banco)
      │  fechas → ISO, montos → Decimal, tipo cargo/abono por el signo,
      │  campos de auditoría (página, línea cruda)
      ▼
Categorizador (transform/categorizador.py, reglas de palabra clave editables
      │        desde la propia app — "Reglas de categorización...")
      ▼
Validación de totales EN LA APP: suma calculada vs. el total que tú
      │   escribes desde el resumen impreso en el PDF — detecta renglones
      │   faltantes o mal interpretados antes de guardar nada
      ▼
"Guardar archivo procesado" → data/procesados/<hash>.json
      │   (transacciones normalizadas + categorizadas, listas para subir)
      │   y el PDF original se mueve a <carpeta-donde-estaba>/procesados/
      ▼
Sincronizador — upsert idempotente a Supabase vía supabase-py
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
transform/  # normalización al esquema canónico + categorización (reglas editables desde la app)
app/        # app de escritorio (Tkinter) — carga PDF, valida totales, categoriza, exporta
  icono.ico          # ícono del .exe (generado por generar_icono.py, versionado)
  generar_icono.py   # utilidad para regenerar/cambiar app/icono.ico
DashboardFinanciero.spec  # config del build de PyInstaller (dist/*.exe, no versionado)
sync/       # cliente de Supabase, upsert idempotente
supabase/
  migrations/  # schema + políticas de RLS, aplicadas vía GitHub Actions
frontend/   # React + Vite + TS + Tailwind + Recharts — login + dashboard, habla directo con Supabase
data/
  nuevos/       # (ya no lo usa un watcher — puedes cargar PDFs desde cualquier ruta en la app)
  procesados/   # salida de la app: <hash>.json por cada PDF revisado y guardado
  errores/      # PDFs que la app no pudo leer con el extractor elegido
```

## Estado

- [x] Fase 1 — Esquema SQL + políticas de RLS (`supabase/migrations/`, aplicadas vía Actions)
- [x] Fase 2 — `BaseParser` + extractor de ejemplo (`parsers/`)
- [x] Fase 3 (rediseñada) — Transformador + Categorizador + app de escritorio Tkinter
      (`transform/`, `app/`) — reemplaza al watcher automático que estaba planeado
- [x] Fase 4 — Sincronizador (`sync/`) — sube `data/procesados/*.json` a Supabase, upsert idempotente
- [x] Fase 5 — Frontend (`frontend/`) — login + dashboard (KPIs, ingresos vs. gastos,
      gasto por categoría, tendencia de saldo, tabla de transacciones)
- [x] Fase 6 — Deploy a Cloudflare Pages + Cloudflare Access, verificado en producción: al entrar
      al sitio pide primero login de Cloudflare Access (correo + PIN) y luego el de Supabase Auth

**Proyecto completo — las 6 fases funcionando de punta a punta en producción:**
PDF → app de escritorio (extraer/validar/categorizar) → Supabase (RLS) → dashboard en vivo,
detrás de dos capas de login (Cloudflare Access + Supabase Auth).

## Desarrollo local del pipeline (fase 2+)

```bash
python -m venv .venv
.venv/Scripts/activate   # en Windows; en macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

## Usar la app de escritorio

```powershell
.\.venv\Scripts\python.exe -m app.main
```

(Nota el `.\` al inicio — en PowerShell, una ruta relativa sin eso se interpreta como nombre de
módulo, no como archivo a ejecutar.)

Para agregar un banco nuevo, copia [parsers/ejemplo.py](parsers/ejemplo.py) a `parsers/<banco>.py`,
ajústalo (documentado paso a paso en su docstring) y regístralo en el diccionario `PARSERS` al
inicio de `app/main.py`. Antes de escribir el extractor, usa el botón **Inspeccionar PDF...**
dentro de la app para ver cómo pdfplumber lee tu PDF real, línea por línea — así diseñas el
`PATRON_RENGLON` sin adivinar. Es un botón aparte, sin relación con cargar/procesar: solo muestra
texto, no toca nada más.

Para que ese banco se detecte solo (en vez de tener que elegirlo del dropdown), sobreescribe
también `puede_procesar(ruta_pdf) -> bool` — una heurística barata y conservadora (ej. buscar el
nombre del banco en las primeras páginas, como hace `BanamexParser`). Opcional: sin ella, ese
banco solo se puede seleccionar a mano.

Flujo completo una vez que el extractor de tu banco existe:

1. Ajusta el formato de fecha si el banco lo necesita distinto al default (el dropdown de
   "Banco" es solo un respaldo manual — el siguiente paso intenta detectarlo solo).
2. **Cargar PDF...** — antes de correr nada, la app prueba cada extractor registrado contra el
   PDF (`puede_procesar`) y usa el que matchee; si ninguno o más de uno matchean, cae de vuelta a
   lo que tengas seleccionado en el dropdown. El resumen te dice si el banco quedó "detectado" o
   "manual". Luego corre el extractor + Transformador + Categorizador y llena la tabla. Si el
   extractor lo soporta (Banamex sí), también autocompleta **Alias de cuenta**, **Últimos 4
   dígitos** y **Año** leyéndolos de la portada del PDF (el campo "Año" es solo el respaldo
   manual si la detección falla — si el extractor sí lo encuentra, pisa lo que tenga escrito el
   campo, incluso si quedó desactualizado de una carga anterior). Revisa estos datos antes de
   guardar, el resumen avisa qué se detectó y qué hay que llenar a mano.
3. Revisa los renglones. Si algunos no se pudieron interpretar, la app te avisa con el detalle.
4. **Validación de totales**: escribe el neto del periodo tal como lo imprime el estado de cuenta
   (saldo actual − saldo anterior) y da **Validar** — si no cuadra, hay algo mal parseado o un
   renglón faltante antes de confiar en el resultado.
5. **Reglas de categorización...** para agregar/editar/borrar reglas — se aplican de inmediato a
   la tabla ya cargada y se guardan en `transform/reglas_categorizacion.json` (no se sube a git).
6. **Guardar archivo procesado** — escribe `data/procesados/<hash>.json` y mueve el PDF original a
   una subcarpeta `procesados/` dentro de la misma carpeta donde estaba (no la `data/procesados/`
   del proyecto, esa es para los JSON) — reutiliza esa carpeta si ya existe, y si el PDF ya está
   adentro de una carpeta `procesados/` no lo mueve de nuevo. Así vas viendo de un vistazo, en tu
   propia carpeta de descargas, cuáles estados de cuenta ya cargaste.
7. **Sincronizar a Supabase...** — sube todo lo pendiente en `data/procesados/`.

## Empaquetar como ejecutable (.exe con ícono)

Para tener un ícono de escritorio que abra la app directamente, sin terminal ni activar ningún
venv a mano:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m app.generar_icono   # solo si app/icono.ico no existe o lo quieres cambiar
.\.venv\Scripts\python.exe -m PyInstaller DashboardFinanciero.spec
```

El ejecutable queda en `dist\DashboardFinanciero.exe` (no se sube a git — son ~40 MB y se
regeneran con el comando de arriba). Para un ícono de escritorio real: clic derecho sobre
`dist\DashboardFinanciero.exe` → **Enviar a → Escritorio (crear acceso directo)**.

`DashboardFinanciero.spec` sí está versionado — ahí vive la configuración del build (nombre,
ícono, modo ventana sin consola). Si agregas una dependencia nueva al proyecto y el `.exe`
deja de arrancar (un `ModuleNotFoundError` que solo aparece empaquetado, no con `python -m app.main`),
casi siempre es un import dinámico que PyInstaller no detectó — se resuelve agregándolo a
`hiddenimports` en el `.spec`.

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

## Setup del Sincronizador (fase 4)

El Sincronizador sube tus transacciones a Supabase **como tú** (no con una clave que se salte
RLS) — necesita que exista un usuario real de Supabase Auth. Créalo a mano una sola vez (es el
mismo usuario con el que después entras al frontend):

1. En tu proyecto Supabase → **Authentication → Users → Add user → Create new user**. Usa el
   email/password que quieras usar también después para entrar al frontend.
2. Completa en tu `.env` (el mismo de arriba): `SUPABASE_EMAIL` y `SUPABASE_PASSWORD` con esas
   credenciales.
3. Instala las dependencias si no lo has hecho: `pip install -r requirements.txt`.
4. En la app, botón **"Sincronizar a Supabase..."** — sube todo lo que haya en
   `data/procesados/`. Es seguro correrlo varias veces: cada entidad se busca antes de
   insertarse, y las transacciones usan upsert sobre el mismo constraint único de la tabla
   (`documento_id, pagina, linea_cruda`), así que reintentar o repetir un archivo no duplica nada.

## Frontend (fase 5)

Dashboard de solo lectura: login con Supabase Auth (el mismo usuario del Sincronizador) y luego
todo lo que RLS deje ver a ese usuario — sin backend intermedio, `supabase-js` habla directo con
Postgres.

**Desarrollo local:**

```bash
cd frontend
npm install
cp .env.example .env   # completa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (la anon key, no la service_role)
npm run dev
```

Abre `http://localhost:5173`, inicia sesión con el usuario que creaste para el Sincronizador.

**Qué muestra:**
- KPIs: saldo actual, ingresos del mes, gastos del mes
- Ingresos vs. gastos por mes (barras agrupadas)
- Gasto por categoría (barras horizontales, top 8 + "Otros")
- Tendencia de saldo (una línea por cuenta si tienes más de una)
- Tabla de transacciones completa

Todas las consultas van sin filtrar por `user_id` explícitamente — las políticas de RLS ya
garantizan que cada usuario solo ve sus propias filas, así que el filtro nunca depende de que el
frontend "se porte bien".

Los colores, specs de las gráficas (barras redondeadas, líneas de 2px, gridlines discretas) y la
paleta categórica (azul/naranja/aqua) siguen el skill de dataviz de este proyecto — validada con
su script contra ceguera al color en modo claro y oscuro antes de usarla.

**Deploy:** automático vía [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) en cada
push a `main` que toque `frontend/` — ver "Setup de Cloudflare" abajo para los secrets que
necesita (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, ya cubiertos ahí).

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
4. El proyecto Pages (`dashboard-financiero`) se crea solo la primera vez que corre el workflow —
   hay un paso previo (`pages project create`) antes del deploy, así que no hace falta crearlo a
   mano en el dashboard. (Corrección: versiones viejas de Wrangler sí lo creaban implícitamente
   al desplegar; las actuales ya no — de ahí el paso aparte.)

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
