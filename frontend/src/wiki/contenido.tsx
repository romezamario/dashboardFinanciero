import type { ReactNode } from "react";
import { B, C, DiagramaFlujo, Formula, Lista, Nota, P, Pasos, Sub, TablaWiki } from "./piezas";

// Contenido de la pestaña "Wiki": cómo está hecho el tablero, de dónde sale
// cada dato y qué reglas decide lo que se ve. Es la versión en español y para
// el usuario de CLAUDE.md / README.md: cuando cambie una regla o una pestaña,
// actualiza también la sección correspondiente aquí (ver CLAUDE.md, "Wiki").

export interface SeccionWiki {
  id: string;
  grupo: string;
  titulo: string;
  cuerpo: ReactNode;
}

export const ULTIMA_REVISION = "11 de octubre de 2026";

export const SECCIONES: SeccionWiki[] = [
  // ------------------------------------------------------------ inicio
  {
    id: "que-es",
    grupo: "Inicio",
    titulo: "Qué es este tablero",
    cuerpo: (
      <>
        <P>
          Un tablero de finanzas personales. Tus estados de cuenta en PDF se leen{" "}
          <B>en tu laptop</B> con una app de escritorio; ahí se convierten en transacciones
          (fecha, descripción, monto, cargo o abono), se categorizan con tus reglas y tú las revisas.
          Solo esas transacciones ya limpias se suben a una base de datos en la nube (Supabase), y
          este sitio las lee directamente de ahí para calcular todo lo que ves.
        </P>
        <P>
          Nada se calcula en un servidor propio: no hay backend. Todos los totales, promedios,
          alertas y gráficas se calculan <B>en tu navegador</B> cada vez que abres el sitio, a
          partir de las transacciones sincronizadas. Por eso, si algo "no cuadra", la causa casi
          siempre está en los datos sincronizados (una categoría, un estado de cuenta que falta) o
          en una regla de cálculo de esta wiki, no en un dato guardado aparte.
        </P>
        <Sub>Cómo usar esta wiki</Sub>
        <Lista>
          <li>El índice de la izquierda agrupa los temas; en el teléfono es una lista desplegable.</li>
          <li>
            El buscador filtra por cualquier palabra del texto (por ejemplo "hormiga", "Pago TDC",
            "Televia", "RLS").
          </li>
          <li>
            Cada sección tiene su propio enlace (aparece en la barra de direcciones), para compartirla
            o volver a ella.
          </li>
          <li>
            Los nombres en <C>este formato</C> son archivos, funciones, columnas o constantes del
            código, por si quieres buscarlos en el repositorio o pedir un cambio exacto.
          </li>
        </Lista>
      </>
    ),
  },
  {
    id: "arquitectura",
    grupo: "Inicio",
    titulo: "Arquitectura (de dónde sale cada dato)",
    cuerpo: (
      <>
        <DiagramaFlujo />
        <Sub>Las piezas</Sub>
        <TablaWiki
          encabezados={["Pieza", "Dónde corre", "Qué hace"]}
          filas={[
            [
              "App de escritorio",
              <>Tu laptop (Python + Tkinter, <C>app/</C>)</>,
              "Lee los PDFs, categoriza, te deja corregir, guarda el JSON y sincroniza. También lee los avisos de Gmail.",
            ],
            [
              "Parsers",
              <><C>parsers/</C></>,
              "Uno por tipo de documento: Banamex cheques, Banamex TDC (todas las tarjetas), Invex TDC.",
            ],
            [
              "Transformador y categorizador",
              <><C>transform/</C></>,
              "Fechas a ISO, montos a Decimal con signo, reglas de categoría y comercio.",
            ],
            [
              "Sincronizador",
              <><C>sync/sincronizador.py</C></>,
              "Sube los JSON a Supabase con tu propio usuario (no con una llave de administrador).",
            ],
            [
              "Supabase",
              "Nube (plan gratuito)",
              "Postgres + inicio de sesión + Row Level Security. Única fuente de verdad remota.",
            ],
            [
              "Este tablero",
              <>Cloudflare Pages (<C>frontend/</C>, React + Vite + Recharts)</>,
              "Lee de Supabase con supabase-js y calcula todo en el navegador.",
            ],
            [
              "Cloudflare Access",
              "Nube (plan gratuito)",
              "Un primer login (correo + PIN) delante del sitio, antes del login de Supabase.",
            ],
            [
              "GitHub Actions",
              <><C>.github/workflows/</C></>,
              "Pruebas, migraciones de la base de datos, publicación del sitio y descarga de datos macro.",
            ],
          ]}
        />
        <Nota titulo="Presupuesto: $0">
          Todo vive en planes gratuitos (Supabase, Cloudflare Pages, Cloudflare Access, GitHub
          Actions). Por eso, por ejemplo, los datos macro se descargan en GitHub Actions y no en un
          servidor, y las sugerencias de reglas con IA usan tu suscripción de Claude y no la API de
          pago.
        </Nota>
      </>
    ),
  },
  {
    id: "seguridad",
    grupo: "Inicio",
    titulo: "Seguridad y privacidad",
    cuerpo: (
      <>
        <Sub>Reglas que nunca se rompen</Sub>
        <Lista>
          <li>
            <B>Los PDFs y su texto completo nunca salen de tu laptop.</B> Solo suben las
            transacciones normalizadas.
          </li>
          <li>
            <B>Números de cuenta: solo los últimos 4 dígitos</B> se guardan (en{" "}
            <C>cuentas.ultimos_4_digitos</C>). El número completo se lee del PDF y se descarta en el
            momento.
          </li>
          <li>
            <B>Montos exactos:</B> en la laptop y en la base de datos los montos son decimales
            exactos (<C>Decimal</C> / <C>numeric</C>), nunca números de punto flotante.
          </li>
          <li>
            <B>Cada transacción es rastreable</B> hasta la página y la línea exacta del PDF (
            <C>pagina</C>, <C>linea_cruda</C>).
          </li>
          <li>
            <B>Volver a cargar el mismo PDF no duplica nada</B> (ver "Sincronización").
          </li>
          <li>Sin contraseñas en el código: todo está en un archivo <C>.env</C> que no se sube a git.</li>
        </Lista>
        <Sub>Quién puede ver tus datos</Sub>
        <P>
          Para llegar al tablero hay dos puertas: <B>Cloudflare Access</B> (tu correo + un PIN) y
          luego <B>Supabase Auth</B> (usuario y contraseña). La protección de los datos en sí es la{" "}
          <B>Row Level Security (RLS)</B> de Postgres: cada fila tiene un <C>user_id</C> y cada
          tabla tiene políticas que solo dejan leer, crear, cambiar o borrar filas donde{" "}
          <C>user_id</C> es el usuario con sesión. El código del tablero a propósito{" "}
          <B>no filtra por usuario</B>: si la RLS no lo permite, la consulta simplemente no regresa
          nada, así que un error en el tablero no puede mostrar datos de otra persona.
        </P>
        <P>
          La app de escritorio también sube con tu usuario y contraseña (no con la llave de
          administrador <C>service_role</C>), así que tiene exactamente los mismos permisos que tú.
        </P>
        <Nota titulo="Decisiones aceptadas (tuyas) que conviene recordar">
          <Lista>
            <li>
              <C>descripcion</C> y <C>linea_cruda</C> suben tal como las imprime el PDF. En
              transferencias SPEI de la cuenta de cheques pueden incluir una CLABE o un número de
              cuenta destino. Se decidió no enmascararlas (26 sep 2026): hacerlo cambiaría la clave
              de cada fila y duplicaría transacciones al re-sincronizar.
            </li>
            <li>
              <C>documentos.ruta_local</C> guarda la ruta del PDF en tu laptop (puede incluir tu
              nombre de usuario de Windows). Es la única ruta local que sube.
            </li>
            <li>
              "Sugerir reglas con Claude" manda las descripciones sin categoría y tus reglas a Claude,
              con <B>toda secuencia de 8 o más dígitos enmascarada</B> (<C>****</C> + últimos 4).
            </li>
          </Lista>
        </Nota>
      </>
    ),
  },

  // ------------------------------------------------------------ pipeline local
  {
    id: "flujo-estado-de-cuenta",
    grupo: "Cómo entran los datos",
    titulo: "De un PDF a una transacción",
    cuerpo: (
      <>
        <Pasos>
          <li>
            <B>Cargar PDF...</B> En la app de escritorio. La app detecta el banco sola (cada parser
            busca una marca que solo aparece en su tipo de documento); si no está segura, usa el que
            elegiste en la lista "Banco". También lee el alias de la cuenta y los últimos 4 dígitos.
          </li>
          <li>
            <B>Extraer.</B> El parser del banco convierte cada renglón del PDF en fecha, descripción y
            monto con signo (negativo = cargo), más la página y la línea de origen.
          </li>
          <li>
            <B>Transformar.</B> Fechas a formato ISO (AAAA-MM-DD), montos a decimales exactos
            separados en <C>monto</C> (siempre positivo) y <C>tipo</C> (<C>cargo</C> o{" "}
            <C>abono</C>). Si dos renglones de la misma página tienen exactamente el mismo texto (dos
            casetas Televia iguales el mismo día), el segundo recibe " (2)" al final de su línea de
            auditoría para que no choquen.
          </li>
          <li>
            <B>Categorizar.</B> Las reglas de <C>transform/reglas_categorizacion.json</C> asignan
            categoría y, opcionalmente, comercio (ver "Reglas de categorización").
          </li>
          <li>
            <B>Revisar.</B> Ves la tabla, los totales (cargos, disposición de efectivo, abonos) y los
            avisos de renglones que no se pudieron leer. Puedes agregar renglones a mano, cambiar la
            categoría de un renglón sin crear regla, o editar reglas.
          </li>
          <li>
            <B>Guardar archivo procesado.</B> Escribe <C>data/procesados/&lt;hash del PDF&gt;.json</C>{" "}
            y mueve el PDF a una subcarpeta <C>procesados/</C> junto a donde estaba.
          </li>
          <li>
            <B>Sincronizar a Supabase...</B> Sube los JSON nuevos o cambiados.
          </li>
        </Pasos>
        <Sub>Lo que hace cada parser</Sub>
        <TablaWiki
          encabezados={["Documento", "Cómo sabe si es cargo o abono", "Detalles"]}
          filas={[
            [
              "Banamex cheques (Priority)",
              "Por cómo cambia el saldo entre renglones (la descripción a veces engaña)",
              "El año sale de la portada; avisa de bloques que nunca cierran.",
            ],
            [
              "Banamex TDC (Platino, Beyond, Conquista)",
              <>Signo impreso: <C>+</C> = cargo, <C>-</C> = abono</>,
              "Una sola clase para todas las tarjetas. La tarjeta se reconoce por su nombre o, si el estado no lo imprime (desde oct 2024), por sus últimos 4 dígitos. Secciones Titular/Adicional/Digital → columna tarjeta.",
            ],
            [
              "Invex TDC",
              <>Formato 1: signo <C>+</C>/<C>-</C>. Formato 2: un "CR" al final = abono; sin "CR" = cargo</>,
              "Dos formatos distintos del mismo producto; se prueban ambos en cada renglón. Las líneas de eco de $0.00 se conservan (no cambian totales).",
            ],
          ]}
        />
        <Sub>Renglones impresos como imagen</Sub>
        <P>
          Algunos renglones de Banamex TDC (por ejemplo "SU ABONO ... GRACIAS" o los pagos
          interbancarios) vienen como imágenes de letras, no como texto. La app los{" "}
          <B>lee reconociendo cada letra por su huella</B> (<C>parsers/glifos.py</C>, sin OCR: el
          banco usa siempre el mismo dibujo para la misma letra). Si aparece una letra desconocida, el
          renglón queda como aviso y te sugiere capturarlo a mano con la fecha y página ya llenas.
        </P>
        <Sub>Descripciones que el parser reescribe</Sub>
        <Lista>
          <li>
            "SU ABONO ... GRACIAS" (el pago a la tarjeta) se convierte en "PAGO TDC &lt;TARJETA&gt;"
            para que la regla correcta lo categorice como <B>Pago TDC</B>.
          </li>
          <li>
            Un bloque "PAGO INTERBANCARIO" recibido en la tarjeta se convierte en "PAGO RECIBIDO
            &lt;concepto&gt;" para que no lo atrape la regla de transferencias <i>enviadas</i>.
          </li>
          <li>La línea de auditoría (<C>linea_cruda</C>) siempre conserva el texto original.</li>
        </Lista>
      </>
    ),
  },
  {
    id: "reglas-categorizacion",
    grupo: "Cómo entran los datos",
    titulo: "Reglas de categorización",
    cuerpo: (
      <>
        <P>
          Cada regla tiene un <B>patrón</B> (texto que debe aparecer en la descripción), una{" "}
          <B>categoría</B> obligatoria y un <B>comercio</B> opcional. Ejemplo: "TELEVIA" →
          Transporte / Televia. Viven en <C>transform/reglas_categorizacion.json</C> (no se sube a
          git) y se editan desde la app ("Reglas de categorización...").
        </P>
        <Formula nombre="Gana la primera que coincide">
          las reglas se revisan en orden y la primera cuyo patrón aparece en la descripción decide
          categoría y comercio. Por eso una regla específica va antes que una general que la
          contiene ("SU PAGO INTERBANCARIO" antes que "PAGO INTERBANCARIO"); la ventana de reglas tiene
          botones ▲ Subir / ▼ Bajar.
        </Formula>
        <Sub>Formas de corregir una categoría (de más a menos duradera)</Sub>
        <TablaWiki
          encabezados={["Forma", "Dónde", "¿Sobrevive a re-sincronizar el PDF?"]}
          filas={[
            ["Agregar o editar una regla", "App de escritorio", "Sí: es la corrección que dura."],
            [
              "Categoría manual de un renglón (✎)",
              "App de escritorio: doble clic en el renglón",
              "Sí: se guarda en el JSON y se restaura al recargar ese PDF. No crea regla (para casos sueltos).",
            ],
            [
              "Sugerir reglas con Claude",
              "App, pestaña Sin categorizar",
              "Sí: las reglas aceptadas se agregan al final del archivo.",
            ],
            [
              "Editar en lote / Editar en el día",
              "Este tablero",
              "No: si vuelves a sincronizar ese mismo PDF, la categoría regresa a lo que digan las reglas.",
            ],
          ]}
        />
        <P>
          El <B>comercio</B> es opcional a propósito: solo lo tienen las transacciones cuya regla lo
          define. Todo lo que depende del comercio (gastos recurrentes, alertas de suscripciones,
          gráfica por comercio) solo ve esas transacciones.
        </P>
      </>
    ),
  },
  {
    id: "sincronizacion",
    grupo: "Cómo entran los datos",
    titulo: "Sincronización con Supabase",
    cuerpo: (
      <>
        <Lista>
          <li>
            <B>Idempotente:</B> cada transacción se identifica por (documento, página, línea de
            auditoría). Subir el mismo JSON otra vez actualiza esas filas, no crea otras.
          </li>
          <li>
            <B>Incremental:</B> solo sube los JSON cuyo contenido cambió desde la última subida
            exitosa (<C>data/procesados/_estado_sync.json</C>). Un archivo que falla se reintenta la
            próxima vez; un JSON dañado no detiene a los demás.
          </li>
          <li>
            <B>Bancos, cuentas, documentos y categorías</B> se buscan y, si no existen, se crean. Una
            cuenta se reconoce por banco + últimos 4 dígitos; si su alias cambió, se renombra (gana el
            último sincronizado). Un documento se reconoce por el hash del PDF; si ahora pertenece a
            otra cuenta, se mueve.
          </li>
          <li>
            Los eventos <B>no</B> se mandan desde la laptop, así que re-sincronizar nunca borra los
            eventos que asignaste en el tablero.
          </li>
        </Lista>
        <Nota titulo="Las filas viejas nunca se borran (decisión tuya, 26 sep 2026)">
          Si al reprocesar un PDF una transacción cambia de línea de auditoría (por ejemplo, un parser
          corregido ahora la lee distinto), la fila vieja se queda en Supabase junto a la nueva y el
          total sale inflado. Hay que borrarla a mano en Supabase (Table Editor, filtrando por{" "}
          <C>documento_id</C>).
        </Nota>
      </>
    ),
  },
  {
    id: "gmail",
    grupo: "Cómo entran los datos",
    titulo: "Avisos de compra por correo (Gmail)",
    cuerpo: (
      <>
        <P>
          Banamex manda un correo por cada compra con tarjeta de crédito. La app de escritorio
          (pestaña "Gastos recientes (Gmail)") los lee con permiso de <B>solo lectura</B>, los
          categoriza con las mismas reglas y los guarda en <C>data/gastos_correo/</C>, un archivo por
          día. Luego los sube a la tabla <C>gastos_correo</C>, aparte de las transacciones: el aviso
          llega el mismo día y el estado de cuenta semanas después, y mezclarlos duplicaría cargos.
        </P>
        <Lista>
          <li>Solo descarga los correos que no tiene guardados; los guardados se re-categorizan en la laptop.</li>
          <li>Si Gmail limita las consultas, reintenta con esperas crecientes y guarda lo que alcanzó a leer.</li>
          <li>
            Los avisos de retiro o compra con la cuenta de cheques (débito) no dicen el comercio:{" "}
            <B>no se suman como gastos</B> ni se suben; la pestaña solo dice cuántos hubo.
          </li>
          <li>
            Cada aviso guarda la hora, la terminación de la tarjeta, el establecimiento y la ciudad
            (los códigos de ciudad de 3 letras se traducen solo si los confirmaste).
          </li>
        </Lista>
      </>
    ),
  },

  // ------------------------------------------------------------ datos
  {
    id: "modelo-de-datos",
    grupo: "Datos",
    titulo: "Modelo de datos (tablas y columnas)",
    cuerpo: (
      <>
        <P>
          El esquema vive en <C>supabase/migrations/</C> y se aplica solo con GitHub Actions; nunca se
          cambia a mano en Supabase. Todas las tablas menos <C>bancos</C> tienen <C>user_id</C> y RLS.
        </P>
        <TablaWiki
          encabezados={["Tabla", "Qué guarda", "Columnas clave"]}
          filas={[
            ["bancos", "Catálogo compartido de bancos", <><C>nombre</C> (único)</>],
            [
              "cuentas",
              "Tus cuentas y tarjetas",
              <><C>alias</C> (lo que ves: "TDC Beyond", "Priority"), <C>ultimos_4_digitos</C>, <C>banco_id</C></>,
            ],
            [
              "documentos",
              "Un registro por PDF sincronizado",
              <><C>hash</C> (huella del PDF), <C>cuenta_id</C>, <C>periodo_inicio/fin</C>, <C>ruta_local</C></>,
            ],
            ["categorias", "Tus categorías", <><C>nombre</C> (único por usuario)</>],
            ["eventos", "Viajes, fiestas, etc.", <><C>nombre</C> (único por usuario)</>],
            [
              "transacciones",
              "Cada movimiento de un estado de cuenta",
              <>
                <C>fecha</C>, <C>descripcion</C>, <C>monto</C> (≥ 0), <C>tipo</C> (cargo/abono),{" "}
                <C>saldo</C> (solo cheques), <C>categoria_id</C>, <C>comercio</C>, <C>tarjeta</C>{" "}
                (Titular/Adicional/Digital), <C>evento_id</C>, <C>pagina</C>, <C>linea_cruda</C>
              </>,
            ],
            [
              "gastos_correo",
              "Cada aviso de compra por correo",
              <>
                <C>mensaje_id</C> (de Gmail), <C>fecha</C>, <C>hora</C>, <C>tarjeta</C> (terminación),{" "}
                <C>comercio</C>, <C>categoria</C> (texto), <C>establecimiento</C>, <C>ciudad</C>,{" "}
                <C>monto</C>, <C>evento_id</C>
              </>,
            ],
          ]}
        />
        <Sub>Conceptos que se confunden fácil</Sub>
        <Lista>
          <li>
            <B>Cuenta</B> = <C>cuentas.alias</C> ("TDC Beyond", "Invex TDC", "Priority"). Las
            pestañas y el filtro "Cuenta" usan esto. Una misma tarjeta reexpedida con otro número
            comparte alias.
          </li>
          <li>
            <B>Tarjeta</B> (columna <C>transacciones.tarjeta</C>) = el plástico dentro de una cuenta:
            Titular, Adicional o Digital. En los avisos por correo, "tarjeta" es la terminación.
          </li>
          <li>
            <B>Cargo</B> = dinero que sale (o deuda que sube en una tarjeta). <B>Abono</B> = dinero
            que entra: nómina, transferencias recibidas, pagos a la tarjeta, devoluciones.
          </li>
          <li>
            <B>Comercio</B> es texto libre y opcional; <B>categoría</B> siempre existe (si no hay, se
            muestra "Sin categoría").
          </li>
        </Lista>
      </>
    ),
  },
  {
    id: "carga-en-navegador",
    grupo: "Datos",
    titulo: "Cómo carga los datos el tablero",
    cuerpo: (
      <>
        <Lista>
          <li>
            Al entrar descarga <B>todo el historial</B> de transacciones en páginas de 1,000 (varias
            en paralelo), ordenadas por fecha e id. Cuentas, categorías y eventos llegan aparte una
            sola vez y se unen en el navegador.
          </li>
          <li>
            Después de editar algo solo se vuelven a pedir las filas editadas. Si esa recarga falla,
            aparece un aviso con "Reintentar" sin perder tus filtros.
          </li>
          <li>
            Las pestañas que no son el Resumen se descargan la primera vez que las abres. Si el sitio
            se actualizó mientras lo tenías abierto, la página se recarga sola una vez.
          </li>
          <li>
            Si una pestaña falla al dibujarse, solo esa muestra el error con "Reintentar".
          </li>
          <li>
            Cada pestaña recuerda sus propios filtros y periodo mientras la página esté abierta;
            filtrar en una no afecta a otra.
          </li>
          <li>
            En el navegador los montos se suman como números normales: es solo para mostrar, y a
            montos personales el redondeo es exacto. La regla de "decimales exactos" es para lo que se
            guarda.
          </li>
        </Lista>
      </>
    ),
  },

  // ------------------------------------------------------------ pestañas
  {
    id: "resumen-controles",
    grupo: "Pestañas",
    titulo: "Resumen: periodo, exclusiones y filtros",
    cuerpo: (
      <>
        <P>
          El Resumen tiene tres controles con <B>alcances distintos a propósito</B>:
        </P>
        <TablaWiki
          encabezados={["Control", "Qué afecta", "Por defecto"]}
          filas={[
            [
              "Periodo (Desde / Hasta, por meses)",
              "Todo lo de la pestaña",
              "Los últimos 3 meses completos. El mes en curso no cuenta: los estados de cuenta llegan a mes vencido.",
            ],
            [
              "Excluir del análisis (categorías y eventos)",
              "Todo, desde la raíz: indicadores, gráficas, tablas y alertas",
              'Se excluyen las categorías de movimientos entre tus cuentas: nombres que contienen "pago tdc", "entre cuentas" o "traspaso".',
            ],
            [
              "Filtros por clic (cuenta, tarjeta, evento, categoría, comercio)",
              "Solo el detalle del gasto (gráficas, Sankey, tablas, gasto hormiga, categorías al alza)",
              "Ninguno",
            ],
          ]}
        />
        <Sub>Por qué se excluye "Pago TDC"</Sub>
        <P>
          Cuando pagas la tarjeta desde la cuenta de cheques, el mismo dinero aparece como cargo en
          cheques y como abono en la tarjeta. Si se contaran, el pago se sumaría como gasto <i>y</i>{" "}
          como ingreso. Los gastos reales ya están en los cargos de la tarjeta.
        </P>
        <Sub>Por qué los filtros por clic no cambian los indicadores</Sub>
        <P>
          Una "tasa de ahorro de solo Comida" no significa nada. Los indicadores de salud (tasa de
          ahorro, flujo neto, gasto promedio, meses cubiertos, recurrentes, flujo neto mensual) y las
          alertas siempre describen tus finanzas completas del periodo.
        </P>
        <Sub>Cómo funciona el filtro por clic (estilo Power BI)</Sub>
        <Lista>
          <li>Clic en una barra o en una opción de las filas Cuenta / Tarjeta / Evento filtra; otro clic lo quita.</li>
          <li>
            Cada gráfica se calcula con todos los filtros <B>menos el suyo</B>, para que siga mostrando
            sus otras opciones (atenuadas) y puedas cambiar de elección.
          </li>
          <li>Los chips de arriba muestran qué filtros están activos y los quitan.</li>
          <li>Elegir un evento también mueve el periodo a los meses de ese evento.</li>
          <li>"Otros" (la cola de categorías pequeñas) no es clicable.</li>
        </Lista>
        <Sub>Comparaciones</Sub>
        <P>
          Las variaciones se comparan contra el periodo inmediatamente anterior de la misma duración
          (agosto contra julio; jun–ago contra mar–may).
        </P>
      </>
    ),
  },
  {
    id: "resumen-indicadores",
    grupo: "Pestañas",
    titulo: "Resumen: indicadores y cómo se calculan",
    cuerpo: (
      <>
        <P>
          "Ingresos" = suma de <B>abonos</B> y "gastos" = suma de <B>cargos</B>, en los meses del
          periodo, después de quitar lo excluido. Ojo: una devolución es un abono, así que cuenta
          como ingreso.
        </P>
        <Formula nombre="Tasa de ahorro">
          (ingresos − gastos) ÷ ingresos. Sin ingresos no hay tasa ("—"). Se compara en puntos contra
          el periodo anterior y se muestra también la de los 12 meses que terminan con el periodo.
        </Formula>
        <Formula nombre="Flujo neto">
          (ingresos − gastos) ÷ número de meses del periodo: lo que te sobra (o falta) en un mes
          típico.
        </Formula>
        <Formula nombre="Gasto mensual promedio">
          gastos ÷ meses del periodo, comparado contra tu promedio mensual de hasta 12 meses antes
          del periodo (contando solo desde tu primer estado de cuenta).
        </Formula>
        <Formula nombre="Meses cubiertos con tu saldo">
          saldo más reciente al cierre del periodo de cada cuenta que reporta saldo (las tarjetas no
          lo traen por renglón, así que es la cuenta de cheques) ÷ gasto mensual promedio. Referencia:
          3–6 meses de fondo de emergencia.
        </Formula>
        <Formula nombre="Gastos recurrentes">
          comercios con cargos en al menos 3 de los 6 meses que terminan en el último mes del periodo,
          y con cargo en alguno de los 2 últimos. Monto mensual = total ÷ meses con cargo. Solo ve
          transacciones con comercio, e ignora las que tienen evento (son gastos puntuales).
        </Formula>
        <Formula nombre="Gasto hormiga">cargos de menos de $200 en el periodo: cuántos, cuánto suman y qué parte del gasto son.</Formula>
        <Formula nombre="Categorías al alza">
          categorías cuyo gasto mensual promedio en el periodo es mayor que en el periodo anterior,
          ordenadas por el aumento en pesos, con una minigráfica de sus últimos 12 meses.
        </Formula>
        <Formula nombre="Flujo de dinero (Sankey)">
          de dónde entra el dinero (top 5) y a qué se va (top 8, el resto en "Otros"), más lo
          ahorrado o el déficit. Se puede agrupar por categoría, cuenta o evento.
        </Formula>
        <Formula nombre="Ingresos vs. gastos (gráfica de barras)">
          muestra 13 meses (el actual y los 12 anteriores), todo el historial o por años. Es la
          gráfica que <B>elige</B> el periodo: clic en un mes o año lo vuelve el periodo; otro clic
          regresa al periodo por defecto.
        </Formula>
      </>
    ),
  },
  {
    id: "alertas",
    grupo: "Pestañas",
    titulo: "Alertas automáticas",
    cuerpo: (
      <>
        <P>
          Al final del Resumen (y de las pestañas de cuenta). Usan el periodo y las exclusiones, pero
          nunca los filtros por clic. Se muestran 4 y el resto con "Ver N más"; primero las que piden
          revisar, luego las buenas noticias y al final las informativas.
        </P>
        <TablaWiki
          encabezados={["Alerta", "Regla exacta"]}
          filas={[
            [
              "Tasa de ahorro bajó / subió",
              "Cambio de 2 puntos o más contra el periodo anterior. Explica si fue por el gasto (nombra la categoría que más cambió) o por los ingresos. Siempre va primero.",
            ],
            [
              "Posible cargo duplicado",
              'Misma cuenta, mismo comercio (o descripción), mismo monto y mismo día. Es "posible": dos casetas iguales el mismo día son legítimas.',
            ],
            [
              "Suscripción cambió de precio",
              "Por comercio, solo meses con un único cargo; dos cobros previos iguales (±2%) y luego uno en el periodo que difiere al menos 3% y $10, pero no más de 50% (más que eso es otra compra).",
            ],
            [
              "Suscripción nueva",
              "Comercio visto por primera vez en los últimos 3 meses, con al menos 2 cobros mensuales del mismo monto.",
            ],
            [
              "Cargo inusual",
              "De $1,000 o más, al menos 3 veces la mediana de su categoría y mayor que el máximo de los 12 meses previos; requiere 6 cargos de historia. Máximo 3.",
            ],
          ]}
        />
        <P>
          Los cargos con evento no generan alertas de suscripción ni de cargo inusual (un viaje ya
          explica el gasto). Los cargos de $0 nunca alertan. "Ver movimientos" aplica el filtro del
          comercio o categoría de la alerta.
        </P>
      </>
    ),
  },
  {
    id: "eventos",
    grupo: "Pestañas",
    titulo: "Eventos y Shophunters",
    cuerpo: (
      <>
        <Sub>Eventos</Sub>
        <P>
          Un evento agrupa transacciones de un viaje, una fiesta, etc. Solo se asignan desde el
          tablero (pestaña Eventos, editor en lote o "Gastos recientes"). La pestaña muestra cuánto
          gastaste en cada evento, en qué categorías y comercios, y tiene un buscador por fechas,
          cuenta, tarjeta y texto para asignar o quitar un evento a varias transacciones; no lista
          nada hasta que eliges al menos un filtro.
        </P>
        <Sub>Shophunters</Sub>
        <P>
          Aparece solo si hay transacciones con un evento cuyo nombre contiene "shophunters"
          (mayúsculas o minúsculas da igual), así que "2026-10 Shophunters" entra solo. Es la misma
          vista del Resumen con esos movimientos, sin tasa de ahorro ni tarjetas de indicadores (es
          el gasto de un evento, no tus finanzas). Su gráfica mensual lleva el promedio móvil de 3
          meses y los promedios de 3 y 12 meses.
        </P>
        <Formula nombre="Promedios de 3 y 12 meses">
          solo meses completos (el actual no) y solo desde el primer mes con gasto: algo que empezó
          hace 4 meses promedia sobre 4, no sobre 12 con ceros. Un mes en $0 después del primer gasto
          sí cuenta. El promedio móvil aparece a partir del tercer mes.
        </Formula>
      </>
    ),
  },
  {
    id: "categorias-comercios",
    grupo: "Pestañas",
    titulo: "Categorías y Comercios",
    cuerpo: (
      <>
        <P>
          El detalle de una categoría y/o un comercio sobre todo el historial: gasto mensual con
          promedio móvil de 3 meses y promedios de 3 y 12 meses, sus movimientos más grandes y sus
          transacciones.
        </P>
        <Lista>
          <li>
            Si lo elegido solo tiene abonos (por ejemplo "Transferencia recibida"), la gráfica muestra{" "}
            <B>ingresos</B> en vez de gastos.
          </li>
          <li>Clic en un mes de la gráfica filtra a ese mes lo de abajo; la gráfica se queda completa.</li>
          <li>Con una categoría elegida, el filtro de comercio solo ofrece los comercios de esa categoría.</li>
          <li>Las tablas muestran 100 filas a la vez ("Mostrar 100 más" / "Mostrar todas").</li>
        </Lista>
      </>
    ),
  },
  {
    id: "tarjetas-credito",
    grupo: "Pestañas",
    titulo: "Tarjetas de crédito",
    cuerpo: (
      <>
        <P>
          Compara todas las cuentas cuyo banco o alias dice "TDC" (Invex TDC, TDC Beyond, TDC
          Conquista, TDC Platino) en el mismo periodo que el Resumen. La cuenta de cheques no entra.
        </P>
        <Formula nombre="Gasto de una tarjeta">
          solo sus <B>cargos</B>. Los abonos (pagos y devoluciones) se reportan aparte como "Pagos y
          abonos": restarlos anularía el gasto. Los cargos de $0 no cuentan como compras.
        </Formula>
        <Lista>
          <li>Reparto del gasto entre tarjetas (barra al 100%).</li>
          <li>
            Tabla por tarjeta: gasto, compras, ticket promedio, cambio vs. el periodo anterior, pagos y
            abonos, categoría principal y tendencia de 12 meses.
          </li>
          <li>Gasto mensual apilado por tarjeta (clic en un mes = ese mes como periodo).</li>
          <li>Para qué usas cada tarjeta: gasto por categoría y tarjeta (8 categorías + "Otras").</li>
          <li>
            Clic en una tarjeta o categoría filtra lo demás. Cada tarjeta conserva su color siempre
            (orden alfabético fijo).
          </li>
        </Lista>
      </>
    ),
  },
  {
    id: "gastos-recientes",
    grupo: "Pestañas",
    titulo: "Gastos recientes (calendario)",
    cuerpo: (
      <>
        <P>
          Un calendario del gasto por día, coloreado de verde (día barato) a rojo (día caro) con una
          escala logarítmica entre el día más barato y el más caro de todo lo cargado. Clic en un día
          abre su detalle con "Descargar Excel".
        </P>
        <TablaWiki
          encabezados={["", "Por correo", "Por estado de cuenta"]}
          filas={[
            ["Fuente", "Tabla gastos_correo (avisos de Gmail)", "Tabla transacciones"],
            ["Llega", "El mismo día", "Semanas después (a mes vencido)"],
            [
              "Qué suma al total del día",
              "Todos los avisos (solo existen para tarjetas de crédito)",
              "Solo cargos de tarjetas de crédito de categorías no ocultas. Los abonos, todo lo de la cuenta de cheques y lo oculto aparece en \"No suman al total\".",
            ],
            ["Columnas", "Terminación de tarjeta, hora, ciudad", "Cuenta, tarjeta (Titular/Adicional), evento"],
            ["Eventos ocultos por defecto", "No", "Sí, todos (los puedes volver a mostrar)"],
          ]}
        />
        <Sub>Meta de gasto diario: $1,000</Sub>
        <Formula nombre="Promedio por día">
          total de los días ÷ días contados. Un día sin movimientos cuenta como $0 solo si está dentro
          del rango conocido: desde el primer día cargado hasta <B>hoy</B> (por correo) o hasta{" "}
          <B>el último movimiento cargado</B> (por estado de cuenta). Se muestra para cada semana
          (domingo a sábado) y para el mes, con una barra contra la meta.
        </Formula>
        <Sub>Posible coincidencia con el correo</Sub>
        <P>
          En "por estado de cuenta", clic en un movimiento busca el aviso de correo que probablemente
          es el mismo cargo: <B>monto exacto al centavo y fecha ±1 día</B>, uno a uno (un aviso no se
          empareja con dos cargos). Es una pista, no una conciliación: las dos fuentes no comparten un
          identificador. Los movimientos con coincidencia llevan ✉.
        </P>
        <Sub>Eventos desde el correo</Sub>
        <P>
          Puedes asignar un evento a los avisos del día en cuanto llegan. Cuando llega el estado de
          cuenta, los movimientos que se emparejan con un aviso con evento pueden{" "}
          <B>heredarlo</B> ("Heredar eventos", siempre con confirmación y sin pisar un evento ya
          asignado).
        </P>
        <P>
          La línea "Datos hasta" dice la última fecha de cada cuenta (⚠ si pasaron más de 45 días): un
          día vacío después de esa fecha significa "aún no cargado", no "no gasté".
        </P>
      </>
    ),
  },
  {
    id: "pestanas-cuenta",
    grupo: "Pestañas",
    titulo: "Pestañas por cuenta",
    cuerpo: (
      <P>
        Cada cuenta que no es tarjeta de crédito (por ejemplo la de cheques) tiene su propia pestaña
        con la misma vista que el Resumen, pero solo con sus movimientos. El editor en lote solo
        busca en esa cuenta, aunque sugiere categorías de todo tu historial.
      </P>
    ),
  },
  {
    id: "qqq",
    grupo: "Pestañas",
    titulo: "QQQ / TQQQ (análisis técnico)",
    cuerpo: (
      <>
        <P>
          No usa tus finanzas: está aquí para tener todo en un lugar. Las velas diarias de 10 años
          vienen de Yahoo Finance a través de una función de Cloudflare (<C>/api/cotizaciones</C>, solo
          acepta QQQ y TQQQ, caché de 5 minutos). Las lecturas describen el estado de cada indicador;{" "}
          <B>nunca son recomendaciones de compra o venta</B>.
        </P>
        <TablaWiki
          encabezados={["Indicador", "Cálculo"]}
          filas={[
            ["Medias móviles", "SMA de 50 y 200 sesiones (calculadas sobre los 10 años, para que la de 200 exista desde el primer día visible)"],
            ["Bandas de Bollinger", "SMA 20 ± 2 desviaciones estándar"],
            ["RSI", "14 sesiones, suavizado de Wilder"],
            ["MACD", "EMA 12 − EMA 26, señal EMA 9"],
            ["ATR", "14 sesiones, suavizado de Wilder"],
            ["Volumen", "Barras por alza/baja vs. el cierre anterior, promedio de 20 sesiones, punto en días > 1.5×"],
            ["QQQ vs. TQQQ", "Tabla con rendimientos, beta y el desgaste del apalancamiento (3× QQQ vs. real)"],
          ]}
        />
        <Sub>Soportes y resistencias</Sub>
        <P>
          Sobre las últimas 126 sesiones (≈6 meses) de toda la serie, así que no se mueven al cambiar
          el zoom: pivotes (máximo o mínimo de ±5 sesiones) agrupados en zonas de 0.75 ATR.
          Resistencia = la zona más cercana arriba del cierre (o el máximo de 6 meses); soportes
          inmediato e intermedio = las dos más cercanas abajo; estructural = el piso del último rango
          lateral o la zona con más toques. Las SMA 50 y 200 son "soporte mayor" y "soporte de largo
          plazo". Cada nivel guarda las velas que lo originan (clic en la etiqueta).
        </P>
        <Sub>Patrones chartistas</Sub>
        <P>
          Rectángulo, hombro-cabeza-hombro (normal e invertido), bandera, taza con asa, murciélago y
          doble techo/piso, detectados en el rango visible. Un patrón aparece solo si cumple{" "}
          <B>todas</B> sus reglas obligatorias; las de calidad solo suben o bajan su puntaje (alta,
          media, baja) y se ven como ✓/✗ en su tarjeta. Todos los parámetros están en{" "}
          <C>src/lib/patrones/config.ts</C>.
        </P>
      </>
    ),
  },
  {
    id: "macro",
    grupo: "Pestañas",
    titulo: "Macro EE.UU.",
    cuerpo: (
      <>
        <P>
          Dentro de QQQ / TQQQ. Los datos vienen de <B>FRED</B> (Fed de St. Louis), descargados por
          GitHub Actions en cada publicación del sitio y dos veces cada día hábil (15:00 y 23:00 UTC),
          y guardados como <C>/macro.json</C>. FRED no se puede llamar desde Cloudflare ni desde el
          navegador.
        </P>
        <Lista>
          <li>
            Recuadros: rango de la Fed, tasa real (punto medio − PCE subyacente anual), bonos a 2 y 10
            años, curva 10a−2a, PCE y CPI (general y subyacente), nómina no agrícola, desempleo,
            solicitudes de subsidio, salarios, vacantes JOLTS, PIB real, ventas minoristas, confianza
            del consumidor (Michigan) y VIX.
          </li>
          <li>
            Cada recuadro muestra el periodo del dato (no su fecha de publicación) y el cambio contra
            el dato anterior, en <B>verde o rojo según si ese movimiento suele ser buena o mala noticia
            para el Nasdaq-100</B> (menos inflación, tasas y volatilidad = verde; más empleo y
            crecimiento = verde). Un dato de empleo muy fuerte puede leerse al revés.
          </li>
          <li>Clic en un recuadro abre su histórico (1, 2, 5 o 10 años).</li>
          <li>
            "Próximo dato": fecha de la siguiente publicación, resaltada si faltan menos de 5 días.
          </li>
          <li>
            Calendario sin dato: minutas del FOMC (3 semanas después de cada decisión), PMI
            manufacturero (1er día hábil del mes) y de servicios (3er día hábil), de ISM y S&amp;P
            Global. Sus valores no se incluyen porque son de licencia.
          </li>
        </Lista>
      </>
    ),
  },

  // ------------------------------------------------------------ operación
  {
    id: "edicion",
    grupo: "Operación",
    titulo: "Lo que se puede editar desde el tablero",
    cuerpo: (
      <>
        <P>Todas las escrituras usan tu sesión y las mismas reglas de RLS que las lecturas.</P>
        <TablaWiki
          encabezados={["Edición", "Dónde", "Qué cambia"]}
          filas={[
            [
              "Editar en lote",
              "Resumen y pestañas de cuenta",
              "Busca por texto de la descripción; asigna categoría, comercio, evento y/o cuenta a las seleccionadas. Un campo en blanco no se toca; una categoría nueva se crea sola. Cambiar la cuenta mueve el estado de cuenta completo.",
            ],
            ["Asignar evento", "Eventos y Gastos recientes", "Pone o quita un evento a varias transacciones o avisos."],
            ["Editar en el día", "Gastos recientes · por estado de cuenta", "Categoría, comercio y evento de un movimiento."],
          ]}
        />
        <Nota titulo="Qué no sobrevive a re-sincronizar">
          Si vuelves a cargar y sincronizar el mismo PDF desde la app de escritorio, la categoría y el
          comercio regresan a lo que digan las reglas, y la cuenta a la del JSON. Los eventos sí se
          conservan. Para una corrección permanente, ajusta una regla.
        </Nota>
      </>
    ),
  },
  {
    id: "constantes",
    grupo: "Operación",
    titulo: "Umbrales y constantes",
    cuerpo: (
      <>
        <P>Los números que deciden lo que ves. Cambiar uno es cambiar esa constante en el código.</P>
        <TablaWiki
          encabezados={["Regla", "Valor", "Constante"]}
          filas={[
            ["Gasto hormiga", "cargo < $200", <C key="1">UMBRAL_GASTO_HORMIGA</C>],
            ["Gasto recurrente", "3 de 6 meses", <C key="2">MESES_MINIMOS_RECURRENTE / VENTANA_RECURRENTES</C>],
            ["Periodo por defecto", "últimos 3 meses completos", <C key="3">MESES_PERIODO_POR_DEFECTO</C>],
            ["Categorías excluidas por defecto", "pago tdc | entre cuentas | traspaso", <C key="4">PATRON_EXCLUIDA_POR_DEFECTO</C>],
            ["Eventos de Shophunters", 'nombre contiene "shophunters"', <C key="5">PATRON_SHOPHUNTERS</C>],
            ["Meta de gasto diario", "$1,000", <C key="6">META_GASTO_DIARIO</C>],
            ["Coincidencia estado ↔ correo", "monto exacto, ±1 día", <C key="7">TOLERANCIA_DIAS</C>],
            ["Sankey", "5 fuentes de ingreso, 8 destinos de gasto", <C key="8">TOPE_SANKEY_*</C>],
            ["Mismo precio (suscripción)", "±2%", <C key="9">TOLERANCIA_MONTO_FIJO</C>],
            ["Cambio de precio", "≥3% y ≥$10, ≤50%", <C key="10">CAMBIO_PRECIO_*</C>],
            ["Suscripción nueva", "últimos 3 meses", <C key="11">MESES_SUSCRIPCION_NUEVA</C>],
            ["Cargo inusual", "≥$1,000, ≥3× mediana, 6 de historia, máx. 3", <C key="12">*_INUSUAL(ES)</C>],
            ["Alertas visibles", "4", <C key="13">ALERTAS_VISIBLES</C>],
            ["Categorías por tarjeta", "8 + Otras", <C key="14">TOPE_CATEGORIAS_TARJETAS</C>],
            ["Estado de cuenta atrasado", "45 días", <C key="15">DIAS_ESTADO_ATRASADO</C>],
            ["Filas por tanda en tablas", "100", <C key="16">FILAS_POR_TANDA</C>],
            ["Publicación macro cercana", "menos de 5 días", <C key="17">DIAS_PUBLICACION_CERCANA</C>],
            ["Soportes y resistencias", "126 sesiones", <C key="18">SESIONES_NIVELES</C>],
          ]}
        />
      </>
    ),
  },
  {
    id: "despliegue",
    grupo: "Operación",
    titulo: "Publicación, pruebas y migraciones",
    cuerpo: (
      <>
        <TablaWiki
          encabezados={["Proceso", "Cuándo corre", "Qué hace"]}
          filas={[
            [
              <C key="ci">ci.yml</C>,
              "Cada cambio al tablero o a la app de escritorio",
              "Revisión de tipos, lint y pruebas del tablero (Vitest) y pruebas de Python. Es la red de seguridad antes de publicar.",
            ],
            [
              <C key="dep">deploy.yml</C>,
              "Cada cambio en frontend/ que llega a main, y 2 veces al día hábil",
              "Descarga los datos macro, compila y publica el sitio en Cloudflare Pages.",
            ],
            [
              <C key="db">db-migrate.yml</C>,
              "Cada migración nueva en supabase/migrations/",
              "Aplica los cambios de esquema a Supabase.",
            ],
            ["Dependabot", "Semanal", "Propone actualizaciones de dependencias (pasan por ci.yml)."],
          ]}
        />
        <P>
          Los cambios validados se publican directo a <C>main</C> (instrucción tuya del 25 sep 2026).
          Un cambio al esquema siempre es un archivo de migración nuevo; nunca se edita uno existente
          ni se cambia la base a mano.
        </P>
        <P>
          Las pruebas no usan PDFs reales (nunca salen de tu laptop): los parsers se prueban con
          renglones sintéticos y la sincronización con un Supabase falso en memoria.
        </P>
      </>
    ),
  },
  {
    id: "limitaciones",
    grupo: "Operación",
    titulo: "Limitaciones conocidas",
    cuerpo: (
      <Lista>
        <li>
          <B>Estados de cuenta a mes vencido:</B> el mes en curso siempre se ve incompleto; por eso el
          periodo por defecto lo excluye.
        </li>
        <li>
          <B>Año en la cuenta de cheques:</B> se toma de la portada. Un periodo que cruce de diciembre
          a enero fecharía mal los renglones de diciembre (no ha pasado todavía).
        </li>
        <li>
          <B>Tarjetas nuevas:</B> si Banamex reexpide una tarjeta con un número que la app no conoce,
          su alias sale "TDC Mensual" hasta que se agreguen sus últimos 4 dígitos al código.
        </li>
        <li>
          <B>Filas viejas</B> tras reprocesar un PDF no se borran solas (ver "Sincronización").
        </li>
        <li>
          <B>Ediciones del tablero</B> no sobreviven a re-sincronizar el mismo PDF (ver "Lo que se
          puede editar").
        </li>
        <li>
          <B>Coincidencia correo ↔ estado de cuenta</B> es una pista por monto y fecha, no una
          conciliación.
        </li>
        <li>
          <B>Comercio opcional:</B> recurrentes, suscripciones y la gráfica por comercio solo ven lo
          que una regla etiqueta con comercio.
        </li>
        <li>
          <B>Fuentes externas no oficiales:</B> si Yahoo o FRED cambian, solo la pestaña QQQ / TQQQ
          muestra un error; tus finanzas no se ven afectadas.
        </li>
      </Lista>
    ),
  },
  {
    id: "glosario",
    grupo: "Operación",
    titulo: "Glosario",
    cuerpo: (
      <TablaWiki
        encabezados={["Término", "Significado"]}
        filas={[
          ["Abono", "Movimiento que suma: ingreso, transferencia recibida, pago a la tarjeta, devolución."],
          ["Cargo", "Movimiento que resta: compra, comisión, retiro, pago enviado."],
          ["TDC", "Tarjeta de crédito."],
          ["Pago TDC", "El pago de una tarjeta desde otra cuenta; excluido por defecto para no contarlo dos veces."],
          ["linea_cruda", "El texto exacto del renglón del PDF; con la página, identifica a la transacción."],
          ["Hash del PDF", "Huella del archivo: el mismo PDF siempre da el mismo hash, así se detecta si ya se cargó."],
          ["RLS", "Row Level Security: reglas de Postgres que solo te dejan ver y tocar tus filas."],
          ["Upsert", "Insertar o, si ya existe con esa clave, actualizar. Evita duplicados."],
          ["Periodo", "Los meses sobre los que se calcula una pestaña."],
          ["Filtro por clic", "Aislar una opción haciendo clic en una gráfica o fila; solo afecta el detalle."],
          ["Excluir", "Quitar categorías o eventos de todo el análisis."],
          ["Evento", "Etiqueta para agrupar gastos de un viaje, fiesta, etc."],
          ["Gasto hormiga", "Cargos pequeños (< $200) que juntos pesan."],
          ["SMA / EMA", "Promedio móvil simple / exponencial de precios."],
          ["ATR", "Rango verdadero promedio: cuánto se mueve el precio en un día típico."],
          ["FRED", "Base de datos económica de la Fed de St. Louis."],
        ]}
      />
    ),
  },
];

/** Texto plano de un nodo de React (para el buscador): recorre los hijos de
 * los elementos sin dibujar nada. Los componentes de `piezas.tsx` reciben su
 * texto como `children`, así que también se encuentra. */
export function textoDe(nodo: ReactNode): string {
  if (nodo === null || nodo === undefined || typeof nodo === "boolean") return "";
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join(" ");
  if (typeof nodo === "object" && "props" in nodo) {
    const props = nodo.props as Record<string, unknown>;
    const partes = [textoDe(props.children as ReactNode)];
    for (const clave of ["titulo", "nombre", "detalle", "donde"]) {
      if (typeof props[clave] === "string") partes.push(props[clave] as string);
    }
    if (Array.isArray(props.encabezados)) partes.push((props.encabezados as string[]).join(" "));
    if (Array.isArray(props.filas)) partes.push(textoDe(props.filas as ReactNode));
    return partes.join(" ");
  }
  return "";
}

/** Sin acentos y en minúsculas, para buscar "periodo" y encontrar "período". */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
