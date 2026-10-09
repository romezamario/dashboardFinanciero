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
mano, la app te deja revisar y corregir antes de que nada se sincronice.

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
Revisión EN LA APP: tabla, totales (cargos, efectivo, abonos), avisos de
      │   filas que el PDF imprime como imagen, categorías a mano
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

Tablas en Supabase (definidas en `supabase/migrations/`):

- **`bancos`** — catálogo compartido (ej. "BBVA", "Santander"), sin `user_id`. Los usuarios con
  sesión pueden leer y agregar bancos, nadie puede modificarlos ni borrarlos por la API.
- **`cuentas`** — tus cuentas bancarias, identificadas solo por alias + últimos 4 dígitos.
- **`categorias`** — categorías de gasto/ingreso, definidas por ti (reglas en el Categorizador).
- **`documentos`** — un registro por PDF procesado (hash para detectar duplicados, periodo, ruta local).
- **`transacciones`** — cada movimiento, con su categoría, comercio, tarjeta, evento, monto
  (`numeric`, nunca float), y los campos de auditoría (`pagina`, `linea_cruda`) que lo atan a su
  línea exacta de origen.
- **`eventos`** — viajes, fiestas, etc. que asignas desde el dashboard a varias transacciones.
- **`gastos_correo`** — los cargos de los avisos de compra de Banamex por correo (ver "Gastos
  recientes" abajo), aparte de `transacciones`.

Todas menos `bancos` tienen Row Level Security: cada política restringe select/insert/update/delete
a `user_id = (select auth.uid())`, así que aunque el frontend hable directo con Postgres, cada
usuario solo puede ver y tocar sus propios datos. (El `select` alrededor de `auth.uid()` hace que
Postgres lo calcule una vez por consulta y no por fila — escribe así cualquier política nueva.)

## CI/CD

Tres pipelines de GitHub Actions, cada uno disparado solo por los archivos que le corresponden:

- **`ci.yml`** — en cada push (cualquier rama) o PR que toque `frontend/` o el pipeline local
  (`app/`, `parsers/`, `transform/`, `sync/`, `tests/`, `requirements.txt`): typecheck, lint y
  pruebas del frontend (Vitest), y las pruebas de Python. Es la red de seguridad antes de `main`,
  que despliega solo. Ver "Pruebas" abajo.

- **`db-migrate.yml`** — cuando cambia algo en `supabase/migrations/`, aplica esas migraciones
  al proyecto remoto. El esquema de la base de datos se versiona como código: todo cambio es un
  archivo de migración nuevo, nunca un `ALTER TABLE` manual en el dashboard de Supabase.
- **`deploy.yml`** — cuando cambia algo en `frontend/`, compila y publica el sitio a Cloudflare Pages.

Cada uno solo corre cuando le toca: un cambio en el pipeline local solo dispara `ci.yml`.

## Estructura

```
parsers/    # BaseParser + un extractor por banco
  comun.py           # meses, patrones y lectura (una sola vez) del texto inicial del PDF
  glifos.py          # lee las filas que el PDF imprime como imágenes de letras
transform/  # normalización al esquema canónico + categorización (reglas editables desde la app)
app/        # app de escritorio (Tkinter) — carga PDF, revisa, categoriza, exporta, sincroniza
  main.py            # ventana principal (App) y registro de bancos (PARSERS)
  logica.py          # lo que no toca la interfaz: leer un PDF, recuperar lo hecho a mano, mover archivos
  ventanas.py        # diálogos: reglas, inspeccionar PDF, renglón manual, categoría manual
  pestana_gmail.py   # pestaña "Gastos recientes (Gmail)"
  hilos.py           # correr trabajo largo en segundo plano sin congelar la ventana
  icono.ico          # ícono del .exe (generado por generar_icono.py, versionado)
  generar_icono.py   # utilidad para regenerar/cambiar app/icono.ico
DashboardFinanciero.spec  # config del build de PyInstaller (dist/*.exe, no versionado)
sync/       # Supabase: estados de cuenta (sincronizador.py), avisos de Gmail (gmail_gastos.py,
            # gastos_correo.py); estado_incremental.py = qué archivos ya se subieron
tests/      # pruebas de Python (unittest), sin PDFs reales
supabase/
  migrations/  # schema + políticas de RLS, aplicadas vía GitHub Actions
frontend/   # React + Vite + TS + Tailwind + Recharts — login + dashboard, habla directo con Supabase
  src/lib/*.test.ts  # pruebas del frontend (Vitest)
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
      gasto por categoría, gasto por comercio, tabla de transacciones)
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

## Pruebas

```bash
python -m unittest discover -s tests -t .   # pipeline local (desde la raíz, con requirements.txt instalado)
cd frontend && npm test                     # frontend (Vitest); también: npx tsc -b y npm run lint
```

Las pruebas nunca usan PDFs reales (no salen de la laptop): los extractores se prueban con texto
sintético, y la sincronización contra un Supabase falso en memoria. Las ventanas de Tkinter no
tienen pruebas automáticas, pero su lógica vive en `app/logica.py`, que sí. CI corre todo en
cada push.

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
texto, no toca nada más. Si tu banco imprime la fecha en un formato distinto a `DD/MM/AAAA`
(el default), sobreescribe `formato_fecha` (atributo de clase, formato `strptime`) en tu subclase
— no hay campo en la UI para esto, cada extractor ya sabe su propio formato porque lo necesitó
para escribir su patrón de fecha.

Para que ese banco se detecte solo (en vez de tener que elegirlo del dropdown), sobreescribe
también `puede_procesar(ruta_pdf) -> bool` — una heurística barata y conservadora. Lee el texto
con `textos_iniciales(ruta_pdf, n)` de `parsers/comun.py` (no abras el PDF otra vez: la app lo
lee una sola vez para todos los extractores y la cuenta). Ojo: el nombre
del banco solo no basta si ese banco tiene más de un tipo de documento (ver `BanamexParser` y
`BanamexTdcParser`, que distinguen cuenta de cheques vs. tarjeta de crédito por un encabezado/
término exclusivo de cada tipo de estado de cuenta, no solo por "BANAMEX"). Si agregas un segundo
producto de un banco que ya tenías, revisa que el `puede_procesar` del extractor existente siga
siendo suficientemente selectivo. La misma colisión puede pasar entre **bancos distintos** que
comparten un término genérico: `BanamexTdcParser` e `InvexTdcParser` (`parsers/invex_tdc.py`)
matcheaban ambos con solo "Pago mínimo", así que `BanamexTdcParser` tuvo que excluirse
explícitamente cuando detecta "INVEX" — revisa esto también al agregar un segundo emisor de un
mismo tipo de documento (ej. otra tarjeta de crédito). Opcional: sin esta función, ese banco solo
se puede seleccionar a mano.

Flujo completo una vez que el extractor de tu banco existe:

1. **Cargar PDF...** — antes de correr nada, la app prueba cada extractor registrado contra el
   PDF (`puede_procesar`) y usa el que matchee; si ninguno o más de uno matchean, cae de vuelta a
   lo que tengas seleccionado en el dropdown "Banco". El resumen te dice si el banco quedó
   "detectado" o "manual". Luego corre el extractor + Transformador + Categorizador y llena la
   tabla. Todo eso corre en segundo plano ("Leyendo …" en el resumen): la ventana sigue
   respondiendo aunque el PDF tarde, y los botones de cargar, guardar y sincronizar se desactivan
   mientras tanto. Si el extractor lo soporta (Banamex cuenta de cheques y Banamex TDC, tarjeta de
   crédito, ambos sí), también autocompleta **Alias de cuenta** y **Últimos 4 dígitos** leyéndolos
   de la portada del PDF, y para `BanamexParser` (cuenta de cheques, el único que necesita año
   porque el PDF no lo imprime por renglón) el resumen te avisa qué año detectó — no hay campo
   manual para corregirlo si la detección llegara a fallar, así que revisa ese aviso antes de
   guardar.
2. Revisa los renglones. Si algunos no se pudieron interpretar, la app te avisa con el detalle. A
   veces el PDF renderiza una fila (ej. una confirmación de abono destacada) como imagen en vez
   de texto seleccionable — ahí el extractor no puede leer nada y la app te avisa con el número
   de página. Usa **Agregar renglón manual...** para capturarla a mano (fecha, descripción, monto
   sin signo, tipo, y la página si la conoces) — se agrega a la tabla igual que cualquier otro
   renglón, con categoría/comercio asignados por las mismas reglas. La pestaña **Sin
   categorizar**, junto a la tabla, lista las descripciones únicas que quedaron sin categoría —
   botón "Copiar todo" para pegarlas directo en un chat con Claude y pedir una propuesta de
   reglas nuevas.
3. Compara los **totales** de abajo (cargos, disposición de efectivo, abonos) contra los que
   imprime el estado de cuenta: si no cuadran, falta un renglón o hay algo mal leído.
4. **Reglas de categorización...** para agregar/editar/borrar reglas — se aplican de inmediato a
   la tabla ya cargada y se guardan en `transform/reglas_categorizacion.json` (no se sube a git).
   Cada regla asigna una **Categoría** (obligatoria) y opcionalmente un **Comercio** (ej. patrón
   "TELEVIA" → categoría "Transporte", comercio "Televia") — útil sobre todo en tarjeta de
   crédito, donde la descripción cruda mezcla comercio y número de referencia.
5. **Guardar archivo procesado** — escribe `data/procesados/<hash>.json` y mueve el PDF original a
   una subcarpeta `procesados/` dentro de la misma carpeta donde estaba (no la `data/procesados/`
   del proyecto, esa es para los JSON) — reutiliza esa carpeta si ya existe, y si el PDF ya está
   adentro de una carpeta `procesados/` no lo mueve de nuevo. Así vas viendo de un vistazo, en tu
   propia carpeta de descargas, cuáles estados de cuenta ya cargaste.
6. **Sincronizar a Supabase...** — sube todo lo pendiente en `data/procesados/`, también en
   segundo plano ("Sincronizando…").

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
4. En la app, botón **"Sincronizar a Supabase..."** — sube los archivos nuevos o modificados de
   `data/procesados/` (compara por hash de contenido contra la última sincronización exitosa,
   guardado en `data/procesados/_estado_sync.json`, así que no vuelve a subir lo que ya estaba
   sincronizado sin cambios). Es seguro correrlo varias veces: cada entidad se busca antes de
   insertarse, y las transacciones usan upsert sobre el mismo constraint único de la tabla
   (`documento_id, pagina, linea_cruda`), así que reintentar o repetir un archivo no duplica nada.
   Banco, cuenta y categorías se buscan una sola vez por sincronización (y las categorías todas
   juntas), así que subir muchos estados de cuenta a la vez ya no hace cientos de consultas.
5. **Corregir la cuenta de un estado de cuenta ya subido**: cambia el alias o los últimos 4
   dígitos en la app, guarda y vuelve a sincronizar. Un alias distinto renombra la cuenta; otros
   últimos 4 dígitos mueven el documento (con sus transacciones) a esa cuenta. Gana lo último que
   sincronizaste: también deshace un "cambiar cuenta" hecho en el dashboard para ese documento.

## Frontend (fase 5)

Dashboard web: login con Supabase Auth (el mismo usuario del Sincronizador) y luego
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

**Cómo carga los datos:** todo el historial al entrar, en páginas de 1,000 pedidas en paralelo;
cuentas, categorías y eventos llegan aparte una sola vez (no repetidos en cada transacción).
Después de editar algo solo se vuelven a pedir las transacciones editadas. Si esa recarga falla,
aparece un aviso con **Reintentar** sin perder lo que tenías filtrado. Las pestañas que no son la
de inicio se descargan la primera vez que las abres; si el sitio se actualizó mientras lo tenías
abierto, la página se recarga sola una vez.

**Qué muestra** — una pestaña por tema; cada pestaña recuerda sus propios filtros al cambiar de
una a otra. Botón de modo claro/oscuro arriba a la derecha.

- **Resumen** — la vista principal:
  - **Periodo** ("Desde/Hasta", por meses): todo lo de la pestaña se calcula sobre él. Sin elegir
    nada son los últimos 3 meses completos (el mes en curso no cuenta: los estados de cuenta
    llegan a mes vencido). Las comparaciones son contra el periodo anterior de la misma duración.
  - **Indicadores de salud**: tasa de ahorro del periodo (y la de 12 meses como referencia),
    flujo neto, gasto mensual vs. tu promedio previo, meses cubiertos con tu saldo, gastos
    recurrentes, gasto hormiga (cargos de menos de $200) y categorías gastando más de lo normal.
  - **Gráficas**: ingresos vs. gastos por mes (13 meses, todo el historial o por años — clic en
    un mes o un año lo vuelve el periodo), flujo de dinero (Sankey: de dónde entra y en qué se
    va), ingresos y gastos por categoría y por comercio, y flujo neto mensual.
  - **Tablas**: categorías al alza (con tendencia de 12 meses), gastos recurrentes y todas las
    transacciones del periodo.
  - **Editar en lote** (ver abajo) y **alertas** al final: posibles cargos duplicados,
    suscripciones que cambiaron de precio o son nuevas, cargos inusualmente grandes para su
    categoría y cambios fuertes en la tasa de ahorro. "Ver movimientos" filtra la tabla a eso.
- **Eventos** — viajes, fiestas, etc.: cuánto gastaste en cada uno, en qué categorías y comercios,
  sus transacciones, y un buscador para asignar (o quitar) un evento a varias transacciones.
- **Categorías y Comercios** — el detalle de una categoría y/o un comercio: gasto mensual con
  promedio móvil de 3 meses (o ingreso, si lo elegido solo tiene abonos), sus movimientos más
  grandes y sus transacciones. Clic en un mes filtra lo de abajo a ese mes.
- **Tarjetas de crédito** — todas las tarjetas comparadas en el mismo periodo: cómo se reparte
  el gasto entre ellas, una tabla por tarjeta (gasto, compras, ticket promedio, cambio vs. el
  periodo anterior, pagos y abonos, categoría principal), gasto mensual por tarjeta y para qué
  usas cada una (gasto por categoría y tarjeta). "Gasto" son solo cargos; los pagos van aparte.
- **Gastos recientes** — un calendario con el gasto de cada día coloreado de verde a rojo. Dos
  fuentes: **por correo** (los avisos de compra de Banamex, llegan el mismo día) y **por estado
  de cuenta** (las transacciones sincronizadas, que llegan semanas después; solo suman los cargos
  de tarjetas de crédito). Clic en un día abre su detalle, con **Descargar Excel**; en la vista
  por estado de cuenta cada movimiento se puede editar ahí mismo.
- **Una pestaña por cada cuenta que no es tarjeta** (p. ej. la de cheques) — la misma vista
  que el Resumen, solo con esa cuenta.
- **QQQ / TQQQ** — análisis técnico (velas, medias móviles, Bollinger, soportes y resistencias
  calculados de los últimos 6 meses, RSI, MACD, comparación QQQ vs. TQQQ) y un tablero de indicadores macro de EE. UU. (Fed, inflación, empleo, tasas,
  VIX) con las fechas de los próximos datos. No usa tus finanzas; solo vive aquí para tener todo
  junto.

**Filtros por clic (estilo Power BI)**: en el Resumen y en Tarjetas de crédito, un clic en una
barra (categoría, comercio, tarjeta) o en las filas de Cuenta/Tarjeta/Evento filtra el resto de
la pestaña a eso; lo no seleccionado se atenúa. Clic otra vez lo quita, y los chips de arriba
muestran qué está activo. Cada gráfica sigue mostrando todas sus opciones (solo la filtran las
*otras* selecciones), para poder cambiar de elección. Los filtros por clic afectan el detalle del
gasto, **no** los indicadores de salud ni las alertas: una tasa de ahorro "solo de Comida" no
significa nada. "Otros" (la cola plegada de categorías) no es clicable.

**Excluir del análisis**: en el Resumen, el panel "Excluir del análisis" quita categorías o
eventos de *todo* (indicadores, gráficas, tabla). Por defecto excluye los movimientos entre tus
propias cuentas (Pago TDC, traspasos): pagar la tarjeta desde la cuenta de cheques contaría como
gasto en una y como ingreso en la otra. Es lo inverso del filtro por clic, que aísla una sola.

**Editar categoría/comercio/cuenta en lote** (Resumen y pestañas de cuenta): busca transacciones
por un texto de la descripción (ej. "TELEVIA"), selecciona una o varias (o "Seleccionar todas las
coincidencias", no solo las que se ven), y asígnales categoría, comercio y/o cuenta nuevos. Las
sugerencias salen de lo que ya existe, pero aceptan texto libre (una categoría nueva se crea al
vuelo); un campo en blanco no se toca. Cambiar la cuenta mueve el estado de cuenta completo (te
avisa cuántas transacciones son). Junto con la edición dentro de Gastos recientes y la asignación
de eventos, son las únicas escrituras del frontend, con las mismas políticas de RLS que las
lecturas. Ojo: si vuelves a cargar y sincronizar el mismo PDF desde la app de escritorio, el
upsert por `(documento_id, pagina, linea_cruda)` regresa categoría/comercio a lo que digan las
reglas, y la cuenta a la del JSON — una edición aquí no sobrevive un resync del mismo documento.
Para una corrección que sí debe persistir, agrega o ajusta una regla en "Reglas de
categorización..." en vez de (o además de) editar aquí.

Todas las consultas van sin filtrar por `user_id` explícitamente — las políticas de RLS ya
garantizan que cada usuario solo ve sus propias filas, así que el filtro nunca depende de que el
frontend "se porte bien".

Los colores, specs de las gráficas (barras redondeadas, líneas de 2px, gridlines discretas) y la
paleta categórica (azul/naranja) siguen el skill de dataviz de este proyecto — validada con
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
4. El proyecto Pages (`dashboard-financiero`) ya está creado en la cuenta. Si alguna vez lo
   borras y necesitas recrearlo: `wrangler pages deploy` (el comando que usa el workflow) ya no
   lo crea solo como en versiones viejas de Wrangler — hay que correr
   `npx wrangler pages project create dashboard-financiero --production-branch=main` a mano una
   vez (con `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` en el entorno) antes de que el deploy
   funcione de nuevo. El workflow ya no intenta crearlo automáticamente — un intento de crear un
   proyecto que ya existe es un error duro de la API de Cloudflare, no algo que se pueda
   distinguir de forma confiable en CI sin credenciales reales para probarlo primero.

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

## Gastos recientes (avisos de compra de Banamex)

La pestaña **Gastos recientes** muestra los cargos que Banamex avisa por correo, un día por
sección, con ciudad y subtotales. Vive en su propia tabla (`gastos_correo`, migración
`20261004210000_add_gastos_correo.sql`), aparte de `transacciones`: el aviso llega el mismo día y
el estado de cuenta semanas después, y mezclarlos duplicaría cargos.

Todo el flujo corre en tu computadora (la nube nunca ve tu Gmail ni tus reglas). Se usa desde la
app de escritorio, pestaña **Gastos recientes (Gmail)**:

- **Revisar Gmail y subir** lee los avisos de los últimos N días (campo "Días hacia atrás", 3 por
  defecto), los guarda en `data/gastos_correo/` y los sube a Supabase. Corre en segundo plano con
  barra de progreso; al terminar dice cuántos avisos leyó, cuántos eran nuevos y cuántos gastos subió.
- Los problemas quedan escritos en la pestaña (botón **Copiar avisos**): comercios "Sin categoría"
  (con el texto completo del establecimiento, para escribir la regla), códigos de ciudad sin
  confirmar, correos que no se pudieron leer y errores al subir. Si falta `data/gmail/credentials.json`
  o alguna variable de Supabase del `.env`, si el usuario/contraseña de Supabase no sirve, o si faltan
  las librerías de Google, lo dice en español.
- **Reautorizar Gmail...** abre el navegador para dar de nuevo el permiso de solo lectura (cuando
  vence o se revoca; la app también lo ofrece sola si detecta un permiso vencido).
- La tabla muestra los 200 gastos más recientes de `data/gastos_correo/*.json` (fecha, hora, tarjeta,
  comercio, ciudad, categoría, monto); en amarillo los que quedaron sin categoría.
- **Revisar automáticamente al abrir la app** (apagada por defecto) hace la misma revisión al
  arrancar, solo si ya autorizaste Gmail antes: nunca abre el navegador por su cuenta. Esta casilla
  y el número de días se guardan en `data/gastos_correo/preferencias.json`.

Equivale, desde la terminal, a:

```
python -m sync.gmail_gastos --dias 3 --subir
```

1. `sync/gmail_gastos.py` lee los avisos con la API de Gmail (solo lectura), los categoriza con tu
   `transform/reglas_categorizacion.json` y escribe `data/gastos_correo/AAAA-MM-DD.json`. Imprime
   los comercios "Sin categoría", los códigos de ciudad sin confirmar y los correos que no pudo leer.
2. `sync/gastos_correo.py` (con `--subir`) los sube a `gastos_correo` iniciando sesión con tu
   usuario (`SUPABASE_EMAIL`/`SUPABASE_PASSWORD` del `.env`, el mismo login que "Sincronizar a
   Supabase..."); la RLS solo le deja escribir tus propias filas. No hace falta ninguna otra clave.

Los avisos de retiro/compra con tu cuenta de cheques o Priority (débito) no traen el comercio:
no se suman como gastos ni se suben; se guardan aparte en `data/gastos_correo/debitos.json` y la
pestaña solo dice cuántos hubo y por cuánto.

Es idempotente: se puede correr todos los días (o varias veces al día) sin duplicar nada. Solo
sube los días que cambiaron desde la última subida, y los manda juntos (hasta 500 gastos por
llamada) en vez de uno por uno. Solo
descarga de Gmail los correos que todavía no están en `data/gastos_correo/`; los ya guardados se
recategorizan en tu computadora con las reglas actuales (así una regla nueva corrige también los
gastos viejos). Si Gmail limita las consultas por minuto, reintenta solo con esperas crecientes; si
aun así no alcanza, guarda lo que leyó y te pide volver a intentar en un par de minutos.
La configuración de Gmail (OAuth de escritorio) está explicada al inicio de `sync/gmail_gastos.py`.
Las ciudades confirmadas están en ese mismo archivo; agrega más en `data/gastos_correo/ciudades.json`,
por ejemplo `{"CIU": "Ciudad Apodaca"}`.
