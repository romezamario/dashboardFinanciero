-- Cada suscripción recuerda con qué credenciales de Mercado Pago se creó
-- (decisión del dueño, 2026-10-13): pruebas.ordenatulana.pages.dev cobra con
-- las credenciales de PRUEBA y ordenatulana.com con las de PRODUCCIÓN, sobre
-- la misma base. Las funciones de cobro usan esta columna para hablarle a
-- Mercado Pago con el token correcto (cancelar, verificar, webhook). Todas las
-- suscripciones que existen hoy se hicieron en modo de prueba.
alter table suscripciones
  add column entorno text not null default 'prueba' check (entorno in ('prueba', 'produccion'));

-- Las que se creen a partir de ahora siempre dicen su entorno explícito.
alter table suscripciones alter column entorno drop default;
