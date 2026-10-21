import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { onRequestGet as agenteSaldo } from './functions/api/agente-saldo.ts'
import { onRequestGet as alpacaEnVivo } from './functions/api/alpaca-en-vivo.ts'
import { onRequestGet as alpacaHistorial } from './functions/api/alpaca-historial.ts'
import { onRequestGet as cotizaciones } from './functions/api/cotizaciones.ts'
import { obtenerDatosMacro } from './scripts/fred.ts'

// En producción /api/cotizaciones es una Cloudflare Pages Function
// (functions/api/) y /macro.json un archivo estático que genera el deploy
// (scripts/descargar-macro.ts). En `npm run dev` no hay runtime de Cloudflare
// ni deploy, así que se sirven con middleware de Vite.
const RUTAS_API: Record<string, (contexto: { request: Request }) => Promise<Response>> = {
  '/api/cotizaciones': cotizaciones,
  '/macro.json': async () => Response.json(await obtenerDatosMacro()),
  '/api/agente-saldo': (contexto) =>
    agenteSaldo({ ...contexto, env: { GITHUB_TOKEN_AGENTE: process.env.GITHUB_TOKEN_AGENTE } }),
  '/api/alpaca-historial': (contexto) =>
    alpacaHistorial({
      ...contexto,
      env: {
        ALPACA_API_KEY_ID: process.env.ALPACA_API_KEY_ID,
        ALPACA_API_SECRET_KEY: process.env.ALPACA_API_SECRET_KEY,
      },
    }),
  '/api/alpaca-en-vivo': (contexto) =>
    alpacaEnVivo({
      ...contexto,
      env: {
        ALPACA_API_KEY_ID: process.env.ALPACA_API_KEY_ID,
        ALPACA_API_SECRET_KEY: process.env.ALPACA_API_SECRET_KEY,
      },
    }),
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

// Ordena tu Lana (VITE_EDICION=producto): su nombre, ícono, descripción e imagen
// para cuando se comparte el enlace (WhatsApp, Facebook), y data-edicion en <html>
// para los colores y letras de la marca (index.css). La edición personal queda igual.
const SITIO_PRODUCTO = 'https://ordenatulana.com'
const DESCRIPCION_PRODUCTO =
  'Sube tu estado de cuenta y descubre a dónde se va tu dinero cada mes: cuánto ahorras, en qué gastas y qué cargos revisar. Sin conectar tu banco y sin capturar a mano.'

function marcaProducto(edicion: string | undefined): Plugin {
  return {
    name: 'marca-producto',
    transformIndexHtml(html) {
      if (edicion !== 'producto') return html
      const titulo = 'Ordena tu Lana: descubre a dónde se va tu dinero'
      const cabeza = [
        `<meta name="description" content="${DESCRIPCION_PRODUCTO}" />`,
        // Abre en oscuro; el script de tema de index.html lo ajusta al elegido.
        '<meta name="theme-color" content="#0d0d0d" />',
        // PNG múltiplo de 48 px: el que Google usa en los resultados de búsqueda.
        '<link rel="icon" type="image/png" sizes="96x96" href="/marca/favicon-96.png" />',
        '<link rel="apple-touch-icon" href="/marca/apple-touch-icon.png" />',
        '<link rel="manifest" href="/marca/manifest.webmanifest" />',
        '<meta property="og:type" content="website" />',
        '<meta property="og:locale" content="es_MX" />',
        '<meta property="og:site_name" content="Ordena tu Lana" />',
        `<meta property="og:title" content="${titulo}" />`,
        `<meta property="og:description" content="${DESCRIPCION_PRODUCTO}" />`,
        `<meta property="og:url" content="${SITIO_PRODUCTO}/" />`,
        `<meta property="og:image" content="${SITIO_PRODUCTO}/marca/compartir.png" />`,
        '<meta property="og:image:width" content="1200" />',
        '<meta property="og:image:height" content="630" />',
        '<meta name="twitter:card" content="summary_large_image" />',
      ].join('\n    ')
      return html
        .replace('<html lang="es">', '<html lang="es" data-edicion="producto">')
        .replace('href="/favicon.svg"', 'href="/marca/favicon.svg"')
        .replace('<title>Dashboard Financiero</title>', `<title>${titulo}</title>\n    ${cabeza}`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), apiLocal(), marcaProducto(loadEnv(mode, process.cwd(), 'VITE_').VITE_EDICION)],
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
}))
