import { describe, expect, it } from "vitest";
import { conciliarConCorreo, eventosHeredables, primeraFechaCorreo } from "./conciliarCorreo";
import { filaAGastoCorreo, type GastoCorreo } from "./gastosCorreo";
import { aMovimiento } from "./gastosEstadoCuenta";
import { transaccion } from "../test/fabrica";

let n = 0;
function aviso(parcial: Partial<GastoCorreo> = {}): GastoCorreo {
  n += 1;
  return {
    id: `g${n}`, mensaje_id: `m${n}`, fecha: "2026-08-14", hora: "12:00", tarjeta: "904", comercio: "Starbucks",
    categoria: "Restaurantes", establecimiento: "STARBUCKS CENTRO", ciudad_cod: "MTY", ciudad: "Monterrey",
    monto: 100, moneda: "MXN", evento: null, ...parcial,
  };
}
const mov = (parcial: Parameters<typeof transaccion>[0] = {}) => aMovimiento(transaccion(parcial))!;

describe("conciliarConCorreo", () => {
  it("mismo monto y mismo día", () => {
    const m = mov({ monto: 185.5 });
    const g = aviso({ monto: 185.5 });
    const r = conciliarConCorreo([m], [g]);
    expect(r.get(m.id)).toEqual({ gasto: g, diasDeDiferencia: 0, otrosCandidatos: 0 });
  });

  it("acepta un día antes o después, pero no dos", () => {
    const m = mov({ fecha: "2026-08-14" });
    expect(conciliarConCorreo([m], [aviso({ fecha: "2026-08-15" })]).get(m.id)?.diasDeDiferencia).toBe(1);
    expect(conciliarConCorreo([m], [aviso({ fecha: "2026-08-13" })]).get(m.id)?.diasDeDiferencia).toBe(1);
    expect(conciliarConCorreo([m], [aviso({ fecha: "2026-08-16" })]).size).toBe(0);
    // Cruza de mes sin romperse.
    const fin = mov({ fecha: "2026-08-31" });
    expect(conciliarConCorreo([fin], [aviso({ fecha: "2026-09-01" })]).size).toBe(1);
  });

  it("el monto debe ser exacto (al centavo)", () => {
    const m = mov({ monto: 100 });
    expect(conciliarConCorreo([m], [aviso({ monto: 100.01 })]).size).toBe(0);
  });

  it("uno a uno: dos cargos iguales con un solo aviso -> solo uno lo recibe", () => {
    const a = mov();
    const b = mov();
    const r = conciliarConCorreo([a, b], [aviso()]);
    expect(r.size).toBe(1);
  });

  it("dos cargos iguales y dos avisos -> cada uno con el suyo", () => {
    const a = mov();
    const b = mov();
    const g1 = aviso({ hora: "09:00" });
    const g2 = aviso({ hora: "18:00" });
    const r = conciliarConCorreo([a, b], [g1, g2]);
    expect(new Set([r.get(a.id)?.gasto.id, r.get(b.id)?.gasto.id])).toEqual(new Set([g1.id, g2.id]));
  });

  it("prefiere el mismo día sobre el de ±1 día", () => {
    const m = mov({ fecha: "2026-08-14" });
    const ayer = aviso({ fecha: "2026-08-13" });
    const hoy = aviso({ fecha: "2026-08-14" });
    const r = conciliarConCorreo([m], [ayer, hoy]);
    expect(r.get(m.id)?.gasto.id).toBe(hoy.id);
    expect(r.get(m.id)?.otrosCandidatos).toBe(1);
  });

  it("no empareja abonos, cargos de la cuenta de cheques ni avisos en otra moneda", () => {
    const abono = mov({ tipo: "abono" });
    const cheques = mov({ cuenta: "Priority", banco: "Banamex" });
    const dolares = mov({ monto: 20 });
    const r = conciliarConCorreo([abono, cheques, dolares], [aviso(), aviso({ monto: 20, moneda: "USD" })]);
    expect(r.size).toBe(0);
  });
});

describe("primeraFechaCorreo", () => {
  it("la fecha más antigua, o null sin avisos", () => {
    expect(primeraFechaCorreo([aviso({ fecha: "2026-09-02" }), aviso({ fecha: "2026-07-20" })])).toBe("2026-07-20");
    expect(primeraFechaCorreo([])).toBeNull();
  });
});

describe("eventosHeredables", () => {
  it("hereda el evento del aviso emparejado a un movimiento sin evento", () => {
    const m = mov({ monto: 300 });
    const g = aviso({ monto: 300, evento: "2026-10 Viaje" });
    const r = eventosHeredables([m], conciliarConCorreo([m], [g]));
    expect(Array.from(r)).toEqual([["2026-10 Viaje", [m.id]]]);
  });

  it("no pisa un evento que el movimiento ya tiene (igual o distinto)", () => {
    const igual = mov({ monto: 310, evento: "Viaje" });
    const distinto = mov({ monto: 320, evento: "Otro" });
    const avisos = [aviso({ monto: 310, evento: "Viaje" }), aviso({ monto: 320, evento: "Viaje" })];
    expect(eventosHeredables([igual, distinto], conciliarConCorreo([igual, distinto], avisos)).size).toBe(0);
  });

  it("ignora avisos sin evento y movimientos sin pareja; agrupa por evento", () => {
    const a = mov({ monto: 410 });
    const b = mov({ monto: 420 });
    const c = mov({ monto: 430 });
    const sinPareja = mov({ monto: 999 });
    const avisos = [
      aviso({ monto: 410, evento: "Viaje" }),
      aviso({ monto: 420, evento: "Viaje" }),
      aviso({ monto: 430 }),
    ];
    const r = eventosHeredables([a, b, c, sinPareja], conciliarConCorreo([a, b, c, sinPareja], avisos));
    expect(r.get("Viaje")).toEqual([a.id, b.id]);
    expect(r.size).toBe(1);
  });
});

describe("filaAGastoCorreo", () => {
  it("resuelve el evento_id con el catálogo de eventos", () => {
    const { evento: _e, ...base } = aviso();
    const catalogo = new Map([["ev1", { nombre: "Viaje" }]]);
    expect(filaAGastoCorreo({ ...base, evento_id: "ev1" }, catalogo).evento).toBe("Viaje");
    const sin = filaAGastoCorreo({ ...base, evento_id: null }, catalogo);
    expect(sin.evento).toBeNull();
    expect("evento_id" in sin).toBe(false);
    // Un id que aún no está en el catálogo (recién creado) queda sin nombre, no truena.
    expect(filaAGastoCorreo({ ...base, evento_id: "nuevo" }, catalogo).evento).toBeNull();
  });
});
