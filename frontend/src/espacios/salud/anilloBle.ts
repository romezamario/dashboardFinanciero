// Prueba de concepto (Mario, 2026-11-09): leer el anillo Oura directo desde el
// navegador con Web Bluetooth — en iPhone, con Bluefy (Chrome/Safari de iOS no
// tienen Web Bluetooth). Protocolo según open_oura,
// docs/horizon-ring3-protocol-cheatsheet.md (Ring 3 Horizon, fw 3.4.3, el mismo
// firmware que el anillo de Mario). Solo LECTURA: autenticar, batería,
// firmware y estado de HR diurno/SpO2. Nada que cambie el anillo.
//
// La clave del anillo (16 bytes en hex, la de datos\oura.key de la laptop)
// vive solo en este navegador: nunca va a Supabase, al repo ni a la consola.

export const SERVICIO = "98ed0001-a541-11e4-b6a0-0002a5d5c51b";
export const CARACT_ESCRITURA = "98ed0002-a541-11e4-b6a0-0002a5d5c51b";
export const CARACT_AVISOS = "98ed0003-a541-11e4-b6a0-0002a5d5c51b";

// ---------------------------------------------------------------- hex

export function hexABytes(hex: string): Uint8Array {
  const limpio = hex.replace(/\s+/g, "").toLowerCase();
  if (!/^([0-9a-f]{2})*$/.test(limpio)) throw new Error("Hex inválido");
  return Uint8Array.from(limpio.match(/../g) ?? [], (b) => parseInt(b, 16));
}

export function bytesAHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** La clave tal como la guarda oura.exe (32 caracteres hex, quizá con salto
 * de línea). null si no tiene esa forma. */
export function normalizarClave(texto: string): string | null {
  const limpio = texto.trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(limpio) ? limpio : null;
}

// ------------------------------------------------------------ cifrado

/** AES-128/ECB/PKCS5 de un nonce de 15 bytes = un solo bloque (15 bytes +
 * relleno 0x01). Web Crypto no tiene ECB, pero con IV en ceros el primer
 * bloque de AES-CBC es exactamente ECB de ese bloque. */
export async function cifrarNonce(clave: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
  if (clave.length !== 16) throw new Error("La clave debe tener 16 bytes");
  if (nonce.length !== 15) throw new Error("El nonce debe tener 15 bytes");
  const bloque = new Uint8Array(16);
  bloque.set(nonce);
  bloque[15] = 0x01; // PKCS5: falta 1 byte para completar el bloque
  const llave = await crypto.subtle.importKey("raw", clave as BufferSource, { name: "AES-CBC" }, false, ["encrypt"]);
  const cifrado = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, llave, bloque as BufferSource)
  );
  return cifrado.slice(0, 16);
}

// ------------------------------------------------------- respuestas

export interface Bateria {
  porcentaje: number;
  cargando: boolean;
}

/** `0d <len> <porcentaje> <progreso de carga> <recomendado> ...`. */
export function leerBateria(r: Uint8Array): Bateria | null {
  if (r[0] !== 0x0d || r.length < 4) return null;
  return { porcentaje: r[2], cargando: r[3] !== 0 };
}

export interface Firmware {
  api: string;
  firmware: string;
  bootloader: string;
  bluetooth: string;
}

/** `09 12 <api x3> <fw x3> <bootloader x3> <bt x3> <mac x6 invertida>`. La MAC
 * no se devuelve: no hace falta mostrarla. */
export function leerFirmware(r: Uint8Array): Firmware | null {
  if (r[0] !== 0x09 || r.length < 14) return null;
  const v = (i: number) => `${r[i]}.${r[i + 1]}.${r[i + 2]}`;
  return { api: v(2), firmware: v(5), bootloader: v(8), bluetooth: v(11) };
}

export interface EstadoFuncion {
  funcion: number;
  modo: number;
  suscripcion: number;
}

/** `2f 06 21 <función> <modo> <status> <state> <suscripción>`. Modo 1 =
 * automático (encendida), 0 = apagada. */
export function leerEstadoFuncion(r: Uint8Array): EstadoFuncion | null {
  if (r[0] !== 0x2f || r[2] !== 0x21 || r.length < 8) return null;
  return { funcion: r[3], modo: r[4], suscripcion: r[7] };
}

export type ResultadoAuth = "ok" | "clave-incorrecta" | "desconocido";

export function leerResultadoAuth(r: Uint8Array): ResultadoAuth {
  const hex = bytesAHex(r);
  if (hex === "2f022e00") return "ok";
  if (hex === "2f022e01") return "clave-incorrecta";
  return "desconocido";
}

export const SIN_AUTENTICAR = "2f022f01";

// --------------------------------------------------- Web Bluetooth
// Tipos mínimos: el DOM de TypeScript no trae Web Bluetooth.

interface Caracteristica extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<Caracteristica>;
  writeValue(valor: BufferSource): Promise<void>;
  writeValueWithResponse?(valor: BufferSource): Promise<void>;
}
interface ServidorGatt {
  connected: boolean;
  connect(): Promise<ServidorGatt>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Caracteristica> }>;
}
interface DispositivoBle extends EventTarget {
  name?: string;
  gatt?: ServidorGatt;
}
interface BluetoothNavegador {
  requestDevice(opciones: { filters: { services: string[] }[]; optionalServices?: string[] }): Promise<DispositivoBle>;
}

export function bluetoothDisponible(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export interface Conexion {
  nombre: string;
  /** Escribe el comando (hex) y espera la primera respuesta que cumpla `espera`. */
  pedir(hex: string, espera: (r: Uint8Array) => boolean, ms?: number): Promise<Uint8Array>;
  cerrar(): void;
}

/** Pide al navegador elegir el anillo (filtro por el servicio de Oura), se
 * conecta y se suscribe a los avisos. */
export async function conectar(registro: (linea: string) => void): Promise<Conexion> {
  const bt = (navigator as unknown as { bluetooth: BluetoothNavegador }).bluetooth;
  const dispositivo = await bt.requestDevice({ filters: [{ services: [SERVICIO] }], optionalServices: [SERVICIO] });
  registro(`Anillo elegido: ${dispositivo.name ?? "(sin nombre)"}`);
  const servidor = await dispositivo.gatt!.connect();
  const servicio = await servidor.getPrimaryService(SERVICIO);
  const escritura = await servicio.getCharacteristic(CARACT_ESCRITURA);
  const avisos = await servicio.getCharacteristic(CARACT_AVISOS);

  let esperando: { espera: (r: Uint8Array) => boolean; listo: (r: Uint8Array) => void } | null = null;
  avisos.addEventListener("characteristicvaluechanged", (e) => {
    const vista = (e.target as Caracteristica).value;
    if (!vista) return;
    const r = new Uint8Array(vista.buffer.slice(vista.byteOffset, vista.byteOffset + vista.byteLength));
    if (esperando && (esperando.espera(r) || bytesAHex(r) === SIN_AUTENTICAR)) {
      const { listo } = esperando;
      esperando = null;
      listo(r);
    }
  });
  await avisos.startNotifications();
  registro("Conectado y suscrito a los avisos del anillo.");

  return {
    nombre: dispositivo.name ?? "Oura",
    async pedir(hex, espera, ms = 5000) {
      const respuesta = new Promise<Uint8Array>((resolver, rechazar) => {
        const tiempo = setTimeout(() => {
          esperando = null;
          rechazar(new Error(`Sin respuesta del anillo a ${hex.slice(0, 6)}…`));
        }, ms);
        esperando = {
          espera,
          listo: (r) => {
            clearTimeout(tiempo);
            resolver(r);
          },
        };
      });
      const datos = hexABytes(hex) as BufferSource;
      await (escritura.writeValueWithResponse ? escritura.writeValueWithResponse(datos) : escritura.writeValue(datos));
      return respuesta;
    },
    cerrar() {
      if (servidor.connected) servidor.disconnect();
    },
  };
}

/** Pide un nonce, lo cifra con la clave y se autentica. Nunca registra la
 * clave ni el nonce cifrado. */
export async function autenticar(con: Conexion, claveHex: string): Promise<ResultadoAuth> {
  const respuesta = await con.pedir("2f012b", (r) => r[0] === 0x2f && r[2] === 0x2c);
  if (respuesta[2] !== 0x2c || respuesta.length < 18) return "desconocido";
  const cifrado = await cifrarNonce(hexABytes(claveHex), respuesta.slice(3, 18));
  const r = await con.pedir(`2f112d${bytesAHex(cifrado)}`, (x) => x[0] === 0x2f && x[2] === 0x2e);
  return leerResultadoAuth(r);
}
