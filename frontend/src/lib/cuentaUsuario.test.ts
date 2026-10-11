import { describe, expect, it } from "vitest";
import {
  confirmaBorrado,
  leerEnlaceDeAuth,
  problemaDeContrasena,
  rutaDeHash,
  traducirErrorAuth,
} from "./cuentaUsuario";

describe("rutaDeHash", () => {
  it("reconoce las pantallas públicas", () => {
    expect(rutaDeHash("#entrar")).toBe("entrar");
    expect(rutaDeHash("#registro")).toBe("registro");
    expect(rutaDeHash("#recuperar")).toBe("recuperar");
    expect(rutaDeHash("#terminos")).toBe("terminos");
    expect(rutaDeHash("#privacidad")).toBe("privacidad");
  });

  it("anclas de la landing, tokens de Supabase y vacío son el inicio", () => {
    expect(rutaDeHash("")).toBe("inicio");
    expect(rutaDeHash("#precios")).toBe("inicio");
    expect(rutaDeHash("#access_token=abc&type=signup")).toBe("inicio");
  });
});

describe("leerEnlaceDeAuth", () => {
  it("detecta el regreso desde Recuperar contraseña", () => {
    expect(leerEnlaceDeAuth("#access_token=abc&expires_in=3600&type=recovery")).toEqual({
      recuperacion: true,
      error: null,
    });
  });

  it("la confirmación del registro no es recuperación", () => {
    expect(leerEnlaceDeAuth("#access_token=abc&type=signup").recuperacion).toBe(false);
    expect(leerEnlaceDeAuth("").recuperacion).toBe(false);
  });

  it("un enlace vencido trae su mensaje", () => {
    const r = leerEnlaceDeAuth("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
    expect(r.recuperacion).toBe(false);
    expect(r.error).toMatch(/venció/);
    expect(leerEnlaceDeAuth("#error=server_error").error).toMatch(/No se pudo/);
  });
});

describe("traducirErrorAuth", () => {
  it("traduce los errores comunes", () => {
    expect(traducirErrorAuth("Invalid login credentials")).toBe("Correo o contraseña incorrectos.");
    expect(traducirErrorAuth("Email not confirmed")).toMatch(/confirmas tu correo/);
    expect(traducirErrorAuth("User already registered")).toMatch(/Ya existe/);
    expect(traducirErrorAuth("email rate limit exceeded")).toMatch(/Demasiados intentos/);
    expect(traducirErrorAuth("Failed to fetch")).toMatch(/conexión/);
  });

  it("deja pasar lo que no conoce", () => {
    expect(traducirErrorAuth("Algo raro")).toBe("Algo raro");
  });
});

describe("problemaDeContrasena", () => {
  it("pide largo, letras, números y que coincidan", () => {
    expect(problemaDeContrasena("abc1", "abc1")).toMatch(/8 caracteres/);
    expect(problemaDeContrasena("abcdefgh", "abcdefgh")).toMatch(/letras y números/);
    expect(problemaDeContrasena("12345678", "12345678")).toMatch(/letras y números/);
    expect(problemaDeContrasena("abcd1234", "abcd1235")).toMatch(/no coinciden/);
    expect(problemaDeContrasena("abcd1234", "abcd1234")).toBeNull();
  });
});

describe("confirmaBorrado", () => {
  it("acepta la palabra sin importar mayúsculas ni espacios", () => {
    expect(confirmaBorrado(" borrar ")).toBe(true);
    expect(confirmaBorrado("BORRAR")).toBe(true);
    expect(confirmaBorrado("borra")).toBe(false);
    expect(confirmaBorrado("")).toBe(false);
  });
});
