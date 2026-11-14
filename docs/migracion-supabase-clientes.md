# Migración del Supabase de Ordena tu Lana a la cuenta tecnologia@ordenatulana.com

Estado: **plan, sin ejecutar** (2026-11-14). Nada de esto se corre hasta que Mario diga "adelante" y elija
el camino (A o B, abajo).

**Objetivo (Mario, 2026-11-14)**: que Ordena tu Lana quede completamente separado de lo personal de Mario
en Supabase: el proyecto de clientes (hoy `finanzas-personales`, en la cuenta personal de Mario) pasa a
una cuenta propia de la empresa, `tecnologia@ordenatulana.com`. **Ningún cliente debe notar el cambio**:
mismas contraseñas, sin cerrar sesiones, sin correos raros, sin cobros perdidos.

---

## 1. Qué toca el Supabase de clientes (inventario del repo)

| Pieza | Dónde vive | Qué depende del proyecto |
|---|---|---|
| Esquema, RLS, funciones SQL | `supabase/migrations/` → job `migrate-producto` de `db-migrate.yml` | `PRODUCTO_SUPABASE_PROJECT_ID`, `PRODUCTO_SUPABASE_DB_PASSWORD`, `PRODUCTO_SUPABASE_ACCESS_TOKEN` |
| Datos de clientes | tablas de `public` (perfiles, cuentas, documentos, transacciones, categorías, eventos, preferencias, muestras, suscripciones, bonificaciones, avisos_pago, planes, administradores, …) | — |
| Usuarios y contraseñas | `auth.users` (contraseña con bcrypt), `auth.identities`; sesiones en `auth.sessions` / `auth.refresh_tokens` | — |
| Ajustes de Auth: sitio, redirecciones, SMTP de Resend, plantillas de correo | `supabase/correos/aplicar.mjs` → `correos-producto.yml` (Management API) | `PRODUCTO_SMTP_*` + token + ref |
| Ajustes de Auth que NO están en el repo (confirmar correo, largo de contraseña, límites, etc.) | panel de Supabase | se copian a mano o por API en la opción B |
| Edge Functions de cobro (5) y sus secretos de Mercado Pago/Resend | `supabase/functions/` → `funciones-producto.yml` | token + ref |
| Webhook de Mercado Pago | panel de Mercado Pago → `https://<ref>.supabase.co/functions/v1/webhook-mercadopago` (y `?entorno=prueba` en modo prueba) | **la URL del proyecto** |
| Sitio (pruebas y ordenatulana.com) | `deploy-producto.yml`: la URL y la anon key se meten en el JavaScript al compilar | `PRODUCTO_VITE_SUPABASE_URL`, `PRODUCTO_VITE_SUPABASE_ANON_KEY` |
| Sesión guardada en el navegador del cliente | `localStorage["sb-<ref>-auth-token"]` (nombre por omisión de supabase-js) | **la ref del proyecto** |
| Mantener activo (plan gratis) | `mantener-activo.yml` | URL, anon key, ref, token |
| Verificación | `verificar-instancia-clientes.yml` + `scripts/migracion-clientes/verificar.mjs` (nuevo) | URL, anon key, ref, token |

No se usan: Storage (buckets), pg_cron, Realtime, Vault, dominio propio de Supabase. Los enlaces de los
correos de Auth apuntan a `ordenatulana.com`, no a supabase.co. El dashboard personal no se toca en
ningún caso.

---

## 2. Los dos caminos

### Opción A (recomendada): transferir solo el proyecto de clientes, sin copiar nada

Supabase deja **transferir** un proyecto a otra organización sin moverlo de servidor. La organización
actual de `finanzas-personales` también tiene el dashboard personal de Mario (confirmado por Mario,
2026-11-14), así que **no** se cambia de dueño la organización entera: `tecnologia@` crea su propia
organización `Ordena tu Lana`, invita a la cuenta personal de Mario como miembro, Mario transfiere solo el
proyecto de clientes y al final su cuenta personal sale de la organización nueva. El dashboard personal
se queda donde está, sin tocarse. Requisitos de Supabase: ser Owner de la organización de origen y al
menos miembro de la de destino; el proyecto sin integración de GitHub de Supabase ni log drains; en plan
gratis, nadie que sea Owner/Admin del destino puede pasar de 2 proyectos gratis (tecnologia@ tendrá 1, y
Mario como *Developer* no cuenta).

- **Para el cliente no cambia nada**: misma ref, misma URL, mismas llaves, mismos usuarios, contraseñas y
  sesiones, mismo webhook de Mercado Pago. Cero tiempo fuera.
- Cambia solo quién es dueño, el correo de facturación y el *access token* que usa GitHub.
- Separación lograda: la cuenta personal de Mario deja de tener acceso, y su lugar de "proyecto gratis"
  queda libre.
- Lo que NO cambia: la ref (`qlij…puqu`) y el nombre interno. El nombre visible del proyecto sí se puede
  cambiar (p. ej. `ordena-tu-lana`).

### Opción B: copiar todo a un proyecto nuevo

Solo vale la pena si Mario quiere algo que A no da: otra región, llaves nuevas, o empezar de cero con un
proyecto "limpio". Costos y riesgos:

- La URL y la anon key cambian → hay que recompilar y publicar pruebas y producción.
- El webhook de Mercado Pago hay que cambiarlo en el panel de MP (dos modos). Avisos que lleguen al
  proyecto viejo durante el cambio se pierden (MP reintenta; `verificar-suscripcion` lo recupera al abrir
  Mi cuenta).
- **Sesiones**: supabase-js guarda la sesión bajo `sb-<ref>-auth-token`; con otra ref, todos los clientes
  aparecerían sin sesión. Se evita compilando con `auth.storageKey` = el nombre viejo, copiando
  `auth.sessions`/`auth.refresh_tokens`, y dejando que `lib/reintentoSesion.ts` renueve el token cuando el
  proyecto nuevo rechace el viejo (401 → `refreshSession()`). Hay que probarlo en un ensayo; si falla, a
  los clientes les toca volver a entrar una vez (sus contraseñas sí siguen sirviendo, porque se copia el
  hash).
- Hay una ventana de 15–30 min (de madrugada) en que las escrituras se congelan en el proyecto viejo; un
  cliente que guarde algo justo entonces vería un error. No se puede garantizar "nadie nota nada".
- Ajustes de Auth fuera del repo y la configuración de PostgREST hay que copiarlos.

**Recomendación**: A. Cumple la separación completa sin ningún riesgo para los clientes. B está
documentada abajo por si Mario la prefiere.

---

## 3. Pasos de la opción A

### A1. Crear el correo tecnologia@ordenatulana.com (Mario, 3 min)

1. Abre https://dash.cloudflare.com e inicia sesión.
2. Toca el dominio **ordenatulana.com**.
3. En el menú de la izquierda toca **Email** → **Email Routing**.
4. Toca la pestaña **Routing rules**.
5. En "Custom addresses" toca **Create address**.
6. En "Custom address" escribe `tecnologia`.
7. En "Action" deja **Send to an email**.
8. En "Destination" elige tu Gmail (el mismo que ya reciben contacto@ y hola@).
9. Toca **Save**.
10. Prueba: desde cualquier correo manda un mensaje a `tecnologia@ordenatulana.com` y revisa que llegue a
    tu Gmail (puede tardar 1–2 min; revisa también Spam).

> Ojo: Email Routing solo recibe; no puedes enviar desde tecnologia@. Para Supabase basta con recibir.

### A2. Crear la cuenta de Supabase de la empresa (Mario, 5 min)

Hazlo en una **ventana de incógnito** para no mezclarla con tu cuenta personal.

1. Abre https://supabase.com/dashboard/sign-up
2. **No** uses "Continue with GitHub" (es tu GitHub personal). Escribe el correo
   `tecnologia@ordenatulana.com` y una contraseña nueva y larga. Guárdala en tu gestor de contraseñas.
3. Toca **Sign Up**.
4. Abre tu Gmail: llega "Confirm Your Signup" de Supabase (enviado a tecnologia@). Toca **Confirm your
   mail** (ábrelo en la misma ventana de incógnito).
5. Si Supabase te pide crear una organización, créala: nombre `Ordena tu Lana`, tipo **Company**, plan
   **Free**. (Si vas por la variante de transferencia la usaremos; si no, se puede borrar después.)
6. Recomendado: activa la verificación en dos pasos: arriba a la derecha toca el ícono de tu cuenta →
   **Account preferences** → **Security** → **Add new app** (con Google Authenticator o similar).

### A3. Revisar que el proyecto se pueda transferir (Mario, 1 min)

En tu ventana normal (cuenta personal):

1. Abre https://supabase.com/dashboard/projects y entra a **finanzas-personales**.
2. Toca **Project Settings** (engrane, abajo a la izquierda) → **Integrations**.
3. Si en "GitHub Integration" dice que hay un repositorio conectado, toca **Disconnect** (nuestros
   workflows no la usan; despliegan con el token). Si no hay nada conectado, no hagas nada.
4. En **Project Settings** → **Log Drains**: debe estar vacío (no usamos ninguno).

### A4. Transferir el proyecto de clientes a la organización de la empresa (Mario, 8 min)

En la **ventana de incógnito** (cuenta tecnologia@):

1. Abre https://supabase.com/dashboard/organizations y entra a la organización **Ordena tu Lana** (la del
   paso A2.5; si no la creaste, toca **New organization**: nombre `Ordena tu Lana`, tipo **Company**,
   plan **Free**, **Create organization**).
2. Toca **Team** en el menú de la izquierda (o "Settings" → "Team").
3. Toca **Invite members** (o "Invite"). Escribe tu correo personal de Supabase, elige el rol
   **Developer** y toca **Invite**.

En tu **ventana normal** (cuenta personal):

4. Abre tu Gmail: llega la invitación de Supabase. Ábrela y toca **Join organization** / **Accept**.
5. Abre https://supabase.com/dashboard/projects → **finanzas-personales** → **Project Settings** →
   **General**.
6. Baja hasta **Transfer project** y toca **Transfer project**.
7. En la lista elige **Ordena tu Lana** y toca **Transfer**. Espera 1–2 min hasta que termine (el sitio
   sigue funcionando; Supabase solo menciona una pausa de 1–2 min al pasar de plan de pago a gratis, que
   no es nuestro caso).
8. Revisa: en https://supabase.com/dashboard/projects tu proyecto **personal** debe seguir en su
   organización de siempre, y finanzas-personales ya no.

De vuelta en la **ventana de incógnito** (tecnologia@):

9. Abre el proyecto → **Project Settings** → **General** → "Project name" → `ordena-tu-lana` → **Save**.
   (Solo es el nombre visible; la URL no cambia.)
10. Organización Ordena tu Lana → **Billing** → "Billing email" (o "Email recipient") →
    `tecnologia@ordenatulana.com` → **Save**.
11. Copia de la barra de direcciones el identificador de la organización: es lo que va después de
    `/dashboard/org/` (algo como `abcdefghijklmnopqrst`). Mándamelo o guárdalo para el paso A5.

### A5. Token nuevo para GitHub (Mario, 4 min)

En la ventana de incógnito (tecnologia@):

1. Abre https://supabase.com/dashboard/account/tokens
2. Toca **Generate new token**. Nombre: `github-actions-ordenatulana`. Si pide caducidad, elige la más
   larga o "Never". Toca **Generate token**.
3. **Copia el token** (empieza con `sbp_`). Solo se muestra una vez.

En tu ventana normal:

4. Abre https://github.com/romezamario/dashboardFinanciero/settings/secrets/actions
5. Busca **PRODUCTO_SUPABASE_ACCESS_TOKEN**, toca el lápiz (✏️ "Update"), pega el token y toca **Update
   secret**. (Si no existe, toca **New repository secret**, con ese nombre.)
6. Toca **New repository secret**. Name: `PRODUCTO_SUPABASE_ORGANIZACION`. Secret: el identificador de la
   organización del paso A4.11. Toca **Add secret**.

### A6. Verificar con la cuenta nueva (Claude)

1. Correr **Verificar instancia de clientes (Supabase)** (Actions → ese workflow → Run workflow). Debe
   salir todo ✅, incluido "Proyecto en la organización de Ordena tu Lana".
2. Correr a mano **Mantener activo Supabase**, **Funciones de cobro (Supabase de clientes)** y **Migrar
   base de datos** (comprueban que el token nuevo despliega, migra y consulta).
3. Pruebas a mano (sección 5).

### A7. Sacar a la cuenta personal (Mario, 2 min, solo cuando A6 salga bien)

1. En tu ventana normal (cuenta personal) abre la organización `Ordena tu Lana` → **Team**.
2. En tu fila toca **⋯** → **Leave team** (o desde la ventana de tecnologia@: tu fila → **Remove
   member**). Confirma.
3. **No borres** tu token personal de Supabase: `SUPABASE_ACCESS_TOKEN` lo sigue usando el dashboard
   personal (migraciones, espacios, "Mantener activo"). Solo si tenías un token aparte creado para
   Ordena tu Lana, bórralo en https://supabase.com/dashboard/account/tokens (antes pregúntame cuál es).
4. Avísame: vuelvo a correr la verificación (sección 5) y el "Mantener activo".

**Reversa de A**: la transferencia se puede deshacer igual que se hizo (transferir de vuelta a tu
organización personal mientras sigas siendo miembro de la nueva); después de A7, tecnologia@ te vuelve a
invitar primero. El proyecto, los datos y los clientes nunca se tocan, y el dashboard personal no se mueve.

---

## 4. Pasos de la opción B (solo si se elige)

Antes de ejecutar B, Claude prepara (y prueba en un ensayo) un workflow `migrar-instancia-clientes.yml`
de ejecución manual; no se escribe antes porque copia datos de clientes y debe probarse con los secretos
reales.

**B0. Preparación sin impacto (Claude)**
- `frontend/src/lib/supabase.ts`: `createClient(url, key, { auth: { storageKey } })` con
  `VITE_SUPABASE_STORAGE_KEY = "sb-<ref vieja>-auth-token"` solo en la edición producto, para que los
  navegadores sigan encontrando la sesión.
- Workflow manual que, con secretos `NUEVO_PRODUCTO_*`: aplica `supabase/migrations/` al proyecto nuevo,
  despliega las 5 Edge Functions y sus secretos, aplica `aplicar.mjs` (sitio, redirecciones, SMTP,
  plantillas) y copia los demás ajustes de Auth del proyecto viejo por la Management API (GET
  `/config/auth` → PATCH, sin secretos), y — en el paso de corte — vuelca y restaura los datos con el
  método oficial de Supabase:
  `supabase db dump --data-only --use-copy` del viejo y
  `psql --single-transaction -v ON_ERROR_STOP=1 -c 'SET session_replication_role = replica' -f data.sql`
  en el nuevo (desactiva triggers: así el trigger de perfiles no duplica filas). Se copian `public` y los
  datos de `auth` (usuarios con su hash de contraseña, identidades, sesiones, refresh tokens). El volcado
  nunca se sube como artefacto (el repo es público).

**B1. Mario**: A1 + A2, y en la cuenta tecnologia@ crea el proyecto `ordena-tu-lana` en la **misma región**
que el actual (Project Settings → General del viejo lo dice), plan Free; anota contraseña de la base; de
Project Settings → API copia URL y anon key; token como en A5. Secretos nuevos en GitHub:
`NUEVO_PRODUCTO_SUPABASE_PROJECT_ID`, `_DB_PASSWORD`, `_ACCESS_TOKEN`, `_VITE_SUPABASE_URL`,
`_VITE_SUPABASE_ANON_KEY`, y `ANTERIOR_PRODUCTO_SUPABASE_PROJECT_ID` / `_ACCESS_TOKEN` (los valores de hoy).

**B2. Ensayo (Claude)**: copia completa a un proyecto de ensayo; `verificar-instancia-clientes.yml` con
"comparar" debe dar todas las huellas iguales; un build local apuntando al ensayo con una sesión real de
prueba de Mario comprueba que la sesión sobrevive y que la contraseña sirve. Se borra el ensayo.

**B3. Corte (Claude + Mario, ~3 a. m. hora CDMX, 30 min)**
1. Congelar escrituras en el viejo (revocar insert/update/delete de `authenticated` en `public` y apagar
   el registro) — los clientes solo pueden leer durante la ventana.
2. Volcar y restaurar datos (B0). 3. Verificar con "comparar" (huellas iguales por tabla y en `auth.users`).
4. Mario cambia los `PRODUCTO_*` por los valores nuevos (o Claude renombra en el workflow).
5. Publicar pruebas, revisar, y Mario corre "Deploy Ordena tu Lana" con **produccion**.
6. Mario cambia en Mercado Pago → Tus integraciones → la app → Webhooks la URL de **producción** y la de
   **prueba** (`?entorno=prueba`) a `https://<ref nueva>.supabase.co/functions/v1/webhook-mercadopago`.
7. Verificación final (sección 5) con los sitios.

**Reversa de B**: el proyecto viejo queda intacto (solo congelado). Volver los `PRODUCTO_*` a los valores
anteriores, republicar, regresar el webhook de MP y descongelar; lo que se haya escrito en el nuevo
entretanto se copia de vuelta comparando ids. El viejo se conserva 30 días (pausado no cuenta para el
límite gratis) y luego se borra.

---

## 5. Pruebas después de la migración

**Automáticas** — Actions → **Verificar instancia de clientes (Supabase)** → Run workflow
(`scripts/migracion-clientes/verificar.mjs`, solo lee, no imprime datos ni conteos porque los logs son
públicos):

- el token de la cuenta nueva ve el proyecto, está `ACTIVE_HEALTHY` y en la organización esperada
  (`PRODUCTO_SUPABASE_ORGANIZACION`);
- todas las tablas de `public` con RLS, ninguna función SECURITY DEFINER expuesta, trigger de perfiles,
  todas las migraciones del repo aplicadas;
- las 5 Edge Functions activas, el webhook sin JWT, los secretos de MP y Resend presentes;
- Auth: `site_url` = ordenatulana.com, las 3 redirecciones, SMTP propio, confirmación de correo encendida,
  plantilla propia;
- API pública: `planes` visible con la anon key, `transacciones` vacía sin sesión, el webhook y Auth
  responden;
- ordenatulana.com y pruebas cargan JavaScript que apunta a este proyecto (y, en B, ya no al viejo);
- opción B con "comparar": huella md5 por tabla de `public`, `auth.users` (incluido el hash de contraseña)
  y `auth.identities` igual entre viejo y nuevo, mismo número de políticas y mismos ajustes de Auth.

Sus funciones puras tienen pruebas (`node --test scripts/migracion-clientes/verificar.test.mjs`, corre en
CI). Además: **Mantener activo Supabase**, **Funciones de cobro** y **Migrar base de datos** a mano deben
salir verdes.

**A mano (Mario, 10 min, en ordenatulana.com)**:
1. Si ya tenías sesión abierta, recarga: debes seguir dentro sin volver a entrar.
2. Cierra sesión y entra con tu contraseña de siempre.
3. Mi cuenta → Plan: se ve tu plan y el próximo cobro igual que antes.
4. Registra una cuenta de prueba con un correo tuyo (p. ej. un alias de Gmail `+prueba`): llega el correo
   de confirmación con la marca de Ordena tu Lana y el enlace lleva a ordenatulana.com.
5. "¿Olvidaste tu contraseña?" con esa cuenta: llega el correo y permite cambiarla.
6. Sube un estado de cuenta o captura un movimiento a mano y bórralo.
7. Borra la cuenta de prueba (Mi cuenta → Borrar mi cuenta).
8. Solo B: en Mercado Pago → Webhooks → **Simular notificación** (Planes y suscripciones) → debe responder
   200.

---

## 6. Al terminar

- Actualizar README ("Instancia de clientes": la cuenta dueña es tecnologia@), CLAUDE.md y la memoria del
  proyecto con la organización nueva.
- Otras piezas que siguen en cuentas personales y se podrían mover después con el mismo criterio (no son
  parte de este plan): Resend, Cloudflare (dominio y Pages), la app de Mercado Pago.
