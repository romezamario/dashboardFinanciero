import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("./supabase", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
  },
}));

const datos = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => datos.get(k) ?? null,
  setItem: (k: string, v: string) => void datos.set(k, v),
});

beforeEach(() => {
  vi.resetModules();
  rpc.mockReset();
  datos.clear();
});

describe("soyInvitado", () => {
  it("pregunta una sola vez por usuario y guarda la respuesta", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const { soyInvitado } = await import("./accesoCompartido");
    expect(await soyInvitado()).toBe(false);
    expect(await soyInvitado()).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(datos.get("soy_invitado:u1")).toBe("0");
  });

  it("con respuesta guardada contesta sin esperar a la RPC", async () => {
    datos.set("soy_invitado:u1", "0");
    rpc.mockReturnValue(new Promise(() => {}));
    const { soyInvitado } = await import("./accesoCompartido");
    expect(await soyInvitado()).toBe(false);
  });

  it("un error cuenta como dueño, no se guarda y se reintenta", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const { soyInvitado } = await import("./accesoCompartido");
    expect(await soyInvitado()).toBe(false);
    expect(datos.has("soy_invitado:u1")).toBe(false);
    expect(await soyInvitado()).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
