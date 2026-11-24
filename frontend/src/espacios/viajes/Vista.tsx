import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MarcoEspacio } from "../../components/MarcoEspacio";
import type { PropsEspacio } from "../../lib/espacios";
import {
  clasificarViajes,
  cuentaRegresiva,
  enlaceBitacora,
  fechaConDia,
  fechaCorta,
  fechasDelViaje,
  formatoMonto,
  gastoPrevisto,
  hoyIso,
  lugaresDelViaje,
  nochesSinAlojamiento,
  normalizarViajes,
  pendientesDeLista,
  planDelDia,
  proximosTickets,
  rangoFechas,
  resumenDelAnio,
  type Ticket,
  type Viaje,
} from "./viajes";

// La bitácora (repo GestionViajes) se usa dentro de este mismo sitio, en /viajes/:
// functions/viajes/[[ruta]].ts la sirve desde su proyecto de Pages. Misma pestaña,
// misma dirección y el mismo Cloudflare Access.
const BITACORA = "/viajes";

type Carga =
  | { estado: "cargando" }
  | { estado: "error"; mensaje: string; bitacora: string }
  | { estado: "listo"; viajes: Viaje[]; bitacora: string };

async function obtenerViajes(): Promise<Carga> {
  try {
    const r = await fetch("/api/viajes", { headers: { accept: "application/json" } });
    const tipo = r.headers.get("content-type") ?? "";
    if (!tipo.includes("application/json")) {
      return { estado: "error", mensaje: `El servidor respondió ${r.status} sin datos.`, bitacora: BITACORA };
    }
    const datos = (await r.json()) as { viajes?: Record<string, unknown>; error?: string; bitacora?: string };
    const bitacora = BITACORA;
    if (!r.ok) return { estado: "error", mensaje: datos.error || `Error ${r.status}.`, bitacora };
    return { estado: "listo", viajes: normalizarViajes(datos.viajes), bitacora };
  } catch (e) {
    return { estado: "error", mensaje: (e as Error).message, bitacora: BITACORA };
  }
}

function Tarjeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`tarjeta rounded-xl p-4 sm:p-5 ${className}`}>{children}</section>;
}

function Titulo({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
      {children}
    </h2>
  );
}

function Enlace({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-xs font-medium whitespace-nowrap" style={{ color: "var(--marca)" }}>
      {children}
    </a>
  );
}

function Pildora({ children, tono = "neutro" }: { children: ReactNode; tono?: "neutro" | "marca" | "aviso" }) {
  const estilos = {
    neutro: { background: "var(--page-plane)", color: "var(--text-secondary)", border: "1px solid var(--border)" },
    marca: { background: "color-mix(in srgb, var(--marca) 12%, transparent)", color: "var(--marca)", border: "1px solid transparent" },
    aviso: { background: "color-mix(in srgb, var(--status-critical) 10%, transparent)", color: "var(--text-primary)", border: "1px solid color-mix(in srgb, var(--status-critical) 35%, transparent)" },
  }[tono];
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap" style={estilos}>
      {children}
    </span>
  );
}

function Dato({ valor, etiqueta }: { valor: ReactNode; etiqueta: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-base font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
        {valor}
      </div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {etiqueta}
      </div>
    </div>
  );
}

function textoTicket(k: Ticket): string {
  const ruta = k.from || k.to ? ` · ${k.from || "?"} → ${k.to || "?"}` : "";
  return `${k.kind ? `${k.kind}: ` : ""}${k.title}${ruta}`;
}

function FilaTicket({ k, conFecha = true }: { k: Ticket; conFecha?: boolean }) {
  return (
    <li className="flex gap-3 text-sm">
      <span className="w-24 shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>
        {conFecha && k.date ? fechaCorta(k.date) : ""} {k.time ?? ""}
      </span>
      <span className="min-w-0" style={{ color: "var(--text-primary)" }}>
        {textoTicket(k)}
        {k.code ? <span style={{ color: "var(--text-muted)" }}> · {k.code}</span> : null}
      </span>
    </li>
  );
}

/** El viaje en curso: qué toca hoy, dónde se duerme y los traslados del día. */
function ViajeEnCurso({ v, hoy, bitacora }: { v: Viaje; hoy: string; bitacora: string }) {
  const plan = planDelDia(v, hoy);
  const manana = planDelDia(v, fechasDelViaje(v).find((f) => f > hoy) ?? "");
  return (
    <Tarjeta>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pildora tono="marca">De viaje · {cuentaRegresiva(v, hoy)}</Pildora>
          </div>
          <h3 className="mt-2 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {v.name}
          </h3>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {[v.destination, rangoFechas(v)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Enlace href={enlaceBitacora(bitacora, v.id)}>Abrir en la bitácora</Enlace>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <Titulo>Hoy{plan.titulo ? ` · ${plan.titulo}` : ""}</Titulo>
          {plan.lugares.length === 0 && plan.tickets.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Nada planeado para hoy.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {[
                ...plan.tickets.map((k) => ({ hora: k.time ?? "", texto: textoTicket(k), detalle: k.code, hecho: false })),
                ...plan.lugares.map((l) => ({ hora: l.time ?? "", texto: l.name, detalle: l.category, hecho: !!l.done })),
              ]
                .sort((a, b) => (a.hora || "99").localeCompare(b.hora || "99"))
                .map((x, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="w-14 shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {x.hora}
                    </span>
                    <span className="min-w-0" style={{ color: x.hecho ? "var(--text-muted)" : "var(--text-primary)", textDecoration: x.hecho ? "line-through" : undefined }}>
                      {x.texto}
                      {x.detalle ? <span style={{ color: "var(--text-muted)" }}> · {x.detalle}</span> : null}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <div className="space-y-4">
          <div>
            <Titulo>Esta noche</Titulo>
            {plan.alojamiento ? (
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                {plan.alojamiento.name}
                {plan.alojamiento.address ? <span className="block text-xs" style={{ color: "var(--text-muted)" }}>{plan.alojamiento.address}</span> : null}
              </p>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {hoy === v.end ? "Último día: regreso a casa." : "Sin alojamiento registrado."}
              </p>
            )}
          </div>
          {manana.lugares.length + manana.tickets.length > 0 ? (
            <div>
              <Titulo>Mañana{manana.titulo ? ` · ${manana.titulo}` : ""}</Titulo>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {[...manana.tickets.map(textoTicket), ...manana.lugares.map((l) => l.name)].slice(0, 4).join(" · ")}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </Tarjeta>
  );
}

function TarjetaViaje({ v, hoy, bitacora }: { v: Viaje; hoy: string; bitacora: string }) {
  const sinNoche = nochesSinAlojamiento(v);
  const pendientes = pendientesDeLista(v);
  const tickets = proximosTickets(v, hoy, 3);
  const gasto = gastoPrevisto(v);
  const dias = fechasDelViaje(v).length;
  return (
    <Tarjeta>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Pildora tono="marca">{cuentaRegresiva(v, hoy)}</Pildora>
          <h3 className="mt-2 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {v.name}
          </h3>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {[v.destination, rangoFechas(v), v.travelers].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Enlace href={enlaceBitacora(bitacora, v.id)}>Abrir</Enlace>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Dato valor={dias || "—"} etiqueta={dias === 1 ? "día" : "días"} />
        <Dato valor={lugaresDelViaje(v)} etiqueta="lugares" />
        <Dato valor={`${v.lodging.length} · ${v.tickets.length}`} etiqueta="alojamientos · tickets" />
        <Dato valor={gasto ? formatoMonto(gasto, v.currency) : "—"} etiqueta="gasto previsto" />
      </div>

      {sinNoche.length > 0 || pendientes > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {sinNoche.length > 0 ? (
            <Pildora tono="aviso">
              ⚠ {sinNoche.length === 1 ? `Noche del ${fechaCorta(sinNoche[0])} sin alojamiento` : `${sinNoche.length} noches sin alojamiento`}
            </Pildora>
          ) : null}
          {pendientes > 0 ? <Pildora>☐ {pendientes} pendiente{pendientes === 1 ? "" : "s"} en la lista</Pildora> : null}
        </div>
      ) : null}

      {tickets.length > 0 ? (
        <div className="mt-4">
          <Titulo>Próximos traslados y entradas</Titulo>
          <ul className="space-y-1.5">
            {tickets.map((k, i) => (
              <FilaTicket key={i} k={k} />
            ))}
          </ul>
        </div>
      ) : null}
    </Tarjeta>
  );
}

export default function VistaViajes({ onIrAInicio }: PropsEspacio) {
  const [carga, setCarga] = useState<Carga>({ estado: "cargando" });
  const [intento, setIntento] = useState(0);
  const hoy = hoyIso();

  useEffect(() => {
    let vivo = true;
    void obtenerViajes().then((c) => {
      if (vivo) setCarga(c);
    });
    return () => {
      vivo = false;
    };
  }, [intento]);

  const bitacora = carga.estado === "cargando" ? BITACORA : carga.bitacora;
  const viajes = useMemo(() => (carga.estado === "listo" ? carga.viajes : []), [carga]);
  const grupos = useMemo(() => clasificarViajes(viajes, hoy), [viajes, hoy]);
  const anio = Number(hoy.slice(0, 4));
  const resumen = useMemo(() => resumenDelAnio(viajes, anio), [viajes, anio]);

  const acciones = (
    <a
      href={enlaceBitacora(bitacora)}
      className="h-9 whitespace-nowrap rounded-full px-3 text-xs font-medium leading-9 sm:h-auto sm:py-1 sm:leading-normal"
      style={{ background: "var(--marca)", color: "white" }}
    >
      <span className="sm:hidden">Bitácora</span>
      <span className="hidden sm:inline">Abrir bitácora</span>
    </a>
  );

  return (
    <MarcoEspacio titulo="Viajes" onIrAInicio={onIrAInicio} acciones={acciones}>
      {carga.estado === "cargando" ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Cargando tus viajes…
        </p>
      ) : carga.estado === "error" ? (
        <Tarjeta>
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            No se pudieron leer los viajes de la bitácora.
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            {carga.mensaje}
          </p>
          <div className="mt-3 flex gap-4">
            <button className="text-xs font-medium" style={{ color: "var(--marca)" }} onClick={() => { setCarga({ estado: "cargando" }); setIntento((n) => n + 1); }}>
              Reintentar
            </button>
            <Enlace href={enlaceBitacora(bitacora)}>Abrir la bitácora</Enlace>
          </div>
        </Tarjeta>
      ) : viajes.length === 0 ? (
        <Tarjeta>
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Todavía no hay viajes.
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Crea uno en la bitácora (fechas, alojamientos, lugares por día y tickets) y aparecerá aquí.
          </p>
          <div className="mt-3">
            <Enlace href={enlaceBitacora(bitacora)}>Abrir la bitácora</Enlace>
          </div>
        </Tarjeta>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Tarjeta>
              <Dato valor={grupos.proximos[0] ? diasHasta(grupos.proximos[0], hoy) : "—"} etiqueta={grupos.proximos[0] ? `para ${grupos.proximos[0].name}` : "sin viajes próximos"} />
            </Tarjeta>
            <Tarjeta>
              <Dato valor={resumen.viajes} etiqueta={`viaje${resumen.viajes === 1 ? "" : "s"} en ${anio}`} />
            </Tarjeta>
            <Tarjeta>
              <Dato valor={resumen.dias} etiqueta={`días de viaje en ${anio}`} />
            </Tarjeta>
          </div>

          {grupos.enCurso.map((v) => (
            <ViajeEnCurso key={v.id} v={v} hoy={hoy} bitacora={bitacora} />
          ))}

          {grupos.proximos.length > 0 ? (
            <div>
              <Titulo>Próximos viajes</Titulo>
              <div className="grid gap-4 lg:grid-cols-2">
                {grupos.proximos.map((v) => (
                  <TarjetaViaje key={v.id} v={v} hoy={hoy} bitacora={bitacora} />
                ))}
              </div>
            </div>
          ) : null}

          {grupos.sinFechas.length > 0 ? (
            <div>
              <Titulo>Ideas sin fechas</Titulo>
              <div className="flex flex-wrap gap-2">
                {grupos.sinFechas.map((v) => (
                  <a key={v.id} href={enlaceBitacora(bitacora, v.id)}>
                    <Pildora>{v.name}</Pildora>
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {grupos.pasados.length > 0 ? (
            <Tarjeta>
              <details>
                <summary className="cursor-pointer text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  Viajes anteriores ({grupos.pasados.length})
                </summary>
                <ul className="mt-3 divide-y" style={{ borderColor: "var(--border)" }}>
                  {grupos.pasados.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                      <span className="min-w-0" style={{ color: "var(--text-primary)" }}>
                        {v.name}
                        <span style={{ color: "var(--text-muted)" }}> · {[v.destination, rangoFechas(v)].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="flex items-baseline gap-3">
                        <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {gastoPrevisto(v) ? formatoMonto(gastoPrevisto(v), v.currency) : ""}
                        </span>
                        <Enlace href={enlaceBitacora(bitacora, v.id)}>Abrir</Enlace>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </Tarjeta>
          ) : null}

          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Solo lectura: los viajes se editan en la bitácora. Hoy es {fechaConDia(hoy)}.
          </p>
        </>
      )}
    </MarcoEspacio>
  );
}

function diasHasta(v: Viaje, hoy: string): string {
  const texto = cuentaRegresiva(v, hoy);
  return texto === "Sale mañana" ? "Mañana" : texto.replace(/^Faltan /, "");
}
