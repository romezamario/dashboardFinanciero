import { useState } from "react";
import {
  autenticar,
  bluetoothDisponible,
  conectar,
  leerBateria,
  leerEstadoFuncion,
  leerFirmware,
  normalizarClave,
  type Bateria,
  type Conexion,
  type EstadoFuncion,
  type Firmware,
} from "./anilloBle";
import { guardarBateriaNavegador } from "./salud";

// La clave solo se guarda en ESTE navegador, y solo si la persona lo pide.
const LLAVE_LOCAL = "salud.claveAnillo";
function claveGuardada(): string {
  try {
    return localStorage.getItem(LLAVE_LOCAL) ?? "";
  } catch {
    return "";
  }
}

interface Lectura {
  nombre: string;
  firmware: Firmware | null;
  bateria: Bateria | null;
  hrDiurno: EstadoFuncion | null;
  spo2: EstadoFuncion | null;
}

const modo = (e: EstadoFuncion | null) => (e === null ? "sin respuesta" : e.modo === 1 ? "encendido" : e.modo === 0 ? "apagado" : `modo ${e.modo}`);

/** Prueba de concepto: leer el anillo desde este dispositivo con Web
 * Bluetooth (en iPhone, con el navegador Bluefy). Solo lectura. */
export function LeerAnillo({ onBateria }: { onBateria?: (b: Bateria) => void }) {
  const [clave, setClave] = useState(claveGuardada);
  const [recordar, setRecordar] = useState(() => claveGuardada() !== "");
  const [ocupado, setOcupado] = useState(false);
  const [registro, setRegistro] = useState<string[]>([]);
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!bluetoothDisponible()) {
    return (
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Este navegador no tiene Bluetooth web. <strong>Abre esta página en Bluefy</strong> (iPhone) o en Chrome/Edge de
        escritorio. Chrome y Safari de iPhone no sirven para esto.
      </p>
    );
  }

  const claveValida = normalizarClave(clave);

  async function leer() {
    if (!claveValida) return;
    setOcupado(true);
    setError(null);
    setLectura(null);
    setRegistro([]);
    const anotar = (l: string) => setRegistro((r) => [...r, l]);
    try {
      if (recordar) localStorage.setItem(LLAVE_LOCAL, claveValida);
      else localStorage.removeItem(LLAVE_LOCAL);
    } catch {
      /* sin almacenamiento: se usa solo en esta lectura */
    }
    let con: Conexion | null = null;
    try {
      con = await conectar(anotar);
      const fw = leerFirmware(await con.pedir("0803000000", (r) => r[0] === 0x09));
      anotar(fw ? `Firmware ${fw.firmware} (API ${fw.api})` : "Firmware: respuesta inesperada");
      const auth = await autenticar(con, claveValida);
      if (auth !== "ok") {
        throw new Error(
          auth === "clave-incorrecta"
            ? "El anillo rechazó la clave. Revisa que sea la de datos\\oura.key de la laptop."
            : "El anillo no confirmó la autenticación."
        );
      }
      anotar("Autenticado con tu clave.");
      const bateria = leerBateria(await con.pedir("0c00", (r) => r[0] === 0x0d));
      const estado = (id: number) =>
        con!
          .pedir(`2f0220${id.toString(16).padStart(2, "0")}`, (r) => r[0] === 0x2f && r[2] === 0x21 && r[3] === id)
          .then(leerEstadoFuncion)
          .catch(() => null);
      const hrDiurno = await estado(0x02);
      const spo2 = await estado(0x04);
      setLectura({ nombre: con.nombre, firmware: fw, bateria, hrDiurno, spo2 });
      if (bateria) {
        try {
          await guardarBateriaNavegador(bateria.porcentaje, bateria.cargando);
          onBateria?.(bateria);
          anotar("Batería guardada en tu dashboard.");
        } catch {
          anotar("No se pudo guardar la batería en Supabase (la lectura sí se hizo).");
        }
      }
      anotar("Lectura terminada.");
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      setError(
        /cancel|chosen|No device selected/i.test(mensaje)
          ? "No se eligió ningún anillo."
          : `${mensaje} Si la laptop está sincronizando el anillo, espera a que termine: acepta una sola conexión a la vez.`
      );
    } finally {
      con?.cerrar();
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-xs" style={{ color: "var(--text-secondary)" }}>
        Clave del anillo (32 caracteres, la de <code>datos\oura.key</code> de la laptop)
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          className="mt-1 block w-full rounded-md px-3 py-2 font-mono text-sm"
          style={{ background: "var(--page-plane)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      </label>
      {clave && !claveValida && (
        <p className="text-xs" style={{ color: "var(--status-critical)" }}>
          La clave debe tener 32 caracteres hexadecimales (0-9, a-f).
        </p>
      )}
      <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
        <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
        Recordar la clave en este dispositivo (solo en este navegador; nunca se sube)
      </label>
      <button
        onClick={leer}
        disabled={!claveValida || ocupado}
        className="h-10 rounded-full px-4 text-sm font-medium disabled:opacity-50"
        style={{ background: "var(--marca)", color: "#fff" }}
      >
        {ocupado ? "Leyendo…" : "Conectar y leer"}
      </button>

      {lectura && (
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {[
            ["Anillo", lectura.nombre],
            ["Batería", lectura.bateria ? `${lectura.bateria.porcentaje}%${lectura.bateria.cargando ? " (cargando)" : ""}` : "—"],
            ["Firmware", lectura.firmware?.firmware ?? "—"],
            ["HR diurno / SpO2", `${modo(lectura.hrDiurno)} / ${modo(lectura.spo2)}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md p-2" style={{ background: "var(--page-plane)" }}>
              <dt className="text-xs" style={{ color: "var(--text-muted)" }}>
                {k}
              </dt>
              <dd style={{ color: "var(--text-primary)" }}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {error && (
        <p className="text-sm" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      )}
      {registro.length > 0 && (
        <ol className="space-y-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          {registro.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
