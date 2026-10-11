/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** "producto" = FinanzasPersonales (instancia de clientes); sin valor = personal. */
  readonly VITE_EDICION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
