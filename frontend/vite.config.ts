import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { onRequestGet as cotizaciones } from './functions/api/cotizaciones.ts'

// En producción /api/cotizaciones es una Cloudflare Pages Function
// (functions/api/cotizaciones.ts). En `npm run dev` no hay runtime de
// Cloudflare, así que se monta el mismo handler como middleware de Vite.
function apiLocal(): Plugin {
  return {
    name: 'api-local',
    configureServer(server) {
      server.middlewares.use('/api/cotizaciones', async (req, res) => {
        const url = new URL(req.originalUrl ?? req.url ?? '', 'http://localhost')
        const respuesta = await cotizaciones({ request: new Request(url) })
        res.statusCode = respuesta.status
        respuesta.headers.forEach((valor, clave) => res.setHeader(clave, valor))
        res.end(await respuesta.text())
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), apiLocal()],
})
