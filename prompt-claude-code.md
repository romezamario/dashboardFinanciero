# Prompt para Claude Code

Copia todo lo de abajo como el prompt inicial en Claude Code, dentro de la carpeta del repo (el zip que ya tienes de `estados-cuenta-dashboard`).

---

Vas a implementar un dashboard personal de finanzas que parsea mis estados de cuenta bancarios (PDF), los normaliza, categoriza y expone indicadores financieros en un dashboard accesible desde internet. Ya diseñamos la arquitectura completa — impleméntala tal cual, y si algo no está claro, pregúntame antes de improvisar.

## Restricciones no negociables

- Los PDFs completos y su texto crudo **nunca** salen de mi laptop. Solo se sincronizan transacciones ya normalizadas hacia la nube.
- Todo el stack debe caber en tiers gratuitos: Supabase free, Cloudflare Pages free, Cloudflare Access free. Presupuesto: $0.
- Los montos se manejan como `Decimal`/`numeric`, nunca `float`.
- Los números de cuenta se enmascaran a los últimos 4 dígitos antes de que cualquier dato salga de la laptop.
- Cada transacción debe ser auditable hasta la línea exacta del PDF de origen (página + texto crudo de esa línea, ya enmascarado).
- Reimportar el mismo PDF nunca debe duplicar transacciones.
- No hardcodees credenciales de Supabase — usa variables de entorno (`.env`, y agrégalo a `.gitignore`).
- No implementes autenticación propia — usa Supabase Auth.

## Arquitectura

### Local (mi laptop) — pipeline secuencial disparado por un watcher

1. **Watcher** — vigila una carpeta (`data/nuevos/`) y dispara el pipeline cuando llega un PDF nuevo.
2. **Extractor (uno por banco)** — implementa una interfaz común `BaseParser`. Lee el PDF de un banco específico y devuelve renglones crudos: fecha en texto, descripción en texto, monto en texto, número de página, texto completo de la línea.
3. **Transformador** (compartido, agnóstico de banco) — convierte los renglones crudos al esquema canónico: parsea fechas a ISO, montos a `Decimal`, determina tipo (cargo/abono), enmascara cuentas, arma los campos de auditoría (`documento_hash`, `pagina`, `linea_cruda`).
4. **Categorizador** — asigna categoría por reglas de palabra clave sobre la descripción ya normalizada. Reglas configurables, no hardcodeadas en el flujo.
5. **Sincronizador** — sube las transacciones normalizadas a Supabase vía su cliente, con upsert idempotente basado en el constraint único de la tabla.

Al terminar de procesar un PDF, muévelo a `data/procesados/` si tuvo éxito o a `data/errores/` si falló algún extractor, y deja un log legible de qué pasó.

### Nube (gratis)

- **Supabase**: Postgres + Auth + Row Level Security. Única fuente de verdad remota.
- **Cloudflare Pages**: hosting del frontend, deploy automático desde este repo de GitHub.
- **Cloudflare Access**: gate de login a nivel de red frente a Cloudflare Pages, como capa adicional a Supabase Auth (no reemplaza a Supabase Auth, la complementa).

## Esquema de base de datos (Supabase / Postgres)

Usa este esquema exactamente como está, incluyendo los constraints:

```sql
create table bancos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

create table cuentas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  banco_id uuid not null references bancos(id),
  alias text not null,
  ultimos_4_digitos text,
  creado_en timestamptz not null default now(),
  unique (user_id, banco_id, ultimos_4_digitos)
);

create table categorias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  nombre text not null,
  unique (user_id, nombre)
);

create table documentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  cuenta_id uuid not null references cuentas(id),
  hash text not null,
  periodo_inicio date,
  periodo_fin date,
  ruta_local text,
  procesado_en timestamptz not null default now(),
  unique (user_id, hash)
);

create table transacciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  documento_id uuid not null references documentos(id),
  categoria_id uuid references categorias(id),
  fecha date not null,
  descripcion text not null,
  monto numeric(12,2) not null check (monto >= 0),
  tipo text not null check (tipo in ('cargo','abono')),
  moneda text not null default 'MXN',
  saldo numeric(12,2),
  pagina integer not null,
  linea_cruda text not null,
  creado_en timestamptz not null default now(),
  unique (documento_id, pagina, linea_cruda)
);

create index idx_transacciones_fecha on transacciones (user_id, fecha);
create index idx_transacciones_categoria on transacciones (user_id, categoria_id);

alter table cuentas enable row level security;
alter table categorias enable row level security;
alter table documentos enable row level security;
alter table transacciones enable row level security;
```

`bancos` es catálogo compartido, sin `user_id` ni RLS. Todas las demás tablas necesitan políticas de RLS que restrinjan cada operación (select/insert/update/delete) a filas donde `user_id = auth.uid()` — diseña esas políticas como parte de la migración inicial.

## Estructura de carpetas esperada

```
parsers/
  base.py            # BaseParser (extractor), interfaz común
  <banco>.py         # un extractor concreto por banco
transform/
  transformador.py   # normalización al esquema canónico
  categorizador.py   # reglas de categorización
sync/
  sincronizador.py   # cliente de Supabase, upsert idempotente
watcher/
  watcher.py         # vigila la carpeta y orquesta el pipeline completo
db/
  schema.sql         # el esquema de arriba
  policies.sql        # políticas de RLS
frontend/
  ...                # app de React + Vite + Tailwind + Recharts
```

## Stack tecnológico

- **Local**: Python 3.11+, `pdfplumber` para extracción de PDF, `watchdog` para vigilar la carpeta, `supabase-py` para sincronizar.
- **Frontend**: React + Vite + Tailwind CSS + Recharts, consumiendo Supabase directo vía su cliente JS (sin backend intermedio — el frontend habla directo con Supabase, protegido por RLS).
- **Auth**: Supabase Auth en el frontend; Cloudflare Access configurado a nivel de infraestructura (fuera del código de la app).

## Fases sugeridas de implementación

1. Esquema SQL en Supabase + políticas de RLS.
2. `BaseParser` (clase abstracta) + un extractor de ejemplo/plantilla documentado, listo para copiar por banco.
3. Transformador + Categorizador, con reglas de categorización en un archivo separado y fácil de editar.
4. Watcher + Sincronizador, con manejo de errores y logs legibles.
5. Frontend: login con Supabase Auth, vistas de indicadores (ingresos vs. gastos por mes, gasto por categoría, tendencia de saldo, transacciones).
6. Deploy: conectar el repo a Cloudflare Pages; documentar en el README cómo configurar Cloudflare Access.

Empieza por la fase 1 y avísame cuando esté lista para revisarla antes de seguir a la 2.
