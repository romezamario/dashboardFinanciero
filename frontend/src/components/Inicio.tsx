import { supabase } from "../lib/supabase";
import { ESPACIOS, type DefinicionEspacio, type Espacio } from "../lib/espacios";
import { fechaLarga } from "../lib/formato";
import { BotonTema } from "./BotonTema";

function saludo(hora: number): string {
  if (hora < 12) return "Buenos días";
  if (hora < 19) return "Buenas tardes";
  return "Buenas noches";
}


/** Íconos de línea (24×24, trazo = color del texto) en lugar de emojis: se
 * ven igual en todos los sistemas y respetan el tema claro/oscuro. */
const TRAZOS: Record<string, React.ReactNode> = {
  finanzas: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" />
      <path d="M3 7.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3" />
      <path d="M20 10h-4a2 2 0 0 0 0 4h4a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1Z" />
    </>
  ),
  salud: <path d="M3 12h4l2-5 4 10 2-5h6" />,
  viajes: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </>
  ),
  pendientes: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
};

function Icono({ id }: { id: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TRAZOS[id] ?? <rect x="4" y="4" width="16" height="16" rx="3" />}
    </svg>
  );
}

function TarjetaEspacio({ espacio, onAbrir }: { espacio: DefinicionEspacio; onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="group flex h-full w-full items-start gap-4 rounded-xl p-5 text-left transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        outlineColor: "var(--marca)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "color-mix(in srgb, var(--marca) 45%, var(--border))")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: "color-mix(in srgb, var(--marca) 12%, transparent)",
          color: "var(--marca)",
        }}
      >
        <Icono id={espacio.id} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {espacio.nombre}
        </span>
        <span className="mt-1 block text-sm leading-snug" style={{ color: "var(--text-secondary)" }}>
          {espacio.descripcion}
        </span>
      </span>
      <span
        className="mt-0.5 shrink-0 text-lg leading-none transition-transform duration-150 group-hover:translate-x-0.5"
        style={{ color: "var(--text-muted)" }}
        aria-hidden="true"
      >
        →
      </span>
    </button>
  );
}

function FilaProximamente({ espacio }: { espacio: DefinicionEspacio }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md" style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
        <Icono id={espacio.id} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {espacio.nombre}
        </span>
        <span className="block truncate text-xs" style={{ color: "var(--text-muted)" }}>
          {espacio.descripcion}
        </span>
      </span>
    </li>
  );
}

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
      {children}
    </h2>
  );
}

/** Página de inicio del dashboard personal: los espacios disponibles como
 * tarjetas y, aparte, una lista discreta de los que vienen. */
export function Inicio({ onAbrir }: { onAbrir: (espacio: Espacio) => void }) {
  const ahora = new Date();
  const disponibles = ESPACIOS.filter((e) => e.disponible);
  const proximos = ESPACIOS.filter((e) => !e.disponible);

  return (
    <div style={{ background: "var(--page-plane)", minHeight: "100vh" }}>
      <header style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <span className="text-sm font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Mi dashboard
          </span>
          <div className="flex items-center gap-1 sm:gap-3">
            <BotonTema soloIconoEnMovil />
            <button
              onClick={() => supabase.auth.signOut()}
              className="h-9 whitespace-nowrap rounded-full px-3 text-xs sm:h-auto sm:py-1"
              style={{ color: "var(--text-secondary)" }}
            >
              <span className="sm:hidden">Salir</span>
              <span className="hidden sm:inline">Cerrar sesión</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
        <p className="text-sm first-letter:uppercase" style={{ color: "var(--text-muted)" }}>
          {fechaLarga.format(ahora)}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: "var(--text-primary)" }}>
          {saludo(ahora.getHours())}
        </h1>

        <section className="mt-10">
          <Titulo>Espacios</Titulo>
          <ul className="grid gap-3 sm:grid-cols-2">
            {disponibles.map((espacio) => (
              <li key={espacio.id}>
                <TarjetaEspacio espacio={espacio} onAbrir={() => onAbrir(espacio.id)} />
              </li>
            ))}
          </ul>
        </section>

        {proximos.length > 0 && (
          <section className="mt-10">
            <Titulo>Próximamente</Titulo>
            <ul
              className="divide-y divide-[var(--border)] overflow-hidden rounded-xl"
              style={{ border: "1px solid var(--border)", background: "var(--surface-1)" }}
            >
              {proximos.map((espacio) => (
                <FilaProximamente key={espacio.id} espacio={espacio} />
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
