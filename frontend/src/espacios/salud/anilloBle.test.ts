import { describe, expect, it } from "vitest";
import {
  bytesAHex,
  cifrarNonce,
  hexABytes,
  leerBateria,
  leerEstadoFuncion,
  leerFirmware,
  leerResultadoAuth,
  normalizarClave,
} from "./anilloBle";

describe("hex y clave", () => {
  it("ida y vuelta", () => {
    expect(bytesAHex(hexABytes("2f 01 2b"))).toBe("2f012b");
    expect(() => hexABytes("2f0")).toThrow();
  });
  it("normaliza la clave de oura.key", () => {
    expect(normalizarClave("00112233445566778899AABBCCDDEEFF\r\n")).toBe("00112233445566778899aabbccddeeff");
    expect(normalizarClave("1234")).toBeNull();
  });
});

describe("cifrarNonce", () => {
  it("es igual a AES-128/ECB/PKCS5 (como el anillo y la app de Oura)", async () => {
    // Vector calculado con node:crypto createCipheriv("aes-128-ecb", ...) sobre
    // el nonce de 15 bytes (relleno PKCS5 incluido).
    const r = await cifrarNonce(hexABytes("000102030405060708090a0b0c0d0e0f"), hexABytes("00112233445566778899aabbccddee"));
    expect(bytesAHex(r)).toBe("77a0785a36a150ed8831ce8aef66ded4");
  });
  it("valida tamaños", async () => {
    await expect(cifrarNonce(new Uint8Array(15), new Uint8Array(15))).rejects.toThrow();
    await expect(cifrarNonce(new Uint8Array(16), new Uint8Array(16))).rejects.toThrow();
  });
});

describe("respuestas del anillo (cheatsheet de open_oura)", () => {
  it("batería", () => {
    expect(leerBateria(hexABytes("0d065a00010000"))).toEqual({ porcentaje: 90, cargando: false });
    expect(leerBateria(hexABytes("2f022f01"))).toBeNull();
  });
  it("firmware 3.4.3 del Ring 3 Horizon", () => {
    expect(leerFirmware(hexABytes("091202000003040301000105000cffeeddccbbaa"))).toEqual({
      api: "2.0.0",
      firmware: "3.4.3",
      bootloader: "1.0.1",
      bluetooth: "5.0.12",
    });
  });
  it("estado de una función", () => {
    expect(leerEstadoFuncion(hexABytes("2f06210201000000"))).toEqual({ funcion: 2, modo: 1, suscripcion: 0 });
    expect(leerEstadoFuncion(hexABytes("2f022f01"))).toBeNull();
  });
  it("resultado de la autenticación", () => {
    expect(leerResultadoAuth(hexABytes("2f022e00"))).toBe("ok");
    expect(leerResultadoAuth(hexABytes("2f022e01"))).toBe("clave-incorrecta");
    expect(leerResultadoAuth(hexABytes("2f022f01"))).toBe("desconocido");
  });
});
