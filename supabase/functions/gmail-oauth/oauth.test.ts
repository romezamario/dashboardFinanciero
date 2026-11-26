import { describe, expect, it } from "vitest";
import { ALCANCE_GMAIL, concedioGmail, direccionDeRegreso, nuevoEstado, sitioPermitido, urlAutorizacion, urlResultado } from "./oauth.ts";

describe("sitioPermitido", () => {
  it("acepta el dashboard, sus ligas de deploy y localhost", () => {
    expect(sitioPermitido("https://dashboard-personal-8uu.pages.dev")).toBe(true);
    expect(sitioPermitido("https://abc123.dashboard-personal-8uu.pages.dev")).toBe(true);
    expect(sitioPermitido("http://localhost:5173")).toBe(true);
  });
  it("rechaza otros sitios, http fuera de localhost y rutas", () => {
    expect(sitioPermitido("https://malo.test")).toBe(false);
    expect(sitioPermitido("https://dashboard-financiero-c5z.pages.dev")).toBe(false);
    expect(sitioPermitido("https://dashboard-personal-8uu.pages.dev.malo.test")).toBe(false);
    expect(sitioPermitido("https://xdashboard-personal-8uu.pages.dev")).toBe(false);
    expect(sitioPermitido("http://dashboard-personal-8uu.pages.dev")).toBe(false);
    expect(sitioPermitido("https://dashboard-personal-8uu.pages.dev/otra")).toBe(false);
    expect(sitioPermitido("javascript:alert(1)")).toBe(false);
    expect(sitioPermitido("")).toBe(false);
  });
  it("acepta orígenes extra exactos", () => {
    expect(sitioPermitido("https://mio.test", ["https://mio.test"])).toBe(true);
  });
});

describe("URLs", () => {
  it("arma la autorización con permiso offline y de solo lectura", () => {
    const u = new URL(urlAutorizacion({ clientId: "cid", redirect: "https://x.supabase.co/functions/v1/gmail-oauth", estado: "st", correo: "a@gmail.com" }));
    expect(u.origin).toBe("https://accounts.google.com");
    expect(u.searchParams.get("scope")).toBe(ALCANCE_GMAIL);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("login_hint")).toBe("a@gmail.com");
  });
  it("regresa al dashboard con el resultado", () => {
    expect(direccionDeRegreso("https://dashboard-personal-8uu.pages.dev")).toBe("https://dashboard-personal-8uu.pages.dev/");
    expect(direccionDeRegreso("https://malo.test")).toBeNull();
    const r = new URL(urlResultado("https://dashboard-personal-8uu.pages.dev/", "error", "x".repeat(300)));
    expect(r.searchParams.get("gmail")).toBe("error");
    expect(r.searchParams.get("gmail_detalle")).toHaveLength(200);
    expect(r.hash).toBe("#finanzas");
  });
  it("state largo y distinto cada vez", () => {
    const a = nuevoEstado();
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).not.toBe(nuevoEstado());
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("detecta si se desmarcó el permiso de Gmail", () => {
    expect(concedioGmail(`openid ${ALCANCE_GMAIL}`)).toBe(true);
    expect(concedioGmail("openid")).toBe(false);
    expect(concedioGmail(undefined)).toBe(false);
  });
});
