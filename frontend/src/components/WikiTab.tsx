import { useEffect, useMemo, useState } from "react";
import { normalizar, SECCIONES, textoDe, ULTIMA_REVISION } from "../wiki/contenido";

const PREFIJO_ANCLA = "wiki-";

/** Sección indicada en la dirección (#wiki-<id>), si existe. */
function seccionDeLaDireccion(): string | null {
  const id = window.location.hash.replace(`#${PREFIJO_ANCLA}`, "");
  return SECCIONES.some((s) => s.id === id) ? id : null;
}

/**
 * Pestaña "Wiki": cómo está hecho el tablero, de dónde sale cada dato y qué
 * reglas deciden lo que se ve. Índice por grupos a la izquierda (lista
 * desplegable en el teléfono), buscador de texto completo y una sección a la
 * vez; cada sección tiene su enlace (#wiki-<id>) para compartirla. El
 * contenido vive en `src/wiki/contenido.tsx`.
 */
export function WikiTab() {
  const [busqueda, setBusqueda] = useState("");
  const [activa, setActiva] = useState<string>(() => seccionDeLaDireccion() ?? SECCIONES[0].id);

  // Texto plano de cada sección, una sola vez, para el buscador.
  const indiceTexto = useMemo(
    () => new Map(SECCIONES.map((s) => [s.id, normalizar(`${s.titulo} ${textoDe(s.cuerpo)}`)])),
    []
  );

  const terminos = normalizar(busqueda).split(/\s+/).filter(Boolean);
  const visibles = SECCIONES.filter((s) => terminos.every((t) => indiceTexto.get(s.id)!.includes(t)));
  const grupos = Array.from(new Set(visibles.map((s) => s.grupo)));
  // Si la búsqueda deja fuera la sección abierta, se muestra la primera que coincide.
  const seccion = visibles.find((s) => s.id === activa) ?? visibles[0];

  function abrir(id: string) {
    setActiva(id);
    // replaceState: el ancla queda en la dirección para compartirla, sin llenar
    // el historial ni saltar la página.
    try {
      window.history.replaceState(null, "", `#${PREFIJO_ANCLA}${id}`);
    } catch {
      // Algunos navegadores lo bloquean en contextos especiales; no es grave.
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    const alCambiar = () => {
      const id = seccionDeLaDireccion();
      if (id) setActiva(id);
    };
    window.addEventListener("hashchange", alCambiar);
    return () => window.removeEventListener("hashchange", alCambiar);
  }, []);

  const posicion = seccion ? visibles.indexOf(seccion) : -1;
  const anterior = posicion > 0 ? visibles[posicion - 1] : null;
  const siguiente = posicion >= 0 && posicion < visibles.length - 1 ? visibles[posicion + 1] : null;

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <aside className="md:sticky md:top-4 md:w-60 md:shrink-0">
        <div className="tarjeta flex flex-col gap-3 p-3">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en la wiki…"
            aria-label="Buscar en la wiki"
            className="w-full rounded-md px-2.5 py-1.5 text-sm"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          />
          {busqueda && (
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {visibles.length === 0
                ? "Ninguna sección contiene eso."
                : `${visibles.length} ${visibles.length === 1 ? "sección" : "secciones"}`}
            </div>
          )}

          {/* Teléfono: lista desplegable en vez del índice completo. */}
          {seccion && (
            <select
              className="w-full rounded-md px-2 py-1.5 text-sm md:hidden"
              style={{
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
              value={seccion.id}
              onChange={(e) => abrir(e.target.value)}
              aria-label="Sección"
            >
              {grupos.map((grupo) => (
                <optgroup key={grupo} label={grupo}>
                  {visibles
                    .filter((s) => s.grupo === grupo)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.titulo}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          )}

          <nav className="hidden flex-col gap-3 md:flex" aria-label="Índice de la wiki">
            {grupos.map((grupo) => (
              <div key={grupo}>
                <div
                  className="mb-1 text-xs font-medium uppercase tracking-wide"
                  style={{ color: "var(--text-muted)" }}
                >
                  {grupo}
                </div>
                <ul className="flex flex-col">
                  {visibles
                    .filter((s) => s.grupo === grupo)
                    .map((s) => {
                      const elegida = s.id === seccion?.id;
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => abrir(s.id)}
                            aria-current={elegida ? "page" : undefined}
                            className="w-full rounded px-2 py-1 text-left text-sm"
                            style={{
                              background: elegida ? "var(--series-1)" : "transparent",
                              color: elegida ? "#ffffff" : "var(--text-secondary)",
                            }}
                          >
                            {s.titulo}
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <article className="tarjeta min-w-0 flex-1 p-4 md:p-6">
        {seccion ? (
          <>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {seccion.grupo}
            </div>
            <h2 className="mb-4 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              {seccion.titulo}
            </h2>
            <div className="flex flex-col gap-3">{seccion.cuerpo}</div>
            <div
              className="mt-6 flex flex-wrap justify-between gap-2 pt-3 text-sm"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              {anterior ? (
                <button type="button" onClick={() => abrir(anterior.id)} style={{ color: "var(--series-1)" }}>
                  ← {anterior.titulo}
                </button>
              ) : (
                <span />
              )}
              {siguiente && (
                <button type="button" onClick={() => abrir(siguiente.id)} style={{ color: "var(--series-1)" }}>
                  {siguiente.titulo} →
                </button>
              )}
            </div>
            <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              Última revisión de la wiki: {ULTIMA_REVISION}.
            </p>
          </>
        ) : (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Ninguna sección contiene "{busqueda}". Prueba con otra palabra.
          </p>
        )}
      </article>
    </div>
  );
}
