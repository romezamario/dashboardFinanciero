import { describe, expect, it } from "vitest";
import {
  haceCuanto,
  leerResultadoOauth,
  necesitaConectar,
  sinResultadoOauth,
  textoEstadoGmail,
  textoResultadoOauth,
  type RevisionGmail,
} from "./gmailNube";

const ahora = new Date("2026-11-20T12:00:00Z");
const revision = (cambios: Partial<RevisionGmail> = {}): RevisionGmail => ({
  empezo_en: "2026-11-20T11:50:00Z",
  origen: "programada",
  resultado: "ok",
  mensaje: null,
  avisos: 4,
  nuevos: 0,
  recategorizados: 0,
  debitos: 0,
  ilegibles: [],
  sin_categoria: [],
  codigos_sin_confirmar: [],
  ...cambios,
});
const conexion = { correo: null, actualizado_en: "2026-11-20T10:00:00Z" };

describe("haceCuanto", () => {
  it("minutos, horas y días", () => {
    expect(haceCuanto("2026-11-20T11:59:50Z", ahora)).toBe("hace un momento");
    expect(haceCuanto("2026-11-20T11:48:00Z", ahora)).toBe("hace 12 min");
    expect(haceCuanto("2026-11-20T09:00:00Z", ahora)).toBe("hace 3 h");
    expect(haceCuanto("2026-11-19T12:00:00Z", ahora)).toBe("hace 1 día");
  });
});

describe("textoEstadoGmail", () => {
  it("sin conexión pide conectar Gmail", () => {
    const r = textoEstadoGmail({ conexion: null, ultima: null, ultimaBien: null }, ahora);
    expect(r.problema).toBe(true);
    expect(r.texto).toMatch(/Conectar Gmail/);
  });

  it("una conexión inválida pide reconectar", () => {
    const r = textoEstadoGmail({ conexion: { ...conexion, invalida: true }, ultima: revision(), ultimaBien: revision() }, ahora);
    expect(r.problema).toBe(true);
    expect(r.texto).toMatch(/Reconectar Gmail/);
  });

  it("revisión reciente con avisos nuevos", () => {
    const r = textoEstadoGmail({ conexion, ultima: revision({ nuevos: 2 }), ultimaBien: revision({ nuevos: 2 }) }, ahora);
    expect(r).toEqual({ texto: "Gmail revisado hace 10 min · 2 avisos nuevos. Se revisa solo cada 15 minutos.", problema: false });
  });

  it("una revisión fallida muestra su mensaje", () => {
    const r = textoEstadoGmail(
      { conexion, ultima: revision({ resultado: "permiso_invalido", mensaje: "El permiso venció." }), ultimaBien: revision() },
      ahora
    );
    expect(r.problema).toBe(true);
    expect(r.texto).toMatch(/falló: El permiso venció\./);
  });

  it("más de una hora sin revisar bien es un problema", () => {
    const vieja = revision({ empezo_en: "2026-11-20T10:30:00Z" });
    expect(textoEstadoGmail({ conexion, ultima: vieja, ultimaBien: vieja }, ahora).problema).toBe(true);
  });
});

describe("autorización desde el dashboard", () => {
  it("lee el resultado del regreso y lo quita de la URL", () => {
    expect(leerResultadoOauth("?gmail=conectado")).toEqual({ resultado: "conectado", detalle: null });
    expect(leerResultadoOauth("?gmail=error&gmail_detalle=Google%20respondi%C3%B3%20400")).toEqual({
      resultado: "error",
      detalle: "Google respondió 400",
    });
    expect(leerResultadoOauth("?gmail=otra")).toBeNull();
    expect(leerResultadoOauth("")).toBeNull();
    expect(sinResultadoOauth("https://sitio.test/?gmail=error&gmail_detalle=x&otro=1#finanzas")).toBe("https://sitio.test/?otro=1#finanzas");
    expect(sinResultadoOauth("https://sitio.test/?gmail=conectado#finanzas")).toBe("https://sitio.test/#finanzas");
  });

  it("textos del resultado", () => {
    expect(textoResultadoOauth({ resultado: "conectado", detalle: null }).error).toBe(false);
    expect(textoResultadoOauth({ resultado: "error", detalle: "x" }).texto).toBe("No se pudo conectar Gmail: x");
    expect(textoResultadoOauth({ resultado: "sin_permiso", detalle: null }).error).toBe(true);
  });

  it("cuándo hay que (re)conectar", () => {
    expect(necesitaConectar({ conexion: null, ultima: null, ultimaBien: null })).toBe(true);
    expect(necesitaConectar({ conexion, ultima: revision(), ultimaBien: revision() })).toBe(false);
    expect(necesitaConectar({ conexion: { ...conexion, invalida: true }, ultima: revision(), ultimaBien: revision() })).toBe(true);
    expect(necesitaConectar({ conexion, ultima: revision({ resultado: "permiso_invalido" }), ultimaBien: null })).toBe(true);
  });
});
