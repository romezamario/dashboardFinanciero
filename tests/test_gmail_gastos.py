"""Lectura de avisos de Banamex contra HTML sintético (misma estructura que el
aviso real, con datos inventados: nunca se versionan correos reales) y contra
un servicio de Gmail falso, sin red ni credenciales."""

from __future__ import annotations

import base64
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest import mock

from sync.gmail_gastos import (
    FaltaConfiguracionSupabase,
    FaltanCredencialesGmail,
    FaltanLibreriasGoogle,
    LimiteDeGmail,
    PermisoGmailInvalido,
    REINTENTOS_GMAIL,
    a_gasto,
    agrupar_por_dia,
    avisos_para_mostrar,
    cargar_gastos_recientes,
    ciudad_de,
    crear_servicio_gmail,
    escribir_dias,
    hay_permiso_guardado,
    html_del_mensaje,
    ids_guardados,
    leer_avisos,
    parsear_aviso,
    resumen_revision,
    revisar_gmail,
)
from tests.test_gastos_correo import ClienteFalso
from transform.categorizador import Regla

_P = "<p style='x'>\n\t\t\t\t\t{}\n\t\t\t\t</p>"


def _fila(etiqueta: str, valor: str) -> str:
    return f"<tr><td>{_P.format(etiqueta)}</td><td></td><td><p><b>{valor}</b></p></td></tr>"


def aviso_html(
    *, monto="$ 14.81", establecimiento="TIENDA DEMO  CENTRO  MCA", fecha="03 Octubre 2026 / 13:22:26",
    estatus="Exitoso", tarjeta_html="BEYOND BANAMEX\n\t\t&nbsp;Adicional&nbsp;\n\t\t179", operacion="Retiro / Compra",
) -> str:
    return (
        "<html><body><table><tr><td><p><b>Se realiz&oacute; la siguiente operaci&oacute;n: "
        f"{operacion}<br></b></p><p>NOMBRE DEMO <br></p></td></tr>"
        f"<tr><td><b>{tarjeta_html}</b></td></tr>"
        "<tr><td><b>Detalle de la operaci&oacute;n</b></td></tr>"
        + _fila("Monto", monto)
        + _fila("Establecimiento", establecimiento)
        + _fila("Fecha y hora", fecha)
        + _fila("Estatus", f"\n\t\t\t\t{estatus}\n\t\t\t")
        + _fila("No. Autorizaci&oacute;n", "123456")
        + "</table></body></html>"
    )


REGLAS = [Regla("TIENDA DEMO", "Compras", "Demo"), Regla("GAS", "Transporte", "Gasolinera")]


class ParsearAvisoTest(unittest.TestCase):
    def test_tarjeta_adicional_con_hora_24h(self) -> None:
        a = parsear_aviso(aviso_html(), "m1")
        self.assertEqual(
            a,
            {
                "id": "m1", "fecha": "2026-10-03", "hora": "13:22", "tarjeta": "179",
                "establecimiento": "TIENDA DEMO CENTRO MCA", "monto": Decimal("14.81"),
            },
        )

    def test_tarjeta_titular_con_hora_12h(self) -> None:
        pm = parsear_aviso(
            aviso_html(tarjeta_html="BEYOND BANAMEX**904", monto="$148.26", fecha="2026/10/3 05:04:16 PM"), "m2"
        )
        self.assertEqual((pm["tarjeta"], pm["fecha"], pm["hora"], pm["monto"]), ("904", "2026-10-03", "17:04", Decimal("148.26")))
        noon = parsear_aviso(aviso_html(tarjeta_html="BEYOND BANAMEX**904", fecha="2026/10/3 12:01:01 PM"), "m3")
        self.assertEqual(noon["hora"], "12:01")
        medianoche = parsear_aviso(aviso_html(tarjeta_html="BEYOND BANAMEX**904", fecha="2026/10/3 12:05:00 AM"), "m4")
        self.assertEqual(medianoche["hora"], "00:05")

    def test_monto_con_miles(self) -> None:
        self.assertEqual(parsear_aviso(aviso_html(monto="$ 2,769.06"), "m")["monto"], Decimal("2769.06"))

    def test_conserva_codigo_pegado_al_nombre(self) -> None:
        a = parsear_aviso(aviso_html(establecimiento="BATH AND BODY WORKS#55MCA"), "m")
        self.assertEqual(a["establecimiento"], "BATH AND BODY WORKS#55MCA")

    def test_no_es_cargo_exitoso_devuelve_none(self) -> None:
        self.assertIsNone(parsear_aviso(aviso_html(estatus="Rechazado"), "m"))
        self.assertIsNone(parsear_aviso(aviso_html(operacion="Pago de tarjeta"), "m"))

    def test_campo_ilegible_devuelve_none_en_vez_de_adivinar(self) -> None:
        self.assertIsNone(parsear_aviso(aviso_html(monto="sin monto"), "m"))
        self.assertIsNone(parsear_aviso(aviso_html(fecha="ayer"), "m"))
        self.assertIsNone(parsear_aviso(aviso_html(fecha="03 Brumario 2026 / 10:00:00"), "m"))
        self.assertIsNone(parsear_aviso(aviso_html(tarjeta_html="TARJETA SIN TERMINACION"), "m"))
        self.assertIsNone(parsear_aviso("<html><body>hola</body></html>", "m"))


class CiudadTest(unittest.TestCase):
    def test_codigos_confirmados_y_sin_confirmar(self) -> None:
        self.assertEqual(ciudad_de("MACYS LA PLAZA MALL MCA"), ("MCA", "McAllen"))
        self.assertEqual(ciudad_de("GAS APODACA CENTRO APO"), ("APO", "Apodaca"))
        self.assertEqual(ciudad_de("STARBUCKS MX CR CIU"), ("CIU", None))
        self.assertEqual(ciudad_de("BATH AND BODY WORKS#55MCA"), ("MCA", "McAllen"))

    def test_codigo_pais_toma_la_palabra_anterior(self) -> None:
        self.assertEqual(ciudad_de("TELEVIA CADEREYTA MEX"), ("MEX", "Cadereyta"))
        self.assertEqual(ciudad_de("TELEVIA PTE CADEREYTA MEX"), ("MEX", "Cadereyta"))

    def test_ciudades_extra_del_usuario(self) -> None:
        self.assertEqual(ciudad_de("IZZI DOM CIU", {"CIU": "Ciudad X"}), ("CIU", "Ciudad X"))


class GastosTest(unittest.TestCase):
    def aviso(self, est: str, id_: str = "m", hora: str = "10:00", fecha: str = "2026-10-03") -> dict:
        return {"id": id_, "fecha": fecha, "hora": hora, "tarjeta": "179", "establecimiento": est, "monto": Decimal("10.50")}

    def test_regla_define_categoria_y_comercio(self) -> None:
        g = a_gasto(self.aviso("TIENDA DEMO CENTRO MCA"), REGLAS)
        self.assertEqual((g["categoria"], g["comercio"], g["ciudad"], g["ciudad_cod"]), ("Compras", "Demo", "McAllen", "MCA"))
        self.assertEqual((g["monto"], g["moneda"]), (10.5, "MXN"))

    def test_sin_regla_queda_sin_categoria_y_sin_ciudad_inventada(self) -> None:
        g = a_gasto(self.aviso("TIENDA RARA CIU"), REGLAS)
        self.assertEqual(g["categoria"], "Sin categoría")
        self.assertEqual(g["comercio"], "Tienda Rara")
        self.assertNotIn("ciudad", g)
        self.assertEqual(g["ciudad_cod"], "CIU")

    def test_agrupa_por_dia_y_ordena_por_hora(self) -> None:
        dias = agrupar_por_dia(
            [self.aviso("GAS X APO", "b", "09:00"), self.aviso("GAS X APO", "a", "06:00"), self.aviso("GAS X APO", "c", "07:00", "2026-10-04")],
            REGLAS,
        )
        self.assertEqual(sorted(dias), ["2026-10-03", "2026-10-04"])
        self.assertEqual([g["id"] for g in dias["2026-10-03"]], ["a", "b"])

    def test_escribir_dias_mezcla_con_lo_existente(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            carpeta = Path(tmp)
            escribir_dias(agrupar_por_dia([self.aviso("GAS X APO", "a", "06:00"), self.aviso("GAS X APO", "b", "07:00")], REGLAS), carpeta)
            # segunda corrida con una ventana que ya no incluye "a" y corrige "b"
            nuevo = self.aviso("GAS X APO", "b", "07:00")
            nuevo["monto"] = Decimal("99.00")
            escribir_dias(agrupar_por_dia([nuevo], REGLAS), carpeta)
            datos = json.loads((carpeta / "2026-10-03.json").read_text(encoding="utf-8"))
            self.assertEqual([g["id"] for g in datos["transacciones"]], ["a", "b"])
            self.assertEqual(datos["transacciones"][1]["monto"], 99.0)
            self.assertEqual(datos["fecha"], "2026-10-03")


def _codificar(html: str) -> str:
    return base64.urlsafe_b64encode(html.encode("utf-8")).decode().rstrip("=")


class _Ejecutable:
    def __init__(self, valor, reintentos: list | None = None) -> None:
        self.valor, self.reintentos = valor, reintentos

    def execute(self, num_retries=0):
        if self.reintentos is not None:
            self.reintentos.append(num_retries)
        if isinstance(self.valor, Exception):
            raise self.valor
        return self.valor


class _Mensajes:
    def __init__(self, paginas: list[list[str]], cuerpos: dict[str, dict]) -> None:
        self.paginas, self.cuerpos, self.consultas = paginas, cuerpos, []
        self.descargados: list[str] = []
        self.reintentos: list[int] = []

    def list(self, userId, q, maxResults, pageToken):  # noqa: N803 (nombres de la API de Google)
        self.consultas.append(q)
        i = 0 if pageToken is None else int(pageToken)
        resp = {"messages": [{"id": m} for m in self.paginas[i]]}
        if i + 1 < len(self.paginas):
            resp["nextPageToken"] = str(i + 1)
        return _Ejecutable(resp, self.reintentos)

    def get(self, userId, id, format):  # noqa: N803, A002
        assert format == "full"
        self.descargados.append(id)
        return _Ejecutable(self.cuerpos[id], self.reintentos)


class _ServicioFalso:
    def __init__(self, mensajes: _Mensajes) -> None:
        self._m = mensajes

    def users(self):
        return self

    def messages(self):
        return self._m


class GmailTest(unittest.TestCase):
    def test_html_en_parte_anidada_y_en_cuerpo_directo(self) -> None:
        html = "<b>hola</b>"
        directo = {"payload": {"mimeType": "text/html", "body": {"data": _codificar(html)}}}
        anidado = {"payload": {"mimeType": "multipart/mixed", "parts": [
            {"mimeType": "text/plain", "body": {"data": _codificar("texto")}},
            {"mimeType": "multipart/alternative", "parts": [{"mimeType": "text/html", "body": {"data": _codificar(html)}}]},
        ]}}
        self.assertEqual(html_del_mensaje(directo), html)
        self.assertEqual(html_del_mensaje(anidado), html)
        self.assertIsNone(html_del_mensaje({"payload": {"mimeType": "text/plain", "body": {}}}))

    def test_leer_avisos_pagina_y_reporta_ilegibles(self) -> None:
        def msg(html: str) -> dict:
            return {"payload": {"mimeType": "text/html", "body": {"data": _codificar(html)}}}

        mensajes = _Mensajes(
            paginas=[["a", "b"], ["c"]],
            cuerpos={
                "a": msg(aviso_html()),
                "b": msg(aviso_html(estatus="Rechazado")),
                "c": msg(aviso_html(monto="$ 2,769.06", fecha="04 Octubre 2026 / 08:00:00")),
            },
        )
        avisos, ilegibles = leer_avisos(_ServicioFalso(mensajes), dias=5)
        self.assertEqual([a["id"] for a in avisos], ["a", "c"])
        self.assertEqual(ilegibles, ["b"])
        self.assertIn("newer_than:5d", mensajes.consultas[0])
        self.assertIn("from:notificaciones@banamex.com", mensajes.consultas[0])


def _msg(html: str) -> dict:
    return {"payload": {"mimeType": "text/html", "body": {"data": _codificar(html)}}}


class _ServicioQueNoDebeUsarse:
    def users(self):
        raise AssertionError("no debió leer Gmail")


class _Error401(Exception):
    """Como googleapiclient.errors.HttpError: trae `resp.status`."""

    def __init__(self) -> None:
        super().__init__("401 Unauthorized")
        self.resp = type("Resp", (), {"status": 401})()


class _Error403Cuota(Exception):
    """Como el HttpError 403 "rateLimitExceeded" que reportó el usuario."""

    def __init__(self) -> None:
        super().__init__("Quota exceeded for quota metric 'Total Query Cost' (rateLimitExceeded)")
        self.resp = type("Resp", (), {"status": 403})()


class _MensajesQueFallan(_Mensajes):
    def list(self, **_):  # noqa: A003
        raise _Error401()


class RevisarGmailTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.carpeta = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def mensajes(self, falla_en: str | None = None) -> _Mensajes:
        cuerpos = {
            "a": _msg(aviso_html()),
            "b": _msg(aviso_html(estatus="Rechazado")),
            "c": _msg(aviso_html(establecimiento="TIENDA RARA CIU", fecha="04 Octubre 2026 / 08:00:00")),
        }
        mensajes = _Mensajes(paginas=[["a", "b", "c"]], cuerpos=cuerpos)
        if falla_en:
            mensajes.cuerpos[falla_en] = _Error403Cuota()
        return mensajes

    def servicio(self) -> _ServicioFalso:
        return _ServicioFalso(self.mensajes())

    def test_cuenta_leidos_nuevos_y_reporta_problemas(self) -> None:
        # "a" ya estaba guardado de una corrida anterior: no se vuelve a
        # descargar ni cuenta como nuevo, pero sí como aviso de la ventana.
        escribir_dias(agrupar_por_dia([parsear_aviso(aviso_html(), "a")], REGLAS), self.carpeta)
        mensajes = self.mensajes()
        pasos: list[tuple] = []
        r = revisar_gmail(
            3, servicio=_ServicioFalso(mensajes), reglas=REGLAS, carpeta=self.carpeta,
            progreso=lambda *p: pasos.append(p),
        )
        self.assertEqual(mensajes.descargados, ["b", "c"])
        self.assertEqual((r.avisos_leidos, r.nuevos), (2, 1))
        self.assertEqual(r.ilegibles, ["b"])
        self.assertEqual(r.sin_categoria, ["TIENDA RARA CIU"])
        self.assertEqual(r.codigos_sin_confirmar, ["CIU"])
        self.assertIsNone(r.subidas)
        self.assertEqual([(d.fecha, d.gastos) for d in r.por_dia], [("2026-10-03", 1), ("2026-10-04", 1)])
        self.assertTrue((self.carpeta / "2026-10-04.json").exists())
        # La barra recibe cada correo descargado (0..2 de 2).
        self.assertEqual([p[1:] for p in pasos if p[2] == 2], [(0, 2), (1, 2), (2, 2)])

    def test_subir_sin_configuracion_falla_antes_de_leer_gmail(self) -> None:
        sin_supabase = {k: v for k, v in os.environ.items() if not k.startswith("SUPABASE_")}
        with mock.patch.dict(os.environ, sin_supabase, clear=True):
            with self.assertRaises(FaltaConfiguracionSupabase) as ctx:
                revisar_gmail(
                    3, subir=True, servicio=_ServicioQueNoDebeUsarse(), reglas=REGLAS,
                    carpeta=self.carpeta,
                )
        self.assertIn("SUPABASE_EMAIL", str(ctx.exception))
        self.assertEqual(list(self.carpeta.iterdir()), [])

    def test_contrasena_incorrecta_falla_antes_de_leer_gmail(self) -> None:
        datos = {v: "x" for v in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_EMAIL", "SUPABASE_PASSWORD")}
        with mock.patch.dict(os.environ, datos), mock.patch(
            "sync.gastos_correo.crear_cliente", side_effect=RuntimeError("Invalid login credentials")
        ):
            with self.assertRaises(FaltaConfiguracionSupabase) as ctx:
                revisar_gmail(
                    3, subir=True, servicio=_ServicioQueNoDebeUsarse(), reglas=REGLAS,
                    carpeta=self.carpeta,
                )
        self.assertIn("No se pudo iniciar sesión", str(ctx.exception))

    def test_subir_con_cliente_falso(self) -> None:
        cliente = ClienteFalso()
        r = revisar_gmail(
            3, subir=True, servicio=self.servicio(), cliente_supabase=cliente,
            reglas=REGLAS, carpeta=self.carpeta,
        )
        self.assertEqual((r.gastos_subidos, r.subidas_fallidas), (2, []))
        self.assertEqual([t for t, _, _ in cliente.llamadas], ["gastos_correo"] * 2)
        self.assertIn("2 gasto(s) subido(s)", resumen_revision(r))

    def test_error_al_subir_queda_en_los_avisos(self) -> None:
        r = revisar_gmail(
            3, subir=True, servicio=self.servicio(), cliente_supabase=ClienteFalso(falla=True),
            reglas=REGLAS, carpeta=self.carpeta,
        )
        self.assertEqual(r.gastos_subidos, 0)
        self.assertEqual(len(r.subidas_fallidas), 2)
        self.assertTrue(any(l.startswith("Error al subir 2026-10-03.json") for l in avisos_para_mostrar(r)))

    def test_permiso_revocado_se_reporta_como_tal(self) -> None:
        with self.assertRaises(PermisoGmailInvalido):
            revisar_gmail(
                3, servicio=_ServicioFalso(_MensajesQueFallan([[]], {})), reglas=REGLAS,
                carpeta=self.carpeta,
            )

    def test_lo_ya_guardado_no_se_vuelve_a_descargar(self) -> None:
        revisar_gmail(3, servicio=self.servicio(), reglas=REGLAS, carpeta=self.carpeta)
        mensajes = self.mensajes()
        r = revisar_gmail(3, servicio=_ServicioFalso(mensajes), reglas=REGLAS, carpeta=self.carpeta)
        # Solo "b" (no es un cargo legible, así que nunca se guarda).
        self.assertEqual(mensajes.descargados, ["b"])
        self.assertEqual((r.avisos_leidos, r.nuevos), (2, 0))
        self.assertTrue(all(n == REINTENTOS_GMAIL for n in mensajes.reintentos))

    def test_regla_nueva_recategoriza_lo_guardado_sin_red(self) -> None:
        revisar_gmail(3, servicio=self.servicio(), reglas=REGLAS, carpeta=self.carpeta)
        reglas = [*REGLAS, Regla("TIENDA RARA", "Compras", "Rara")]
        mensajes = self.mensajes()
        r = revisar_gmail(3, servicio=_ServicioFalso(mensajes), reglas=reglas, carpeta=self.carpeta)
        self.assertNotIn("c", mensajes.descargados)
        self.assertEqual((r.recategorizados, r.sin_categoria), (1, []))
        gasto = json.loads((self.carpeta / "2026-10-04.json").read_text(encoding="utf-8"))["transacciones"][0]
        self.assertEqual((gasto["categoria"], gasto["comercio"]), ("Compras", "Rara"))
        self.assertIn("1 recategorizado(s)", resumen_revision(r))

    def test_cuota_agotada_guarda_lo_leido_y_lo_explica(self) -> None:
        with self.assertRaises(LimiteDeGmail):
            revisar_gmail(
                3, servicio=_ServicioFalso(self.mensajes(falla_en="c")), reglas=REGLAS,
                carpeta=self.carpeta,
            )
        # "a" se leyó antes del error: quedó guardado y no se vuelve a pedir.
        self.assertEqual(ids_guardados(self.carpeta), {"a"})
        mensajes = self.mensajes()
        r = revisar_gmail(3, servicio=_ServicioFalso(mensajes), reglas=REGLAS, carpeta=self.carpeta)
        self.assertEqual(mensajes.descargados, ["b", "c"])
        self.assertEqual(r.nuevos, 1)

    def test_avisos_en_espanol(self) -> None:
        r = revisar_gmail(3, servicio=self.servicio(), reglas=[], carpeta=self.carpeta)
        avisos = "\n".join(avisos_para_mostrar(r))
        self.assertIn("1 correo(s) no se pudieron leer", avisos)
        self.assertIn("No hay reglas", avisos)
        self.assertIn("  TIENDA RARA CIU", avisos)  # completo, para escribir la regla
        self.assertIn("Códigos de ciudad sin confirmar: CIU", avisos)


class GastosRecientesTest(unittest.TestCase):
    def test_mas_recientes_primero_con_limite_y_archivos_malos(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            carpeta = Path(tmp)
            for fecha, horas in (("2026-10-02", ["09:00"]), ("2026-10-03", ["08:00", "21:30"])):
                (carpeta / f"{fecha}.json").write_text(json.dumps({
                    "fecha": fecha,
                    "transacciones": [{"id": f"{fecha}-{h}", "hora": h, "monto": 1} for h in horas],
                }), encoding="utf-8")
            (carpeta / "2026-10-04.json").write_text("{roto", encoding="utf-8")
            (carpeta / "ciudades.json").write_text('{"CIU": "X"}', encoding="utf-8")
            (carpeta / "preferencias.json").write_text('{"revisar_al_abrir": true}', encoding="utf-8")

            gastos, ilegibles = cargar_gastos_recientes(carpeta, limite=2)
            self.assertEqual([(g["fecha"], g["hora"]) for g in gastos], [("2026-10-03", "21:30"), ("2026-10-03", "08:00")])
            self.assertEqual(ilegibles, ["2026-10-04.json"])
            self.assertEqual(ids_guardados(carpeta), {"2026-10-02-09:00", "2026-10-03-08:00", "2026-10-03-21:30"})


class ServicioGmailTest(unittest.TestCase):
    """Rutas temporales: nunca toca data/gmail/credentials.json ni token.json."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        rutas = {
            "GMAIL_CREDENTIALS_FILE": str(Path(self._tmp.name) / "no-existe-credentials.json"),
            "GMAIL_TOKEN_FILE": str(Path(self._tmp.name) / "no-existe-token.json"),
        }
        self._entorno = mock.patch.dict(os.environ, rutas)
        self._entorno.start()

    def tearDown(self) -> None:
        self._entorno.stop()
        self._tmp.cleanup()

    def test_sin_librerias_de_google(self) -> None:
        with mock.patch.dict(sys.modules, {"google_auth_oauthlib.flow": None}):
            with self.assertRaises(FaltanLibreriasGoogle):
                crear_servicio_gmail()

    def test_sin_permiso_y_sin_poder_autorizar(self) -> None:
        if importlib.util.find_spec("google_auth_oauthlib") is None:
            self.skipTest("librerías de Google no instaladas")
        self.assertFalse(hay_permiso_guardado())
        with self.assertRaises(PermisoGmailInvalido):
            crear_servicio_gmail(permitir_autorizar=False)

    def test_falta_credentials_json(self) -> None:
        if importlib.util.find_spec("google_auth_oauthlib") is None:
            self.skipTest("librerías de Google no instaladas")
        with self.assertRaises(FaltanCredencialesGmail) as ctx:
            crear_servicio_gmail()
        self.assertIn("no-existe-credentials.json", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
