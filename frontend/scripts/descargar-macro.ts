// Genera public/macro.json con los indicadores de FRED (ver fred.ts). Lo
// corre el workflow de deploy antes del build:
//   node scripts/descargar-macro.ts
// Sale con error si no se pudo bajar NINGUNA serie (en el deploy programado
// eso cancela la publicación y se queda en línea la versión anterior).

import { mkdirSync, writeFileSync } from "node:fs";
import { obtenerDatosMacro, SERIES_MACRO } from "./fred.ts";

const datos = await obtenerDatosMacro();
const fallidas = Object.entries(datos.errores);
for (const [serie, error] of fallidas) console.warn(`No se pudo descargar ${serie}: ${error}`);
if (fallidas.length === SERIES_MACRO.length) {
  console.error("No se pudo descargar ninguna serie de FRED.");
  process.exit(1);
}
mkdirSync("public", { recursive: true });
writeFileSync("public/macro.json", JSON.stringify(datos));
console.log(`public/macro.json: ${SERIES_MACRO.length - fallidas.length}/${SERIES_MACRO.length} series.`);
