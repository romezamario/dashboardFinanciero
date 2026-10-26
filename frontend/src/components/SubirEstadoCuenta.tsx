import { useEffect, useState, type ReactNode } from "react";
import { deCentavos } from "../lib/importar/comun";
import { enviarMuestra, guardarImportacion, type MuestraParaEnviar } from "../lib/importar/guardar";
import { huellaArchivo, leerPaginasPdf, PdfConContrasena } from "../lib/importar/leerPdf";
import { detectarLector, periodo, procesarPaginas, totales, type ResultadoImportacion } from "../lib/importar/procesar";
import { categorizar } from "../lib/importar/reglasBase";
import { fechaCorta, monedaConCentavos } from "../lib/formato";
import { esArchivoDeTabla } from "../lib/importar/excel";
import { descargarPlantilla } from "../lib/importar/plantillaExcel";
import { CapturaManual } from "./CapturaManual";
import { OpcionesSubida } from "./OpcionesSubida";
import type { Transaccion } from "../lib/types";
import { ResultadoExcel } from "./SubirExcel";
import { estiloEntrada } from "../lib/estilos";
import { Boton, Nota } from "./SubirPiezas";
import { AvisoMuestraLista } from "./AvisoMuestraLista";
import { PAGOS_EN_PRUEBA } from "../lib/suscripcion";
import {
  comentarioDeFaltantes,
  confirmarMuestra,
  felicitacion,
  muestraParaBanco,
  obtenerMuestrasPorConfirmar,
  pareceDatoReal,
  TIPOS_FALTANTES,
  type MuestraPorConfirmar,
} from "../lib/muestras";

// "Subir estado de cuenta" de Ordena tu Lana (fase 2): el PDF se lee aquí, en
// el navegador; el archivo nunca se sube. Solo se guardan los movimientos. Si
// todavía no sabemos leer ese banco, el cliente ve la muestra anonimizada y
// puede mandarla para que se escriba su lector (lib/importar/).

type EstadoArchivo =
  | { fase: "leyendo" }
  // PDF protegido: se guardan los bytes del archivo (siguen en la computadora)
  // mientras el cliente escribe la contraseña. La contraseña no se guarda aquí.
  | { fase: "contrasena"; datos: ArrayBuffer; incorrecta: boolean }
  | { fase: "excel"; archivo: File }
  | { fase: "error"; mensaje: string; detalle?: string }
  | { fase: "listo"; hash: string; resultado: ResultadoImportacion };

interface Archivo {
  id: number;
  nombre: string;
  estado: EstadoArchivo;
}

const BANCOS_SOPORTADOS = "Banamex (cuenta de cheques y tarjetas de crédito) e Invex (tarjeta de crédito)";

/** Tamaño máximo de un PDF o Excel que se acepta leer. */
const TAMANO_MAXIMO_ARCHIVO = 20 * 1024 * 1024;

let siguienteId = 1;

const MENSAJE_PDF_ILEGIBLE =
  "No pudimos abrir este archivo como PDF. Revisa que sea el estado de cuenta que descargaste de tu banco.";

const detalleDeError = (error: unknown): string => {
  const e = error instanceof Error ? (error.cause instanceof Error ? error.cause : error) : null;
  return (e ? `${e.name}: ${e.message}` : String(error)).slice(0, 200);
};

export function SubirEstadoCuenta({
  transacciones,
  onGuardado,
}: {
  /** Para sugerir categorías y comercios al capturar a mano. */
  transacciones: readonly Transaccion[];
  onGuardado: () => void;
}) {
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  // Muestras del cliente con un lector listo para probar (recompensa por
  // muestras): al guardar un PDF de ese banco se le pregunta si ya ve todo.
  const [pendientes, setPendientes] = useState<MuestraPorConfirmar[]>([]);
  useEffect(() => {
    let vigente = true;
    obtenerMuestrasPorConfirmar()
      .then((lista) => vigente && setPendientes(lista))
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, []);
  const quitarPendiente = (id: string) => setPendientes((lista) => lista.filter((m) => m.id !== id));

  const actualizar = (id: number, estado: EstadoArchivo) =>
    setArchivos((lista) => lista.map((a) => (a.id === id ? { ...a, estado } : a)));

  async function leer(archivo: File) {
    const id = siguienteId++;
    // Un estado de cuenta pesa unos cuantos MB; algo mucho más grande no es
    // uno y solo trabaría la pestaña al leerlo.
    if (archivo.size > TAMANO_MAXIMO_ARCHIVO) {
      const mensaje = `Este archivo pesa más de ${TAMANO_MAXIMO_ARCHIVO / 1024 / 1024} MB. Un estado de cuenta o una plantilla pesan mucho menos; revisa que sea el archivo correcto.`;
      setArchivos((lista) => [...lista, { id, nombre: archivo.name, estado: { fase: "error", mensaje } }]);
      return;
    }
    // Excel y CSV se leen en su propia tarjeta (SubirExcel.tsx).
    if (esArchivoDeTabla(archivo.name)) {
      setArchivos((lista) => [...lista, { id, nombre: archivo.name, estado: { fase: "excel", archivo } }]);
      return;
    }
    setArchivos((lista) => [...lista, { id, nombre: archivo.name, estado: { fase: "leyendo" } }]);
    let datos: ArrayBuffer;
    try {
      datos = await archivo.arrayBuffer();
    } catch (error) {
      actualizar(id, { fase: "error", mensaje: MENSAJE_PDF_ILEGIBLE, detalle: detalleDeError(error) });
      return;
    }
    await leerPdf(id, datos);
  }

  /** Lee el PDF y deja solo el resultado. `contrasena` (si el PDF la pide) se
   * usa para abrirlo aquí mismo y se olvida al terminar esta función. */
  async function leerPdf(id: number, datos: ArrayBuffer, contrasena?: string) {
    actualizar(id, { fase: "leyendo" });
    try {
      const [{ paginas, detalles }, hash] = await Promise.all([
        leerPaginasPdf(datos, (p) => detectarLector(p)?.imagenes !== undefined, contrasena),
        huellaArchivo(datos),
      ]);
      // Solo el resultado queda en memoria; el texto completo (que puede traer
      // el número de cuenta) se descarta aquí.
      actualizar(id, { fase: "listo", hash, resultado: procesarPaginas(paginas, undefined, detalles) });
    } catch (error) {
      if (error instanceof PdfConContrasena) {
        actualizar(id, { fase: "contrasena", datos, incorrecta: error.incorrecta });
        return;
      }
      actualizar(id, {
        fase: "error",
        mensaje: MENSAJE_PDF_ILEGIBLE,
        // Sin datos del archivo: solo el error técnico, para saber qué falló.
        detalle: detalleDeError(error),
      });
    }
  }

  const quitar = (id: number) => setArchivos((lista) => lista.filter((a) => a.id !== id));

  return (
    <div className="space-y-4">
      {pendientes.map((m) => (
        <AvisoMuestraLista key={m.id} muestra={m} />
      ))}

      <OpcionesSubida onArchivos={(lista) => lista.forEach((archivo) => void leer(archivo))} />

      {archivos.map((a) => (
        <TarjetaArchivo
          key={a.id}
          archivo={a}
          onGuardado={onGuardado}
          pendientes={pendientes}
          onMuestraAtendida={quitarPendiente}
          onContrasena={(contrasena) => a.estado.fase === "contrasena" && void leerPdf(a.id, a.estado.datos, contrasena)}
          onQuitar={() => quitar(a.id)}
        />
      ))}

      <CapturaManual transacciones={transacciones} onGuardado={onGuardado} />
    </div>
  );
}

function Tarjeta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="tarjeta rounded-lg p-4 sm:p-5">
      <h3 className="mb-3 truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }} title={titulo}>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

/** Pide la contraseña de un PDF protegido. Vive solo en el estado de este
 * cuadro: no se guarda en el navegador ni se manda a ningún servidor, y se
 * borra del cuadro en cuanto se usa. */
function PedirContrasena({
  incorrecta,
  onAbrir,
  onCancelar,
}: {
  incorrecta: boolean;
  onAbrir: (contrasena: string) => void;
  onCancelar: () => void;
}) {
  const [contrasena, setContrasena] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const abrir = () => {
    if (!contrasena) return;
    const valor = contrasena;
    setContrasena("");
    onAbrir(valor);
  };
  return (
    <div>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Este PDF está protegido con contraseña. Escríbela para abrirlo; suele ser la que te indicó tu banco (por ejemplo,
        parte de tu RFC o de tu número de cliente).
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block min-w-48 flex-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Contraseña del PDF
          <input
            type={mostrar ? "text" : "password"}
            value={contrasena}
            // No es la contraseña de Ordena tu Lana: que el navegador no la ofrezca guardar ni la autocomplete.
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore
            spellCheck={false}
            autoFocus
            aria-invalid={incorrecta}
            onChange={(e) => setContrasena(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") abrir();
            }}
            className="mt-1 w-full rounded-md px-3 py-2 text-sm"
            style={estiloEntrada}
          />
        </label>
        <Boton onClick={abrir} deshabilitado={!contrasena}>
          Abrir PDF
        </Boton>
        <Boton onClick={onCancelar} secundario>
          Cancelar
        </Boton>
      </div>
      <label className="mt-2 inline-flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
        <input type="checkbox" checked={mostrar} onChange={(e) => setMostrar(e.target.checked)} />
        Mostrar contraseña
      </label>
      {incorrecta && <Nota tipo="error">La contraseña no es correcta. Revísala e inténtalo de nuevo.</Nota>}
      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        El PDF se abre aquí, en tu dispositivo. Tu contraseña no se guarda ni se envía a ningún lado.
      </p>
    </div>
  );
}

function TarjetaArchivo({
  archivo,
  onGuardado,
  pendientes,
  onMuestraAtendida,
  onContrasena,
  onQuitar,
}: {
  archivo: Archivo;
  onGuardado: () => void;
  pendientes: readonly MuestraPorConfirmar[];
  onMuestraAtendida: (id: string) => void;
  onContrasena: (contrasena: string) => void;
  onQuitar: () => void;
}) {
  const { estado } = archivo;
  if (estado.fase === "contrasena")
    return (
      <Tarjeta titulo={archivo.nombre}>
        <PedirContrasena incorrecta={estado.incorrecta} onAbrir={onContrasena} onCancelar={onQuitar} />
      </Tarjeta>
    );
  if (estado.fase === "leyendo")
    return (
      <Tarjeta titulo={archivo.nombre}>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Leyendo…
        </p>
      </Tarjeta>
    );
  if (estado.fase === "excel")
    return (
      <Tarjeta titulo={archivo.nombre}>
        <ResultadoExcel archivo={estado.archivo} onGuardado={onGuardado} />
      </Tarjeta>
    );
  if (estado.fase === "error")
    return (
      <Tarjeta titulo={archivo.nombre}>
        <Nota tipo="error">{estado.mensaje}</Nota>
        {/* Solo en el sitio de pruebas: en producción el cliente ve el mensaje sencillo. */}
        {PAGOS_EN_PRUEBA && estado.detalle && (
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Detalle técnico: {estado.detalle}
          </p>
        )}
      </Tarjeta>
    );
  const { resultado, hash } = estado;
  return (
    <Tarjeta titulo={archivo.nombre}>
      {resultado.reconocido ? (
        <Reconocido
          resultado={resultado}
          hash={hash}
          onGuardado={onGuardado}
          pendiente={muestraParaBanco(pendientes, resultado.banco)}
          onMuestraAtendida={onMuestraAtendida}
        />
      ) : (
        <NoReconocido resultado={resultado} />
      )}
    </Tarjeta>
  );
}

type Reconocido = Extract<ResultadoImportacion, { reconocido: true }>;
type NoReconocidoT = Extract<ResultadoImportacion, { reconocido: false }>;

const FILAS_VISTA_PREVIA = 8;

function Reconocido({
  resultado,
  hash,
  onGuardado,
  pendiente,
  onMuestraAtendida,
}: {
  resultado: Reconocido;
  hash: string;
  onGuardado: () => void;
  pendiente: MuestraPorConfirmar | null;
  onMuestraAtendida: (id: string) => void;
}) {
  const [alias, setAlias] = useState(resultado.alias ?? resultado.banco);
  const [ultimos4, setUltimos4] = useState(resultado.ultimos4 ?? "");
  const [verTodos, setVerTodos] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardados, setGuardados] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muestra, setMuestra] = useState(false);
  // La muestra que se estaba probando con este PDF (se conserva aunque ya
  // se haya atendido, para seguir mostrando el resultado).
  const [probando] = useState(pendiente);

  const { cargos, abonos } = totales(resultado.movimientos);
  const rango = periodo(resultado.movimientos);
  const ultimos4Valido = /^\d{4}$/.test(ultimos4);
  const visibles = verTodos ? resultado.movimientos : resultado.movimientos.slice(0, FILAS_VISTA_PREVIA);
  const categorizados = resultado.movimientos.filter((m) => categorizar(m.descripcion)).length;

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const n = await guardarImportacion({
        banco: resultado.banco,
        alias: alias.trim() || resultado.banco,
        ultimos4,
        hash,
        movimientos: resultado.movimientos,
      });
      setGuardados(n);
      onGuardado();
    } catch (e) {
      setError(`No se pudieron guardar los movimientos: ${(e as Error).message}`);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: "var(--text-primary)" }}>
        {resultado.banco}: {resultado.movimientos.length} movimientos
        {rango && ` del ${fechaCorta(rango.inicio)} al ${fechaCorta(rango.fin)}`}.
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span style={{ color: "var(--text-secondary)" }}>
          Cargos: <strong style={{ color: "var(--text-primary)" }}>{monedaConCentavos.format(Number(deCentavos(cargos)))}</strong>
        </span>
        <span style={{ color: "var(--text-secondary)" }}>
          Abonos: <strong style={{ color: "var(--text-primary)" }}>{monedaConCentavos.format(Number(deCentavos(abonos)))}</strong>
        </span>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Compara estos totales con los de tu estado de cuenta antes de guardar. {categorizados} de{" "}
        {resultado.movimientos.length} ya llegan con categoría; las demás las puedes asignar en tu tablero.
      </p>

      {resultado.advertencias.length > 0 && (
        <details className="text-sm" style={{ color: "var(--text-secondary)" }}>
          <summary className="cursor-pointer" style={{ color: "var(--text-primary)" }}>
            ⚠ {resultado.advertencias.length} renglón(es) que parecen movimientos no se pudieron leer
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
            {resultado.advertencias.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th className="py-1 pr-3 text-left font-medium">Fecha</th>
              <th className="py-1 pr-3 text-left font-medium">Descripción</th>
              <th className="hidden py-1 pr-3 text-left font-medium sm:table-cell">Categoría</th>
              <th className="py-1 text-right font-medium">Monto</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((m, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)", color: "var(--text-primary)" }}>
                <td className="whitespace-nowrap py-1 pr-3">{fechaCorta(m.fecha)}</td>
                <td className="py-1 pr-3">{m.descripcion}</td>
                <td className="hidden py-1 pr-3 sm:table-cell" style={{ color: "var(--text-secondary)" }}>
                  {categorizar(m.descripcion)?.categoria ?? "Sin categoría"}
                </td>
                <td
                  className="whitespace-nowrap py-1 text-right tabular-nums"
                  style={{ color: m.tipo === "abono" ? "var(--status-good)" : undefined }}
                >
                  {m.tipo === "abono" ? "+" : "−"}
                  {monedaConCentavos.format(Number(m.monto))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {resultado.movimientos.length > FILAS_VISTA_PREVIA && (
          <button
            type="button"
            className="mt-1 text-xs"
            style={{ color: "var(--marca)" }}
            onClick={() => setVerTodos((v) => !v)}
          >
            {verTodos ? "Ver menos" : `Ver los ${resultado.movimientos.length}`}
          </button>
        )}
      </div>

      {guardados === null ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-40 flex-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Nombre de la cuenta
            <input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              maxLength={60}
              className="mt-1 block w-full rounded-md px-3 py-1.5 text-sm"
              style={estiloEntrada}
            />
          </label>
          <label className="block w-36 text-sm" style={{ color: "var(--text-secondary)" }}>
            Últimos 4 dígitos
            <input
              value={ultimos4}
              onChange={(e) => setUltimos4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              className="mt-1 block w-full rounded-md px-3 py-1.5 text-sm"
              style={estiloEntrada}
            />
          </label>
          <Boton onClick={guardar} deshabilitado={guardando || !ultimos4Valido}>
            {guardando ? "Guardando…" : "Guardar movimientos"}
          </Boton>
        </div>
      ) : (
        <Nota tipo="exito">
          Listo: {guardados} movimientos guardados en {alias.trim() || resultado.banco}. Ya los ves en tu tablero.
        </Nota>
      )}
      {!ultimos4Valido && guardados === null && (
        <Nota tipo="aviso">Escribe los últimos 4 dígitos de la cuenta o tarjeta para poder guardar.</Nota>
      )}
      {error && <Nota tipo="error">{error}</Nota>}

      {probando && guardados !== null ? (
        <ConfirmarMuestra
          muestra={probando}
          resultado={resultado}
          onAtendida={() => onMuestraAtendida(probando.id)}
        />
      ) : !muestra ? (
        <button type="button" className="text-xs" style={{ color: "var(--marca)" }} onClick={() => setMuestra(true)}>
          ¿No ves todos tus movimientos? Envíanos tu muestra anonimizada
        </button>
      ) : (
        <EnviarMuestra
          motivo="faltan-movimientos"
          banco={resultado.banco}
          paginas={resultado.paginas}
          texto={resultado.muestra}
          movimientosLeidos={resultado.movimientos.length}
        />
      )}
    </div>
  );
}

function LigaPlantilla() {
  return (
    <button
      type="button"
      className="font-medium underline"
      style={{ color: "var(--marca)" }}
      onClick={() => void descargarPlantilla()}
    >
      plantilla de Excel
    </button>
  );
}

function NoReconocido({ resultado }: { resultado: NoReconocidoT }) {
  if (resultado.motivo === "sin-texto")
    return (
      <Nota tipo="aviso">
        Este PDF no trae texto (parece una imagen o un documento escaneado), así que no se puede leer. Descarga el estado
        de cuenta original desde tu banca en línea y vuelve a intentarlo, o captura tus movimientos con la{" "}
        <LigaPlantilla />.
      </Nota>
    );
  return (
    <div className="space-y-2">
      <p className="text-sm" style={{ color: "var(--text-primary)" }}>
        {resultado.motivo === "sin-movimientos"
          ? `Reconocimos que es de ${resultado.banco}, pero no encontramos movimientos en este formato.`
          : `Todavía no sabemos leer los estados de cuenta de este banco. Hoy leemos ${BANCOS_SOPORTADOS}.`}
      </p>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Puedes enviarnos una muestra anonimizada para que preparemos el lector de tu banco. Así se ve lo que nos
        llegaría: cada número se vuelve 0 y cada nombre se vuelve X, así que no viajan tus montos, nombres ni números de
        cuenta. Solo nos sirve para conocer el formato. Mientras, puedes subir tus movimientos con la{" "}
        <LigaPlantilla />.
      </p>
      <EnviarMuestra motivo={resultado.motivo} banco={resultado.banco} paginas={resultado.paginas} texto={resultado.muestra} />
    </div>
  );
}

/** Tras guardar un PDF del banco cuyo lector se hizo con su muestra: ¿ya
 * ve todo? Sí → la base decide la recompensa; no → retroalimentación. */
function ConfirmarMuestra({
  muestra,
  resultado,
  onAtendida,
}: {
  muestra: MuestraPorConfirmar;
  resultado: Reconocido;
  onAtendida: () => void;
}) {
  const [fase, setFase] = useState<"preguntar" | "confirmando" | "retro">("preguntar");
  const [hecho, setHecho] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setFase("confirmando");
    setError(null);
    try {
      setHecho(felicitacion(await confirmarMuestra(muestra.id), new Date()));
      onAtendida();
    } catch (e) {
      setError((e as Error).message);
      setFase("preguntar");
    }
  }

  if (hecho) return <Nota tipo="exito">{hecho}</Nota>;
  if (fase === "retro")
    return (
      <div className="space-y-2">
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          Cuéntanos qué falta y mándanos la muestra anonimizada de este PDF para seguir afinando el lector.
        </p>
        <EnviarMuestra
          motivo="faltan-movimientos"
          banco={resultado.banco}
          paginas={resultado.paginas}
          texto={resultado.muestra}
          movimientosLeidos={resultado.movimientos.length}
          origenId={muestra.id}
          onEnviada={onAtendida}
        />
      </div>
    );
  return (
    <section className="space-y-2 rounded-md p-3" style={{ border: "1px solid var(--status-good)" }}>
      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
        Este es el estado de cuenta con el que nos ayudaste. ¿Ya ves todos sus movimientos?
      </p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Compáralo con tu PDF: la app leyó {resultado.movimientos.length} movimientos.
      </p>
      <div className="flex flex-wrap gap-2">
        <Boton onClick={confirmar} deshabilitado={fase === "confirmando"}>
          {fase === "confirmando" ? "Confirmando…" : "Sí, ya veo todos"}
        </Boton>
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-sm"
          style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          onClick={() => setFase("retro")}
          disabled={fase === "confirmando"}
        >
          Todavía falta algo
        </button>
      </div>
      {error && <Nota tipo="error">{error}</Nota>}
    </section>
  );
}

function EnviarMuestra({
  motivo,
  banco,
  paginas,
  texto,
  movimientosLeidos = null,
  origenId = null,
  onEnviada,
}: {
  motivo: MuestraParaEnviar["motivo"];
  banco: string | null;
  paginas: number;
  texto: string;
  movimientosLeidos?: number | null;
  origenId?: string | null;
  onEnviada?: () => void;
}) {
  const faltan = motivo === "faltan-movimientos";
  const [comentario, setComentario] = useState("");
  const [tipos, setTipos] = useState<string[]>([]);
  const [cuantos, setCuantos] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conDatoReal = pareceDatoReal(comentario);
  const textoComentario = faltan ? comentarioDeFaltantes(tipos, cuantos, comentario) : comentario.trim();
  // Para "faltan movimientos" hay que decir qué tipo falta: sin eso no hay
  // cómo revisarla (y evita mandar muestras de estados que se leían bien).
  const listo = !conDatoReal && (!faltan || textoComentario !== "");

  async function enviar() {
    setEnviando(true);
    setError(null);
    try {
      await enviarMuestra({
        motivo,
        banco_detectado: banco,
        comentario: textoComentario || null,
        paginas,
        texto_anonimizado: texto,
        movimientos_leidos: faltan ? movimientosLeidos : null,
        muestra_origen_id: origenId,
      });
      setEnviada(true);
      onEnviada?.();
    } catch (e) {
      setError(`No se pudo enviar: ${(e as Error).message}`);
    } finally {
      setEnviando(false);
    }
  }

  if (enviada)
    return (
      <Nota tipo="exito">
        {faltan
          ? "Gracias, recibimos tu muestra. La revisamos y te avisamos aquí cuando el lector esté corregido."
          : "Gracias, recibimos la muestra. Cuando el lector de tu banco esté listo te avisamos aquí para que subas este mismo PDF."}
      </Nota>
    );

  return (
    <div className="space-y-2">
      <details>
        <summary className="cursor-pointer text-sm" style={{ color: "var(--marca)" }}>
          Ver la muestra anonimizada
        </summary>
        <pre
          className="mt-2 max-h-72 overflow-auto rounded-md p-3 text-xs"
          style={{ ...estiloEntrada, whiteSpace: "pre-wrap" }}
        >
          {texto}
        </pre>
      </details>
      {faltan && (
        <fieldset className="space-y-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          <legend className="mb-1" style={{ color: "var(--text-primary)" }}>
            ¿Qué tipo de movimientos no ves?
          </legend>
          {TIPOS_FALTANTES.map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={tipos.includes(t)}
                onChange={(e) => setTipos((lista) => (e.target.checked ? [...lista, t] : lista.filter((x) => x !== t)))}
              />
              {t}
            </label>
          ))}
          <label className="mt-2 block w-48">
            ¿Cuántos faltan, más o menos?
            <input
              value={cuantos}
              onChange={(e) => setCuantos(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              className="mt-1 block w-full rounded-md px-3 py-1.5 text-sm"
              style={estiloEntrada}
            />
          </label>
        </fieldset>
      )}
      <label className="block text-sm" style={{ color: "var(--text-secondary)" }}>
        {faltan ? "Algo más que nos ayude a encontrarlos (opcional)" : "¿De qué banco y producto es? (opcional)"}
        <input
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          maxLength={300}
          placeholder={faltan ? "Ej. los de la segunda página, los de la tarjeta adicional" : "Ej. BBVA tarjeta de crédito"}
          className="mt-1 block w-full rounded-md px-3 py-1.5 text-sm"
          style={estiloEntrada}
        />
      </label>
      {conDatoReal && (
        <Nota tipo="aviso">
          No escribas montos, números de cuenta ni correos: describe solo el tipo de movimiento. Nunca te pediremos tus
          movimientos reales.
        </Nota>
      )}
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Si tu muestra nos ayuda a leer un formato nuevo o a corregir un lector, te regalamos un mes de Pro cuando nos
        confirmes que ya ves todos tus movimientos. Revisamos cada muestra: si el estado de cuenta ya se leía completo, no
        hay regalo.
      </p>
      <Boton onClick={enviar} deshabilitado={enviando || !listo}>
        {enviando ? "Enviando…" : "Enviar muestra anonimizada"}
      </Boton>
      {error && <Nota tipo="error">{error}</Nota>}
    </div>
  );
}
