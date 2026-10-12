import { useState, type ReactNode } from "react";
import { descargarPlantilla } from "../lib/importar/plantillaExcel";

// Las dos maneras de subir movimientos en "Subir estado de cuenta", como dos
// tarjetas lado a lado (una sobre otra en el celular): el PDF del banco y la
// plantilla de Excel. Solo presentación: qué hacer con cada archivo lo decide
// SubirEstadoCuenta (`onArchivos`).

const ACEPTA_PDF = "application/pdf,.pdf";
const ACEPTA_TABLA = ".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const BANCOS = ["Banamex cheques", "Banamex tarjetas de crédito", "Invex tarjeta de crédito"];

/** Fondo suave del color de la tarjeta (se ve bien en claro y oscuro). */
const tenue = (color: string, porcentaje = 14) => `color-mix(in srgb, ${color} ${porcentaje}%, transparent)`;

export function OpcionesSubida({ onArchivos }: { onArchivos: (archivos: File[]) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Sube tus movimientos
        </h2>
        <p className="mt-1 flex items-start gap-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
          <IconoCandado />
          <span>
            Tus archivos se leen aquí mismo, en tu navegador: no se suben a ningún lado y solo guardamos los
            movimientos.
          </span>
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Opcion
          color="var(--series-1)"
          icono={<IconoPdf />}
          etiqueta="Más rápido"
          titulo="Estado de cuenta en PDF"
          descripcion="El que descargas de tu banca en línea. Leemos los movimientos por ti."
        >
          <div>
            <p className="mb-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              Bancos que ya leemos
            </p>
            <div className="flex flex-wrap gap-1.5">
              {BANCOS.map((b) => (
                <span
                  key={b}
                  className="rounded-full px-2.5 py-1 text-xs"
                  style={{ background: tenue("var(--series-1)"), color: "var(--text-primary)" }}
                >
                  {b}
                </span>
              ))}
            </div>
          </div>
          <ZonaArchivos
            color="var(--series-1)"
            acepta={ACEPTA_PDF}
            texto="Elegir PDF"
            ayuda="o arrástralo aquí · puedes elegir varios"
            onArchivos={onArchivos}
          />
        </Opcion>

        <Opcion
          color="var(--status-good)"
          icono={<IconoExcel />}
          etiqueta="Cualquier banco"
          titulo="Plantilla de Excel"
          descripcion="Para otros bancos, efectivo o lo que quieras capturar tú."
        >
          <ol className="space-y-2">
            <Paso numero={1} color="var(--status-good)">
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                style={{ color: "var(--status-good)" }}
                onClick={() => void descargarPlantilla()}
              >
                Descarga la plantilla
              </button>
            </Paso>
            <Paso numero={2} color="var(--status-good)">
              Llénala: fecha, descripción y monto
            </Paso>
            <Paso numero={3} color="var(--status-good)">
              Súbela aquí (.xlsx o .csv)
            </Paso>
          </ol>
          <ZonaArchivos
            color="var(--status-good)"
            acepta={ACEPTA_TABLA}
            texto="Elegir Excel o CSV"
            ayuda="o arrástralo aquí"
            onArchivos={onArchivos}
          />
        </Opcion>
      </div>
    </div>
  );
}

function Opcion({
  color,
  icono,
  etiqueta,
  titulo,
  descripcion,
  children,
}: {
  color: string;
  icono: ReactNode;
  etiqueta: string;
  titulo: string;
  descripcion: string;
  children: ReactNode;
}) {
  return (
    <section className="tarjeta flex flex-col gap-4 rounded-xl p-5" style={{ borderTop: `3px solid ${color}` }}>
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
          style={{ background: tenue(color), color }}
          aria-hidden
        >
          {icono}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              {titulo}
            </h3>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{ background: tenue(color), color }}
            >
              {etiqueta}
            </span>
          </div>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            {descripcion}
          </p>
        </div>
      </div>
      {/* La zona para elegir archivo queda siempre abajo, alineada en las dos tarjetas. */}
      <div className="flex flex-1 flex-col justify-between gap-4">{children}</div>
    </section>
  );
}

function Paso({ numero, color, children }: { numero: number; color: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-sm" style={{ color: "var(--text-primary)" }}>
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{ background: tenue(color), color }}
      >
        {numero}
      </span>
      <span>{children}</span>
    </li>
  );
}

function ZonaArchivos({
  color,
  acepta,
  texto,
  ayuda,
  onArchivos,
}: {
  color: string;
  acepta: string;
  texto: string;
  ayuda: string;
  onArchivos: (archivos: File[]) => void;
}) {
  const [encima, setEncima] = useState(false);
  return (
    <label
      className="flex cursor-pointer flex-col items-center gap-1 rounded-lg px-4 py-5 text-center transition-colors"
      style={{
        border: `1.5px dashed ${encima ? color : "var(--border)"}`,
        background: encima ? tenue(color, 10) : "var(--page-plane)",
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setEncima(true);
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => {
        e.preventDefault();
        setEncima(false);
        onArchivos(Array.from(e.dataTransfer.files));
      }}
    >
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
        style={{ background: color, color: "white" }}
      >
        <IconoSubir />
        {texto}
      </span>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {ayuda}
      </span>
      <input
        type="file"
        accept={acepta}
        multiple
        className="sr-only"
        onChange={(e) => {
          onArchivos(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </label>
  );
}

const trazo = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function IconoPdf() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" {...trazo}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

function IconoExcel() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" {...trazo}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 10h16M4 15h16M10 4v16" />
    </svg>
  );
}

function IconoSubir() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...trazo} aria-hidden>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function IconoCandado() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...trazo} className="mt-0.5 shrink-0" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
