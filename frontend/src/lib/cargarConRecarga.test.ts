import { describe, expect, it, vi } from "vitest";
import { CLAVE_RECARGA_POR_VERSION, cargarConRecarga, type EntornoRecarga } from "./cargarConRecarga";

function entorno() {
  const datos = new Map<string, string>();
  const recargar = vi.fn();
  const e: EntornoRecarga = {
    almacen: {
      getItem: (k) => datos.get(k) ?? null,
      setItem: (k, v) => void datos.set(k, v),
      removeItem: (k) => void datos.delete(k),
    },
    recargar,
  };
  return { datos, recargar, e: () => e };
}

describe("cargarConRecarga", () => {
  it("devuelve el módulo y limpia la marca", async () => {
    const { datos, recargar, e } = entorno();
    datos.set(CLAVE_RECARGA_POR_VERSION, "1");
    await expect(cargarConRecarga(() => Promise.resolve(7), e)).resolves.toBe(7);
    expect(datos.has(CLAVE_RECARGA_POR_VERSION)).toBe(false);
    expect(recargar).not.toHaveBeenCalled();
  });

  it("si falla la primera vez, recarga una vez", async () => {
    const { datos, recargar, e } = entorno();
    void cargarConRecarga(() => Promise.reject(new Error("CORS")), e);
    await new Promise((r) => setTimeout(r, 0));
    expect(recargar).toHaveBeenCalledTimes(1);
    expect(datos.get(CLAVE_RECARGA_POR_VERSION)).toBe("1");
  });

  it("si ya recargó, muestra el error en vez de recargar en ciclo", async () => {
    const { datos, recargar, e } = entorno();
    datos.set(CLAVE_RECARGA_POR_VERSION, "1");
    await expect(cargarConRecarga(() => Promise.reject(new Error("CORS")), e)).rejects.toThrow("CORS");
    expect(recargar).not.toHaveBeenCalled();
  });
});
