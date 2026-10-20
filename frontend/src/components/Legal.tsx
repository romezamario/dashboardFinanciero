import { useEffect, type ReactNode } from "react";
import { NOMBRE_APP } from "../lib/edicion";
import { VERSION_TERMINOS } from "../lib/cuentaUsuario";

// Términos de servicio y aviso de privacidad de Ordena tu Lana.
// BORRADOR redactado sin abogado: necesita revisión legal antes del
// lanzamiento público (fase 4). Durante la beta el domicilio es solo la
// ciudad (decisión del responsable); el completo va antes del lanzamiento.
// El contacto es contacto@ordenatulana.com (Email Routing de Cloudflare →
// Gmail del responsable). Si cambias el texto, sube VERSION_TERMINOS
// (lib/cuentaUsuario.ts): es la versión que cada usuario aceptó.

export type DocumentoLegal = "terminos" | "privacidad";

export function Legal({ documento, onVolver }: { documento: DocumentoLegal; onVolver: () => void }) {
  useEffect(() => window.scrollTo(0, 0), [documento]);

  return (
    <div style={{ background: "var(--page-plane)", minHeight: "100vh", color: "var(--text-primary)" }}>
      <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <button type="button" onClick={onVolver} className="text-sm" style={{ color: "var(--text-secondary)" }}>
          ← Volver
        </button>
        <h1 className="mt-4 text-2xl font-bold">
          {documento === "terminos" ? "Términos de servicio" : "Aviso de privacidad"}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {NOMBRE_APP} · Versión {VERSION_TERMINOS}
        </p>
        <p
          role="note"
          className="mt-4 rounded-md px-3 py-2 text-sm"
          style={{ border: "1px solid var(--series-4)", color: "var(--text-secondary)" }}
        >
          Borrador durante la beta: este texto todavía no tiene revisión legal y puede cambiar antes del
          lanzamiento. Si cambia, te pediremos aceptarlo de nuevo.
        </p>
        <div className="mt-6 space-y-6 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {documento === "terminos" ? <Terminos /> : <Privacidad />}
        </div>
        <p className="mt-10 text-sm">
          {documento === "terminos" ? (
            <a href="#privacidad" style={{ color: "var(--marca)" }}>Ver el aviso de privacidad</a>
          ) : (
            <a href="#terminos" style={{ color: "var(--marca)" }}>Ver los términos de servicio</a>
          )}
        </p>
      </main>
    </div>
  );
}

function Apartado({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        {titulo}
      </h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function Terminos() {
  return (
    <>
      <Apartado titulo="1. El servicio">
        <p>
          {NOMBRE_APP} es una herramienta para ordenar y analizar tus movimientos bancarios a partir de los estados
          de cuenta que tú subes. No es un banco, no mueve dinero y no tiene acceso a tu banca en línea.
        </p>
      </Apartado>
      <Apartado titulo="2. Tu cuenta">
        <p>
          Necesitas un correo válido y una contraseña. Eres responsable de cuidar tu contraseña y de lo que se haga
          con tu cuenta. Puedes borrar tu cuenta cuando quieras desde Mi cuenta; al hacerlo se eliminan tus datos.
        </p>
      </Apartado>
      <Apartado titulo="3. Beta">
        <p>
          Durante la beta el servicio es gratuito, puede cambiar, tener errores o interrumpirse. Te recomendamos
          conservar tus estados de cuenta originales.
        </p>
      </Apartado>
      <Apartado titulo="4. No es asesoría financiera">
        <p>
          Los indicadores, alertas y categorías son cálculos automáticos con fines informativos. No son
          recomendaciones de inversión, crédito, impuestos ni de ningún otro tipo. Verifica los montos contra tu
          estado de cuenta antes de tomar decisiones.
        </p>
      </Apartado>
      <Apartado titulo="5. Uso aceptable">
        <p>
          Solo puedes subir información tuya o que tengas derecho a usar. No intentes acceder a datos de otras
          personas, saturar el servicio ni usarlo para fines ilícitos.
        </p>
      </Apartado>
      <Apartado titulo="6. Planes y pagos">
        <p>
          Cuando existan planes de pago, sus precios, lo que incluyen y cómo cancelarlos se publicarán antes de
          cobrarte cualquier cosa. Podrás cancelar desde Mi cuenta; al bajar de plan tus datos se conservan.
        </p>
      </Apartado>
      <Apartado titulo="7. Responsabilidad">
        <p>
          El servicio se ofrece «tal cual». En la medida que la ley lo permita, no somos responsables por
          decisiones tomadas con base en la información mostrada ni por errores al leer un estado de cuenta.
        </p>
      </Apartado>
      <Apartado titulo="8. Cambios y ley aplicable">
        <p>
          Si cambiamos estos términos te avisaremos y te pediremos aceptarlos de nuevo. Se rigen por las leyes de
          los Estados Unidos Mexicanos. Contacto: contacto@ordenatulana.com.
        </p>
      </Apartado>
    </>
  );
}

function Privacidad() {
  return (
    <>
      <Apartado titulo="Responsable">
        <p>
          Mario Alberto Rodríguez Meza, con domicilio en la Ciudad de México, es responsable del
          tratamiento de tus datos personales conforme a la Ley Federal de Protección de Datos Personales en
          Posesión de los Particulares. Contacto: contacto@ordenatulana.com.
        </p>
      </Apartado>
      <Apartado titulo="Qué datos tratamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Identificación y contacto: nombre y correo electrónico.</li>
          <li>
            Datos financieros (datos patrimoniales): los movimientos de tus estados de cuenta ya normalizados
            (fecha, descripción, monto, categoría), el alias de cada cuenta y solo los últimos 4 dígitos del número
            de cuenta o tarjeta.
          </li>
          <li>Datos técnicos necesarios para mantener tu sesión iniciada.</li>
        </ul>
        <p>
          Los archivos PDF de tus estados de cuenta se leen dentro de tu navegador y no se envían a nuestros
          servidores. No te pedimos ni guardamos contraseñas de tu banco.
        </p>
      </Apartado>
      <Apartado titulo="Para qué los usamos">
        <p>
          Finalidades necesarias: crear y administrar tu cuenta, mostrarte el análisis de tus finanzas, guardar tus
          reglas y preferencias, darte soporte y, cuando existan planes de pago, cobrar tu suscripción.
        </p>
        <p>
          No vendemos tus datos ni los usamos para publicidad de terceros. Tu consentimiento para tratar tus datos
          financieros se otorga al aceptar este aviso al registrarte.
        </p>
      </Apartado>
      <Apartado titulo="Con quién se comparten">
        <p>
          Solo con proveedores que nos prestan servicios y los tratan por nuestra cuenta: Supabase (base de datos y
          autenticación), Cloudflare (hospedaje del sitio) y, cuando haya cobros, Mercado Pago. Sus servidores
          pueden estar fuera de México. No hacemos otras transferencias salvo las que exija la ley.
        </p>
      </Apartado>
      <Apartado titulo="Tus derechos (ARCO)">
        <p>
          Puedes acceder a tus datos, rectificarlos, cancelarlos u oponerte a su tratamiento, y revocar tu
          consentimiento. Desde Mi cuenta puedes descargar todos tus movimientos y borrar tu cuenta con todos sus
          datos. Para cualquier otra solicitud escribe a contacto@ordenatulana.com; te responderemos en un máximo de 20
          días hábiles.
        </p>
      </Apartado>
      <Apartado titulo="Seguridad">
        <p>
          Cada usuario solo puede leer y modificar sus propios datos (seguridad a nivel de fila en la base de
          datos), la conexión va cifrada y los números de cuenta se guardan recortados a sus últimos 4 dígitos.
        </p>
      </Apartado>
      <Apartado titulo="Almacenamiento en tu navegador">
        <p>
          Usamos el almacenamiento local del navegador para mantener tu sesión y recordar preferencias como el
          tema claro u oscuro. No usamos cookies de publicidad.
        </p>
      </Apartado>
      <Apartado titulo="Cambios a este aviso">
        <p>Si este aviso cambia, lo publicaremos aquí y te pediremos aceptarlo de nuevo.</p>
      </Apartado>
    </>
  );
}
