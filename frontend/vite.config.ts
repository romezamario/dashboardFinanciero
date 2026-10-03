import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { onRequestGet as cotizaciones } from './functions/api/cotizaciones.ts'
import { onRequestGet as macro } from './functions/api/macro.ts'

// En producción /api/* son Cloudflare Pages Functions (functions/api/). En
// `npm run dev` no hay runtime de Cloudflare, así que se montan los mismos
// handlers como middleware de Vite.
const RUTAS_API: Record<string, (contexto: { request: Request }) => Promise<Response>> = {
  '/api/cotizaciones': cotizaciones,
  '/api/macro': macro,
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
})
