import { useState } from "react";
import { ahorroAnual, DIAS_PRUEBA, PLANES, precioPorMes, type Periodo, type Plan } from "../lib/planes";
import { NOMBRE_APP } from "../lib/edicion";

// Página de inicio pública de FinanzasPersonales (solo en la edición
// "producto"; la personal sigue entrando directo al Login). Sin enrutador:
// App la muestra mientras no hay sesión y `onEntrar` cambia al Login.

interface Props {
  onEntrar: () => void;
}

const PASOS = [
  {
    titulo: "Sube tu estado de cuenta",
    texto: "El PDF de tu banco o un CSV. Se lee en tu navegador: el archivo nunca sale de tu dispositivo.",
  },
  {
    titulo: "Revisa y categoriza",
    texto: "Ves cada movimiento antes de guardarlo. Tus reglas lo ordenan solo: «OXXO» es Comida, «TELEVIA» es Transporte.",
  },
  {
    titulo: "Entiende a dónde va tu dinero",
    texto: "Tasa de ahorro, gasto por categoría y comercio, tarjetas comparadas y tu gasto diario contra tu meta.",
  },
];

const FUNCIONES = [
  { icono: "📊", titulo: "Tu tasa de ahorro", texto: "Cuánto de lo que ganas te queda cada mes, y si vas mejor o peor que el periodo anterior." },
  { icono: "🐜", titulo: "Gasto hormiga", texto: "Los cargos chicos que solos no se notan y juntos sí: cafés, apps, comisiones." },
  { icono: "💳", titulo: "Tarjetas comparadas", texto: "Cuánto gastas con cada tarjeta y para qué usas cada una." },
  { icono: "📅", titulo: "Calendario y meta diaria", texto: "Cada día con su gasto y un semáforo semanal contra la meta que tú pones." },
  { icono: "✈️", titulo: "Eventos", texto: "Separa un viaje o un proyecto para saber cuánto costó sin que ensucie tu mes." },
  { icono: "🔔", titulo: "Alertas", texto: "Cargos posiblemente duplicados, suscripciones que subieron de precio y cargos fuera de lo normal." },
];

const PREGUNTAS = [
  {
    pregunta: "¿Necesito dar la contraseña de mi banco?",
    respuesta: "No. Nunca te pedimos acceso a tu banca en línea. Tú descargas tu estado de cuenta y lo subes.",
  },
  {
    pregunta: "¿Qué pasa con mis PDFs?",
    respuesta: "Se leen dentro de tu navegador. Solo se guardan los movimientos ya normalizados (fecha, descripción, monto, categoría), y los números de cuenta se guardan con sus últimos 4 dígitos.",
  },
  {
    pregunta: "¿Qué bancos funcionan?",
    respuesta: "Para empezar, Banamex (cuenta de cheques y tarjetas de crédito) e Invex. Cualquier otro banco entra con un archivo CSV o Excel.",
  },
  {
    pregunta: "¿Puedo cancelar cuando quiera?",
    respuesta: "Sí, desde Mi cuenta. Si bajas de plan no se borra nada: tus datos se conservan y vuelven a verse si regresas.",
  },
  {
    pregunta: "¿Cómo pago?",
    respuesta: "Con Mercado Pago, con tarjeta o con tu saldo. El plan anual cuesta 10 meses y te da 12.",
  },
];

export function Landing({ onEntrar }: Props) {
  return (
    <div className="min-h-screen" style={{ background: "var(--page-plane)", color: "var(--text-primary)" }}>
      <Encabezado onEntrar={onEntrar} />
      <main>
        <Portada onEntrar={onEntrar} />
        <ComoFunciona />
        <Funciones />
        <Privacidad />
        <Precios onEntrar={onEntrar} />
        <Preguntas />
        <LlamadoFinal onEntrar={onEntrar} />
      </main>
      <Pie />
    </div>
  );
}

function Contenedor({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

function Logo() {
  return (
    <span className="flex items-center gap-2 font-semibold">
      <span
        aria-hidden
        className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold text-white"
        style={{ background: "var(--series-1)" }}
      >
        $
      </span>
      {NOMBRE_APP}
    </span>
  );
}

function BotonPrincipal({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
      style={{ background: "var(--series-1)" }}
    >
      {children}
    </button>
  );
}

function Encabezado({ onEntrar }: Props) {
  return (
    <header style={{ borderBottom: "1px solid var(--border)" }}>
      <Contenedor className="flex h-14 items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-4 text-sm">
          <a href="#precios" className="hidden sm:inline" style={{ color: "var(--text-secondary)" }}>
            Precios
          </a>
          <a href="#preguntas" className="hidden sm:inline" style={{ color: "var(--text-secondary)" }}>
            Preguntas
          </a>
          <button
            type="button"
            onClick={onEntrar}
            className="rounded-md px-3 py-1.5 font-medium"
            style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
          >
            Entrar
          </button>
        </nav>
      </Contenedor>
    </header>
  );
}

function Portada({ onEntrar }: Props) {
  return (
    <section>
      <Contenedor className="grid items-center gap-10 py-14 md:grid-cols-2 md:py-20">
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--series-1)" }}>
            Tus finanzas, claras y en pesos
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Descubre a dónde se va tu dinero cada mes
          </h1>
          <p className="mt-4 text-lg" style={{ color: "var(--text-secondary)" }}>
            Sube tus estados de cuenta y {NOMBRE_APP} te muestra en qué gastas, cuánto ahorras y qué
            cargos revisar. Sin conectar tu banco y sin capturar a mano.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <BotonPrincipal onClick={onEntrar}>Empieza gratis</BotonPrincipal>
            <a href="#precios" className="px-2 py-3 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
              Ver precios →
            </a>
          </div>
          <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
            Desde MXN 29 al mes · {DIAS_PRUEBA} días de Básico gratis, sin tarjeta
          </p>
        </div>
        <VistaPrevia />
      </Contenedor>
    </section>
  );
}

// Una muestra del tablero hecha con HTML (no una captura): números de
// ejemplo, colores de la paleta del tablero (azul = ingresos, naranja = gastos).
const MESES_EJEMPLO = [
  { mes: "may", ingreso: 78, gasto: 64 },
  { mes: "jun", ingreso: 80, gasto: 71 },
  { mes: "jul", ingreso: 78, gasto: 58 },
  { mes: "ago", ingreso: 84, gasto: 62 },
  { mes: "sep", ingreso: 80, gasto: 55 },
];

const CATEGORIAS_EJEMPLO = [
  { nombre: "Supermercado", monto: "$6,240", ancho: 100 },
  { nombre: "Restaurantes", monto: "$3,910", ancho: 63 },
  { nombre: "Transporte", monto: "$2,480", ancho: 40 },
  { nombre: "Suscripciones", monto: "$1,120", ancho: 18 },
];

function VistaPrevia() {
  return (
    <div className="tarjeta rounded-2xl p-5 shadow-sm" aria-label="Ejemplo del tablero con datos ficticios" role="img">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Tasa de ahorro · septiembre</p>
          <p className="mt-1 text-3xl font-bold">31%</p>
          <p className="text-xs font-medium" style={{ color: "var(--status-good)" }}>▲ 6 pts vs. agosto</p>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Gasto hormiga</p>
          <p className="mt-1 text-lg font-semibold">$1,486</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>63 cargos menores a $200</p>
        </div>
      </div>

      <div className="mt-5 flex h-28 items-end justify-between gap-3 px-1" style={{ borderBottom: "1px solid var(--baseline)" }}>
        {MESES_EJEMPLO.map((m) => (
          <div key={m.mes} className="flex flex-1 flex-col items-center">
            <div className="flex h-24 w-full items-end justify-center gap-1">
              <div className="w-1/3 rounded-t-sm" style={{ height: `${m.ingreso}%`, background: "var(--series-1)" }} />
              <div className="w-1/3 rounded-t-sm" style={{ height: `${m.gasto}%`, background: "var(--series-2)" }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between gap-3 px-1">
        {MESES_EJEMPLO.map((m) => (
          <span key={m.mes} className="flex-1 text-center text-xs" style={{ color: "var(--text-muted)" }}>{m.mes}</span>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm" style={{ background: "var(--series-1)" }} />Ingresos</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm" style={{ background: "var(--series-2)" }} />Gastos</span>
      </div>

      <p className="mt-5 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Gasto por categoría</p>
      <ul className="mt-2 space-y-2">
        {CATEGORIAS_EJEMPLO.map((c) => (
          <li key={c.nombre} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 text-xs">
            <span style={{ color: "var(--text-secondary)" }}>{c.nombre}</span>
            <span className="h-2 rounded-full" style={{ background: "var(--gridline)" }}>
              <span className="block h-2 rounded-full" style={{ width: `${c.ancho}%`, background: "var(--series-1)" }} />
            </span>
            <span className="text-right tabular-nums">{c.monto}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 rounded-lg p-3 text-xs" style={{ background: "var(--page-plane)", border: "1px solid var(--border)" }}>
        <span className="font-semibold" style={{ color: "var(--series-2)" }}>⚠ Revisar:</span>{" "}
        <span style={{ color: "var(--text-secondary)" }}>tu suscripción de streaming subió de $219 a $249.</span>
      </div>
    </div>
  );
}

function Titulo({ etiqueta, titulo, texto }: { etiqueta: string; titulo: string; texto?: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-medium" style={{ color: "var(--series-1)" }}>{etiqueta}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight">{titulo}</h2>
      {texto && <p className="mt-3" style={{ color: "var(--text-secondary)" }}>{texto}</p>}
    </div>
  );
}

function Seccion({ id, children, alterna = false }: { id?: string; children: React.ReactNode; alterna?: boolean }) {
  return (
    <section
      id={id}
      className="scroll-mt-4 py-16"
      style={alterna ? { background: "var(--surface-1)", borderBlock: "1px solid var(--border)" } : undefined}
    >
      <Contenedor>{children}</Contenedor>
    </section>
  );
}

function ComoFunciona() {
  return (
    <Seccion alterna>
      <Titulo etiqueta="Cómo funciona" titulo="Tres pasos, una vez al mes" />
      <ol className="mt-10 grid gap-6 md:grid-cols-3">
        {PASOS.map((paso, i) => (
          <li key={paso.titulo}>
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ background: "var(--series-1)" }}
            >
              {i + 1}
            </span>
            <h3 className="mt-3 font-semibold">{paso.titulo}</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{paso.texto}</p>
          </li>
        ))}
      </ol>
    </Seccion>
  );
}

function Funciones() {
  return (
    <Seccion>
      <Titulo
        etiqueta="Qué te muestra"
        titulo="Lo que tu banco no te dice"
        texto="El mismo tablero que ya se usa todos los días para llevar unas finanzas reales, ahora para ti."
      />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FUNCIONES.map((f) => (
          <div key={f.titulo} className="tarjeta rounded-xl p-5">
            <span aria-hidden className="text-2xl">{f.icono}</span>
            <h3 className="mt-3 font-semibold">{f.titulo}</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{f.texto}</p>
          </div>
        ))}
      </div>
    </Seccion>
  );
}

const GARANTIAS = [
  { titulo: "Tus PDFs no salen de tu dispositivo", texto: "Se leen en tu navegador; a nuestros servidores solo llegan los movimientos." },
  { titulo: "Sin acceso a tu banco", texto: "No pedimos usuario ni contraseña de tu banca en línea." },
  { titulo: "Números de cuenta enmascarados", texto: "Guardamos los últimos 4 dígitos, nunca el número completo." },
  { titulo: "Nadie más ve tus datos", texto: "Cada fila está protegida en la base de datos para que solo tu sesión la lea." },
];

function Privacidad() {
  return (
    <Seccion alterna>
      <div className="grid gap-10 md:grid-cols-[1fr_1.4fr] md:items-start">
        <Titulo
          etiqueta="Privacidad"
          titulo="Tu información es tuya"
          texto="Diseñado desde el inicio para guardar lo mínimo: lo necesario para mostrarte tus gráficas y nada más."
        />
        <ul className="grid gap-4 sm:grid-cols-2">
          {GARANTIAS.map((g) => (
            <li key={g.titulo} className="flex gap-3">
              <span aria-hidden className="mt-0.5 font-bold" style={{ color: "var(--status-good)" }}>✓</span>
              <div>
                <h3 className="font-semibold">{g.titulo}</h3>
                <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{g.texto}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Seccion>
  );
}

function pesos(monto: number): string {
  return monto.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: Number.isInteger(monto) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function Precios({ onEntrar }: Props) {
  // El anual va primero a propósito (plan de suscripciones): con la cuota
  // fija de Mercado Pago, un cobro al año baja la comisión de ~19% a ~5%.
  const [periodo, setPeriodo] = useState<Periodo>("anual");
  return (
    <Seccion id="precios">
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <Titulo etiqueta="Precios" titulo="Un precio que cabe en tu presupuesto" texto="Empieza gratis. Paga solo si te sirve." />
        <div
          role="radiogroup"
          aria-label="Periodo de pago"
          className="inline-flex rounded-full p-1 text-sm"
          style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
        >
          {(["anual", "mensual"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={periodo === p}
              onClick={() => setPeriodo(p)}
              className="rounded-full px-4 py-1.5 font-medium"
              style={
                periodo === p
                  ? { background: "var(--series-1)", color: "#fff" }
                  : { color: "var(--text-secondary)" }
              }
            >
              {p === "anual" ? "Anual · 2 meses gratis" : "Mensual"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {PLANES.map((plan) => (
          <TarjetaPlan key={plan.id} plan={plan} periodo={periodo} onEntrar={onEntrar} />
        ))}
      </div>
      <p className="mt-6 text-sm" style={{ color: "var(--text-muted)" }}>
        Precios en pesos mexicanos. Pagas con Mercado Pago y cancelas cuando quieras desde Mi cuenta.
      </p>
    </Seccion>
  );
}

function TarjetaPlan({ plan, periodo, onEntrar }: { plan: Plan; periodo: Periodo; onEntrar: () => void }) {
  const esGratis = plan.precioMensual === 0;
  const porMes = precioPorMes(plan, periodo);
  return (
    <div
      className="tarjeta relative flex flex-col rounded-2xl p-6"
      style={plan.destacado ? { borderColor: "var(--series-1)", borderWidth: 2 } : undefined}
    >
      {plan.destacado && (
        <span
          className="absolute -top-3 left-6 rounded-full px-3 py-0.5 text-xs font-semibold text-white"
          style={{ background: "var(--series-1)" }}
        >
          Recomendado
        </span>
      )}
      <h3 className="text-lg font-semibold">{plan.nombre}</h3>
      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{plan.descripcion}</p>

      <p className="mt-5">
        <span className="text-4xl font-bold tabular-nums">{pesos(porMes)}</span>
        <span className="text-sm" style={{ color: "var(--text-secondary)" }}> /mes</span>
      </p>
      <p className="mt-1 h-5 text-sm" style={{ color: "var(--text-muted)" }}>
        {esGratis
          ? "Para siempre"
          : periodo === "anual"
            ? `${pesos(plan.precioAnual!)} al año · ahorras ${pesos(ahorroAnual(plan))}`
            : "Se cobra cada mes"}
      </p>

      <button
        type="button"
        onClick={onEntrar}
        className="mt-6 rounded-lg py-2.5 text-sm font-semibold"
        style={
          plan.destacado
            ? { background: "var(--series-1)", color: "#fff" }
            : { border: "1px solid var(--border)", color: "var(--text-primary)" }
        }
      >
        {esGratis ? "Empezar gratis" : plan.id === "basico" ? `Probar ${DIAS_PRUEBA} días gratis` : `Elegir ${plan.nombre}`}
      </button>

      <ul className="mt-6 space-y-2 text-sm">
        {plan.incluye.map((linea) => (
          <li key={linea} className="flex gap-2">
            <span aria-hidden style={{ color: "var(--status-good)" }}>✓</span>
            <span style={{ color: "var(--text-secondary)" }}>{linea}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Preguntas() {
  return (
    <Seccion id="preguntas" alterna>
      <Titulo etiqueta="Preguntas frecuentes" titulo="Lo que nos suelen preguntar" />
      <div className="mt-8 max-w-3xl divide-y" style={{ borderColor: "var(--border)" }}>
        {PREGUNTAS.map((p) => (
          <details key={p.pregunta} className="group py-4" style={{ borderColor: "var(--border)" }}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
              {p.pregunta}
              <span aria-hidden className="transition group-open:rotate-45" style={{ color: "var(--text-muted)" }}>+</span>
            </summary>
            <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>{p.respuesta}</p>
          </details>
        ))}
      </div>
    </Seccion>
  );
}

function LlamadoFinal({ onEntrar }: Props) {
  return (
    <Seccion>
      <div className="tarjeta flex flex-col items-start gap-5 rounded-2xl p-8 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Empieza con tu último estado de cuenta</h2>
          <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
            En unos minutos sabes cuánto gastaste y en qué.
          </p>
        </div>
        <BotonPrincipal onClick={onEntrar}>Empieza gratis</BotonPrincipal>
      </div>
    </Seccion>
  );
}

function Pie() {
  return (
    <footer style={{ borderTop: "1px solid var(--border)" }}>
      <Contenedor className="flex flex-col gap-2 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <p style={{ color: "var(--text-muted)" }}>© {new Date().getFullYear()} {NOMBRE_APP} · Hecho en México</p>
      </Contenedor>
    </footer>
  );
}
