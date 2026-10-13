import { describe, expect, it } from "vitest";
import { correoPlanActivo, correoPlanCancelado, fechaCorreo, pesos } from "./correosCobro.ts";

const SITIO = "https://ordenatulana.com";

describe("correos de cobro", () => {
  it("formatea fechas y montos como en la app", () => {
    expect(fechaCorreo("2027-10-13T00:00:00.000-04:00")).toBe("13 oct 2027");
    expect(pesos(599)).toBe("$599");
    expect(pesos(24.5)).toBe("$24.50");
  });

  it("plan activo: plan, próximo cobro y cambio de plan", () => {
    const c = correoPlanActivo({
      nombre: "Mario Rodriguez",
      plan: "Pro",
      periodo: "anual",
      monto: 599,
      proximoCobro: "2027-10-13T10:00:00Z",
      cambioDePlan: true,
      sitio: SITIO,
    });
    expect(c.asunto).toBe("Tu plan Pro anual está activo");
    expect(c.html).toContain("Hola, Mario");
    expect(c.texto).toContain("Tu próximo cobro será de $599 el 13 oct 2027.");
    expect(c.texto).toContain("Tu plan anterior ya no se cobrará.");
    expect(c.texto).toContain(`Abrir mi tablero: ${SITIO}`);
    expect(c.texto).not.toMatch(/<[a-z]/);
  });

  it("sin cambio de plan no menciona el anterior; sin nombre saluda igual", () => {
    const c = correoPlanActivo({ nombre: null, plan: "Básico", periodo: "mensual", monto: 29, proximoCobro: null, cambioDePlan: false, sitio: SITIO });
    expect(c.html).toContain("Hola, ¡ya tienes Básico!");
    expect(c.texto).not.toContain("anterior");
    expect(c.texto).toContain("cada mes");
  });

  it("escapa el nombre del cliente", () => {
    const c = correoPlanActivo({ nombre: "<script>x", plan: "Pro", periodo: "anual", monto: 599, proximoCobro: null, cambioDePlan: false, sitio: SITIO });
    expect(c.html).not.toContain("<script>");
    expect(c.html).toContain("&lt;script&gt;x");
  });

  it("plan cancelado: hasta cuándo lo conserva", () => {
    const c = correoPlanCancelado({ nombre: "Ana", plan: "Pro", periodo: "anual", hasta: "2027-10-13T00:00:00Z", sitio: SITIO });
    expect(c.asunto).toBe("Cancelaste tu plan Pro anual");
    expect(c.texto).toContain("Ya no se te volverá a cobrar.");
    expect(c.texto).toContain("Lo sigues usando hasta el 13 oct 2027; después pasas al plan Gratis.");
  });
});
