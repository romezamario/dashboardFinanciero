import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // supabase.ts exige estas variables al importarse; las pruebas nunca
    // hacen peticiones reales (las funciones de red reciben la consulta).
    env: { VITE_SUPABASE_URL: 'http://localhost', VITE_SUPABASE_ANON_KEY: 'prueba' },
  },
})
