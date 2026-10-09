import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { onRequestGet as cotizaciones } from './functions/api/cotizaciones.ts'
import { obtenerDatosMacro } from './scripts/fred.ts'

// En producción /api/cotizaciones es una Cloudflare Pages Function
// (functions/api/) y /macro.json un archivo estático que genera el deploy
// (scripts/descargar-macro.ts). En `npm run dev` no hay runtime de Cloudflare
// ni deploy, así que se sirven con middleware de Vite.
const RUTAS_API: Record<string, (contexto: { request: Request }) => Promise<Response>> = {
  '/api/cotizaciones': cotizaciones,
  '/macro.json': async () => Response.json(await obtenerDatosMacro()),
}

function apiLocal(): Plugin {
  return {
    name: 'api-local',
    configureServer(server) {
      for (const [ruta, handler] of Object.entries(RUTAS_API)) {
        server.middlewares.use(ruta, async (req, res) => {
          const url = new URL(req.originalUrl ?? req.url ?? '', 'http://localhost')
          const respuesta = await handler({ request: new Request(url) })
          res.statusCode = respuesta.status
          respuesta.headers.forEach((valor, clave) => res.setHeader(clave, valor))
          res.end(await respuesta.text())
        })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), apiLocal()],
  build: {
    rollupOptions: {
      output: {
        // Recharts (y sus dependencias d3) en su propio archivo: no cambia
        // entre deploys, así que el navegador lo conserva en caché aunque
        // cambie el código del tablero.
        manualChunks(id) {
          if (/node_modules\/(recharts|d3-|victory-vendor)/.test(id)) return 'recharts'
        },
      },
    },
  },
})
