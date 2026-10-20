import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Letras de Ordena tu Lana, servidas desde el propio sitio (sin Google Fonts).
// Solo se descargan si una regla las usa, y la edición personal no las usa.
import '@fontsource-variable/inter'
import '@fontsource/league-spartan/latin-700.css'
import './index.css'
import App from './App.tsx'
import { NOMBRE_APP } from './lib/edicion'

document.title = NOMBRE_APP

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
