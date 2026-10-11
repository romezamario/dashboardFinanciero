import { useState, type ReactNode } from "react";
import { deCentavos } from "../lib/importar/comun";
import { enviarMuestra, guardarImportacion, type MuestraParaEnviar } from "../lib/importar/guardar";
import { huellaArchivo, leerPaginasPdf, PdfConContrasena } from "../lib/importar/leerPdf";
import { periodo, procesarPaginas, totales, type ResultadoImportacion } from "../lib/importar/procesar";
import { fechaCorta, monedaConCentavos } from "../lib/formato";

// "Subir estado de cuenta" de Ordena tu Lana (fase 2): el PDF se lee aquí, en
// el navegador; el archivo nunca se sube. Solo se guardan los movimientos. Si
// todavía no sabemos leer ese banco, el cliente ve la muestra anonimizada y
// puede mandarla para que se escriba su lector (lib/importar/).

type EstadoArchivo =
  | { fase: "leyendo" }
  | { fase: "error"; mensaje: string }
  | { fase: "listo"; hash: string; resultado: ResultadoImportacion };

interface Archivo {
  id: number;
  nombre: string;
  estado: EstadoArchivo;
}

const BANCOS_SOPORTADOS = "Banamex (cuenta de cheques y tarjetas de crédito) e Invex (tarjeta de crédito)";

const estiloEntrada = {
  background: "var(--page-plane)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
};

let siguienteId = 1;

export function SubirEstadoCuenta({ onGuardado }: { onGuardado: () => void }) {
  const [archivos, setArchivos] = useState<Archivo[]>([]);

  const actualizar = (id: number, estado: EstadoArchivo) =>
    setArchivos((lista) => lista.map((a) => (a.id === id ? { ...a, estado } : a)));

  async function leer(archivo: File) {
    const id = siguienteId++;
    setArchivos((lista) => [...lista, { id, nombre: archivo.name, estado: { fase: "leyendo" } }]);
    try {
      const datos = await archivo.arrayBuffer();
      const [paginas, hash] = await Promise.all([leerPaginasPdf(datos), huellaArchivo(datos)]);
      // Solo el resultado queda en memoria; el texto completo (que puede traer
      // el número de cuenta) se descarta aquí.
      actualizar(id, { fase: "listo", hash, resultado: procesarPaginas(paginas) });
    } catch (error) {
      actualizar(id, {
        fase: "error",
        mensaje:
          error instanceof PdfConContrasena
            ? "Este PDF tiene contraseña. Descárgalo de tu banca en línea sin contraseña o quítasela e inténtalo de nuevo."
            : "No pudimos abrir este archivo como PDF. Revisa que sea el estado de cuenta que descargaste de tu banco.",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          Subir estado de cuenta
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Elige el PDF que descargas de tu banca en línea. Se lee aquí mismo, en tu navegador: el archivo no se sube a
          ningún lado y solo guardamos los movimientos. Por ahora leemos {BANCOS_SOPORTADOS}.
        </p>
      </div>

      <label
        className="tarjeta flex cursor-pointer flex-col items-center gap-1 rounded-lg p-6 text-center"
        style={{ borderStyle: "dashed" }}
      >
        <span className="text-sm font-medium" style={{ color: "var(--series-1)" }}>
          Elegir PDF
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Puedes elegir varios a la vez
        </span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(e) => {
            for (const archivo of Array.from(e.target.files ?? [])) void leer(archivo);
            e.target.value = "";
          }}
        />
      </label>

      {archivos.map((a) => (
        <TarjetaArchivo key={a.id} archivo={a} onGuardado={onGuardado} />
      ))}
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

function Boton({
  children,
  onClick,
  deshabilitado,
  secundario,
}: {
  children: ReactNode;
  onClick: () => void;
  deshabilitado?: boolean;
  secundario?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      className="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      style={
        secundario
          ? { border: "1px solid var(--border)", color: "var(--text-primary)" }
          : { background: "var(--series-1)", color: "white" }
      }
    >
      {children}
    </button>
  );
}

function Nota({ tipo, children }: { tipo: "error" | "exito" | "aviso"; children: ReactNode }) {
  const color = { error: "var(--status-critical)", exito: "var(--status-good)", aviso: "var(--text-secondary)" }[tipo];
  return (
    <p role={tipo === "error" ? "alert" : "status"} className="mt-2 text-sm" style={{ color }}>
      {children}
    </p>
  );
}

function TarjetaArchivo({ archivo, onGuardado }: { archivo: Archivo; onGuardado: () => void }) {
  const { estado } = archivo;
  if (estado.fase === "leyendo")
    return (
      <Tarjeta titulo={archivo.nombre}>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Leyendo…
        </p>
      </Tarjeta>
    );
  if (estado.fase === "error")
    return (
      <Tarjeta titulo={archivo.nombre}>
        <Nota tipo="error">{estado.mensaje}</Nota>
      </Tarjeta>
    );
  const { resultado, hash } = estado;
  return (
    <Tarjeta titulo={archivo.nombre}>
      {resultado.reconocido ? (
        <Reconocido resultado={resultado} hash={hash} onGuardado={onGuardado} />
      ) : (
        <NoReconocido resultado={resultado} />
      )}
    </Tarjeta>
  );
}

type Reconocido = Extract<ResultadoImportacion, { reconocido: true }>;
type NoReconocidoT = Extract<ResultadoImportacion, { reconocido: false }>;

const FILAS_VISTA_PREVIA = 8;

function Reconocido({ resultado, hash, onGuardado }: { resultado: Reconocido; hash: string; onGuardado: () => void }) {
  const [alias, setAlias] = useState(resultado.alias ?? resultado.banco);
  const [ultimos4, setUltimos4] = useState(resultado.ultimos4 ?? "");
  const [verTodos, setVerTodos] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardados, setGuardados] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muestra, setMuestra] = useState(false);

  const { cargos, abonos } = totales(resultado.movimientos);
  const rango = periodo(resultado.movimientos);
  const ultimos4Valido = /^\d{4}$/.test(ultimos4);
  const visibles = verTodos ? resultado.movimientos : resultado.movimientos.slice(0, FILAS_VISTA_PREVIA);

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
        Compara estos totales con los de tu estado de cuenta antes de guardar.
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
              <th className="py-1 text-right font-medium">Monto</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((m, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)", color: "var(--text-primary)" }}>
                <td className="whitespace-nowrap py-1 pr-3">{fechaCorta(m.fecha)}</td>
                <td className="py-1 pr-3">{m.descripcion}</td>
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
            style={{ color: "var(--series-1)" }}
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

      {!muestra ? (
        <button type="button" className="text-xs" style={{ color: "var(--text-muted)" }} onClick={() => setMuestra(true)}>
          ¿Faltan movimientos o algo se leyó mal? Avísanos
        </button>
      ) : (
        <EnviarMuestra
          motivo="faltan-movimientos"
          banco={resultado.banco}
          paginas={resultado.paginas}
          texto={resultado.muestra}
        />
      )}
    </div>
  );
}

function NoReconocido({ resultado }: { resultado: NoReconocidoT }) {
  if (resultado.motivo === "sin-texto")
    return (
      <Nota tipo="aviso">
        Este PDF no trae texto (parece una imagen o un documento escaneado), así que no se puede leer. Descarga el estado
        de cuenta original desde tu banca en línea y vuelve a intentarlo.
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
        cuenta. Solo nos sirve para conocer el formato.
      </p>
      <EnviarMuestra motivo={resultado.motivo} banco={resultado.banco} paginas={resultado.paginas} texto={resultado.muestra} />
    </div>
  );
}

function EnviarMuestra({
  motivo,
  banco,
  paginas,
  texto,
}: {
  motivo: MuestraParaEnviar["motivo"];
  banco: string | null;
  paginas: number;
  texto: string;
}) {
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar() {
    setEnviando(true);
    setError(null);
    try {
      await enviarMuestra({
        motivo,
        banco_detectado: banco,
        comentario: comentario.trim() || null,
        paginas,
        texto_anonimizado: texto,
      });
      setEnviada(true);
    } catch (e) {
      setError(`No se pudo enviar: ${(e as Error).message}`);
    } finally {
      setEnviando(false);
    }
  }

  if (enviada)
    return (
      <Nota tipo="exito">
        Gracias, recibimos la muestra. Cuando el lector de tu banco esté listo podrás subir este mismo PDF aquí.
      </Nota>
    );

  return (
    <div className="space-y-2">
      <details>
        <summary className="cursor-pointer text-sm" style={{ color: "var(--series-1)" }}>
          Ver la muestra anonimizada
        </summary>
        <pre
          className="mt-2 max-h-72 overflow-auto rounded-md p-3 text-xs"
          style={{ ...estiloEntrada, whiteSpace: "pre-wrap" }}
        >
          {texto}
        </pre>
      </details>
      <label className="block text-sm" style={{ color: "var(--text-secondary)" }}>
        {motivo === "faltan-movimientos" ? "¿Qué falta o qué se leyó mal?" : "¿De qué banco y producto es? (opcional)"}
        <input
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          maxLength={500}
          placeholder={motivo === "faltan-movimientos" ? "Ej. falta el pago del día 5" : "Ej. BBVA tarjeta de crédito"}
          className="mt-1 block w-full rounded-md px-3 py-1.5 text-sm"
          style={estiloEntrada}
        />
      </label>
      <Boton onClick={enviar} deshabilitado={enviando}>
        {enviando ? "Enviando…" : "Enviar muestra anonimizada"}
      </Boton>
      {error && <Nota tipo="error">{error}</Nota>}
    </div>
  );
}
