import { describe, expect, it } from "vitest";
import {
  agruparIngresosGastosPorMes,
  agruparPor,
  aplicarFiltros,
  armarTransacciones,
  categoriaDe,
  comercioDe,
  obtenerTodasLasPaginas,
  reemplazarFilas,
  type Catalogos,
  type FilaTransaccion,
} from "./queries";
import { transaccion } from "../test/fabrica";

describe("agruparPor", () => {
  it("suma cada lado y ordena por magnitud combinada", () => {
    const puntos = agruparPor(
      [
        transaccion({ categoria: "Comida", monto: 50 }),
        transaccion({ categoria: "Comida", monto: 30 }),
        transaccion({ categoria: "Nómina", monto: 1000, tipo: "abono" }),
        transaccion({ monto: 10 }),
      ],
      categoriaDe
    );
    expect(puntos).toEqual([
      { nombre: "Nómina", ingresos: 1000, gastos: 0 },
      { nombre: "Comida", ingresos: 0, gastos: 80 },
      { nombre: "Sin categoría", ingresos: 0, gastos: 10 },
    ]);
  });

  it("omite las transacciones sin valor en la dimensión (comercio opcional)", () => {
    const puntos = agruparPor(
      [transaccion({ comercio: "Televia" }), transaccion({ comercio: null })],
      comercioDe
    );
    expect(puntos.map((p) => p.nombre)).toEqual(["Televia"]);
  });
});

describe("aplicarFiltros", () => {
  const datos = [
    transaccion({ categoria: "Comida", comercio: "Oxxo" }),
    transaccion({ categoria: "Comida", comercio: "Walmart" }),
    transaccion({ categoria: "Transporte", comercio: "Oxxo" }),
  ];

  it("aplica todas las dimensiones activas", () => {
    expect(aplicarFiltros(datos, { categoria: "Comida", comercio: "Oxxo" })).toHaveLength(1);
  });

  it("excluye su propia dimensión (cross-filter)", () => {
    const filtros = { categoria: "Comida", comercio: "Oxxo" };
    expect(aplicarFiltros(datos, filtros, "comercio")).toHaveLength(2);
    expect(aplicarFiltros(datos, filtros, ["comercio", "categoria"])).toHaveLength(3);
  });
});

describe("agruparIngresosGastosPorMes", () => {
  it("rellena con $0 los meses sin movimientos entre el primero y el último", () => {
    const puntos = agruparIngresosGastosPorMes([
      transaccion({ fecha: "2025-11-03", monto: 10 }),
      transaccion({ fecha: "2026-02-01", monto: 5, tipo: "abono" }),
    ]);
    expect(puntos.map((p) => p.periodo)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(puntos[1]).toEqual({ periodo: "2025-12", ingresos: 0, gastos: 0 });
  });
});

describe("armarTransacciones / reemplazarFilas", () => {
  const documento = { id: "d1", cuentas: { id: "c1", alias: "TDC Beyond", bancos: { nombre: "Banamex TDC" } } };
  const catalogos: Catalogos = {
    categorias: new Map([["cat1", { nombre: "Comida" }]]),
    eventos: new Map([["ev1", { nombre: "Viaje" }]]),
    documentos: new Map([["d1", documento]]),
  };
  const fila = (id: string, extra: Partial<FilaTransaccion> = {}): FilaTransaccion => ({
    id,
    fecha: "2026-08-01",
    descripcion: "X",
    monto: 1,
    tipo: "cargo",
    saldo: null,
    comercio: null,
    tarjeta: null,
    categoria_id: null,
    evento_id: null,
    documento_id: "d1",
    ...extra,
  });

  it("resuelve las relaciones y comparte el objeto del documento", () => {
    const [a, b] = armarTransacciones(
      [fila("a", { categoria_id: "cat1", evento_id: "ev1" }), fila("b")],
      catalogos
    );
    expect(a.categorias).toEqual({ nombre: "Comida" });
    expect(a.eventos).toEqual({ nombre: "Viaje" });
    expect(b.categorias).toBeNull();
    expect(a.documentos).toBe(b.documentos);
    expect(a).not.toHaveProperty("categoria_id");
  });

  it("omite filas cuyo documento no está en el catálogo", () => {
    expect(armarTransacciones([fila("a", { documento_id: "otro" })], catalogos)).toEqual([]);
  });

  it("reemplaza por id conservando el orden", () => {
    const filas = [fila("a"), fila("b"), fila("c")];
    const nuevas = reemplazarFilas(filas, [fila("b", { comercio: "Oxxo" })]);
    expect(nuevas.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(nuevas[1].comercio).toBe("Oxxo");
    expect(nuevas[0]).toBe(filas[0]);
  });
});

describe("obtenerTodasLasPaginas", () => {
  /** Simula `.range()` sobre `total` filas, con el conteo que devolvería
   * PostgREST (estimado: puede no coincidir con el real). */
  function paginador(total: number, conteo: number) {
    const pedidas: number[] = [];
    const pagina = (desde: number, hasta: number, contar: boolean) => {
      pedidas.push(desde);
      const data = Array.from({ length: Math.max(0, Math.min(hasta, total - 1) - desde + 1) }, (_, i) => desde + i);
      return Promise.resolve({ data, error: null, count: contar ? conteo : null });
    };
    return { pagina, pedidas };
  }

  it("una sola página cuando hay menos de 1000", async () => {
    const { pagina, pedidas } = paginador(10, 10);
    expect(await obtenerTodasLasPaginas<number>(pagina)).toHaveLength(10);
    expect(pedidas).toEqual([0]);
  });

  it("trae todo aunque el estimado se quede corto", async () => {
    const { pagina } = paginador(3500, 1200);
    const filas = await obtenerTodasLasPaginas<number>(pagina);
    expect(filas).toHaveLength(3500);
    expect(filas[3499]).toBe(3499);
  });

  it("no duplica nada si el estimado se pasa", async () => {
    const { pagina } = paginador(2100, 9000);
    const filas = await obtenerTodasLasPaginas<number>(pagina);
    expect(filas).toHaveLength(2100);
    expect(new Set(filas).size).toBe(2100);
  });

  it("un total exacto múltiplo de 1000 termina con una página vacía", async () => {
    const { pagina, pedidas } = paginador(2000, 2000);
    expect(await obtenerTodasLasPaginas<number>(pagina)).toHaveLength(2000);
    expect(pedidas).toEqual([0, 1000, 2000]);
  });

  it("convierte el error de PostgREST en Error con su mensaje", async () => {
    const pagina = () => Promise.resolve({ data: null, error: { message: "sin permiso" }, count: null });
    await expect(obtenerTodasLasPaginas(pagina)).rejects.toThrow("sin permiso");
  });
});
