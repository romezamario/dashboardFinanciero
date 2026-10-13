/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** "producto" = FinanzasPersonales (instancia de clientes); sin valor = personal. */
  readonly VITE_EDICION?: string;
  /** Public Key de Mercado Pago (edición producto): formulario de tarjeta embebido. */
  readonly VITE_MP_PUBLIC_KEY?: string;
  /** "produccion" solo en el build de ordenatulana.com; sin valor = prueba. */
  readonly VITE_MP_MODO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
