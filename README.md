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
