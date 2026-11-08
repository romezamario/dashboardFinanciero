import { describe, expect, it, vi } from "vitest";
import { crearFetchConReintento } from "./reintentoSesion";

const URL_DATOS = "https://x.supabase.co/rest/v1/documentos?select=*";

function encabezados(token: string) {
  return new Headers({ apikey: "anon", Authorization: `Bearer ${token}` });
}

function fetchFalso(estadoPorToken: Record<string, number>) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const token = new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
    return new Response("{}", { status: estadoPorToken[token] ?? 200 });
  });
}

describe("crearFetchConReintento", () => {
  it("renueva y repite una vez con el token nuevo ante un 401", async () => {
    const base = fetchFalso({ viejo: 401, nuevo: 200 });
    const renovar = vi.fn(async () => "nuevo");
    const alFallar = vi.fn();
    const f = crearFetchConReintento(base, renovar, alFallar);
    const r = await f(URL_DATOS, { headers: encabezados("viejo") });
    expect(r.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
    expect(renovar).toHaveBeenCalledTimes(1);
    expect(alFallar).not.toHaveBeenCalled();
  });

  it("varias llamadas que fallan a la vez comparten una sola renovación", async () => {
    const base = fetchFalso({ viejo: 401 });
    const renovar = vi.fn(async () => "nuevo");
    const f = crearFetchConReintento(base, renovar, vi.fn());
    const respuestas = await Promise.all(
      [1, 2, 3, 4, 5].map(() => f(URL_DATOS, { headers: encabezados("viejo") }))
    );
    expect(respuestas.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(renovar).toHaveBeenCalledTimes(1);
  });

  it("si la sesión ya no sirve, cierra la sesión y devuelve el 401", async () => {
    const base = fetchFalso({ viejo: 401 });
    const alFallar = vi.fn();
    const f = crearFetchConReintento(base, async () => null, alFallar);
    const r = await f(URL_DATOS, { headers: encabezados("viejo") });
    expect(r.status).toBe(401);
    expect(alFallar).toHaveBeenCalledTimes(1);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("un error de red al renovar no cierra la sesión", async () => {
    const alFallar = vi.fn();
    const f = crearFetchConReintento(
      fetchFalso({ viejo: 401 }),
      async () => {
        throw new Error("sin red");
      },
      alFallar
    );
    expect((await f(URL_DATOS, { headers: encabezados("viejo") })).status).toBe(401);
    expect(alFallar).not.toHaveBeenCalled();
  });

  it("no reintenta con solo la llave anónima, ni fuera de rest/functions, ni si no es 401", async () => {
    const renovar = vi.fn(async () => "nuevo");
    const f = crearFetchConReintento(fetchFalso({ anon: 401, viejo: 401 }), renovar, vi.fn());
    expect((await f(URL_DATOS, { headers: encabezados("anon") })).status).toBe(401);
    expect(
      (await f("https://x.supabase.co/auth/v1/user", { headers: encabezados("viejo") })).status
    ).toBe(401);
    const f2 = crearFetchConReintento(fetchFalso({ viejo: 403 }), renovar, vi.fn());
    expect((await f2(URL_DATOS, { headers: encabezados("viejo") })).status).toBe(403);
    expect(renovar).not.toHaveBeenCalled();
  });
});
