import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANES } from "../../../frontend/src/lib/planes.ts";

// La página de precios (planes.ts) y lo que cobra la Edge Function (tabla
// planes, sembrada en una migración) tienen que decir lo mismo.
describe("precios", () => {
  it("la tabla planes de la migración cobra lo mismo que anuncia planes.ts", () => {
    const carpeta = join(__dirname, "../../migrations");
    const sql = readdirSync(carpeta)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(carpeta, f), "utf8"))
      .join("\n");
    for (const plan of PLANES) {
      // La última migración que siembra el plan es la vigente.
      const fila = [...sql.matchAll(new RegExp(`\\('${plan.id}', '[^']+', (\\d+), (\\d+),`, "g"))].at(-1) ?? null;
      expect(fila, plan.id).not.toBeNull();
      expect(Number(fila![1])).toBe(plan.precioMensual);
      expect(Number(fila![2])).toBe(plan.precioAnual ?? 0);
    }
  });
});
