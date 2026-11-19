// Empaqueta el reporte semanal de salud (src/espacios/salud/reporte/enviar.ts)
// en un solo archivo para Node: `npx vite build --config scripts/vite.reporte-salud.ts`
// → dist-reporte/reporte.mjs. Lo usa .github/workflows/reporte-salud.yml.
// supabase.ts exige estas variables al importarse; el reporte no usa ese
// cliente (lee con la API de administración), así que van valores de relleno.
import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://localhost'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('sin-uso'),
  },
  publicDir: false,
  ssr: { noExternal: true },
  build: {
    ssr: 'src/espacios/salud/reporte/enviar.ts',
    outDir: 'dist-reporte',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'reporte.mjs' } },
  },
})
