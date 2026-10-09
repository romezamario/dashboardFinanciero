"""Subida de gastos de correo contra un cliente falso (sin red ni credenciales)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from sync.gastos_correo import subir_todos

USUARIO = "00000000-0000-0000-0000-000000000001"


class _Upsert:
    def __init__(self, cliente: "ClienteFalso", tabla: str, filas: list, on_conflict: str) -> None:
        self.cliente, self.tabla, self.filas, self.on_conflict = cliente, tabla, filas, on_conflict

    def execute(self):
        if self.cliente.falla:
            raise RuntimeError("new row violates row-level security policy")
        self.cliente.llamadas.append((self.tabla, self.filas, self.on_conflict))
        return None


class _Tabla:
    def __init__(self, cliente: "ClienteFalso", nombre: str) -> None:
        self.cliente, self.nombre = cliente, nombre

    def upsert(self, filas: list, on_conflict: str) -> _Upsert:
        return _Upsert(self.cliente, self.nombre, filas, on_conflict)


class _Auth:
    def __init__(self, con_sesion: bool) -> None:
        self.con_sesion = con_sesion

    def get_session(self):
        if not self.con_sesion:
            return None
        usuario = type("Usuario", (), {"id": USUARIO})()
        return type("Sesion", (), {"user": usuario})()


class ClienteFalso:
    """Imita `client.table(...).upsert(..., on_conflict=...).execute()` y
    `client.auth.get_session()` de supabase-py."""

    def __init__(self, falla: bool = False, con_sesion: bool = True) -> None:
        self.llamadas: list[tuple[str, list, str]] = []
        self.falla = falla
        self.auth = _Auth(con_sesion)

    def table(self, nombre: str) -> _Tabla:
        return _Tabla(self, nombre)


def _gasto(id_: str, monto, **extra) -> dict:
    base = {
        "id": id_, "hora": "10:14", "tarjeta": "179", "comercio": "Macy's",
        "categoria": "Compras", "monto": monto, "moneda": "MXN",
        "establecimiento": "MACYS LA PLAZA MALL MCA", "ciudad_cod": "MCA", "ciudad": "McAllen",
    }
    base.update(extra)
    return base


def _escribir(carpeta: Path, nombre: str, fecha: str, gastos: list[dict]) -> None:
    (carpeta / nombre).write_text(
        json.dumps({"fecha": fecha, "transacciones": gastos}), encoding="utf-8"
    )


class SubirGastosCorreoTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.carpeta = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_upsert_con_la_sesion_fecha_y_monto_con_dos_decimales(self) -> None:
        _escribir(self.carpeta, "2026-10-03.json", "2026-10-03", [_gasto("a", 14.81), _gasto("b", 600)])
        cliente = ClienteFalso()
        resultados = subir_todos(cliente, self.carpeta)

        self.assertTrue(resultados[0].ok)
        self.assertEqual(resultados[0].gastos_enviados, 2)
        tabla, filas, on_conflict = cliente.llamadas[0]
        self.assertEqual((tabla, on_conflict), ("gastos_correo", "user_id,mensaje_id"))
        self.assertTrue(all(f["user_id"] == USUARIO for f in filas))
        self.assertEqual([f["mensaje_id"] for f in filas], ["a", "b"])
        self.assertEqual([f["monto"] for f in filas], ["14.81", "600.00"])
        self.assertTrue(all(f["fecha"] == "2026-10-03" for f in filas))

    def test_ciudad_sin_confirmar_viaja_como_none(self) -> None:
        _escribir(
            self.carpeta, "2026-10-02.json", "2026-10-03",
            [{k: v for k, v in _gasto("a", 50, ciudad_cod="CIU").items() if k != "ciudad"}],
        )
        cliente = ClienteFalso()
        subir_todos(cliente, self.carpeta)
        fila = cliente.llamadas[0][1][0]
        self.assertEqual(fila["ciudad_cod"], "CIU")
        self.assertIsNone(fila["ciudad"])

    def test_dia_sin_movimientos_no_llama_a_supabase(self) -> None:
        _escribir(self.carpeta, "2026-10-04.json", "2026-10-04", [])
        cliente = ClienteFalso()
        resultados = subir_todos(cliente, self.carpeta)
        self.assertTrue(resultados[0].ok)
        self.assertEqual(resultados[0].gastos_enviados, 0)
        self.assertEqual(cliente.llamadas, [])

    def test_monto_invalido_o_negativo_se_rechaza_sin_enviar(self) -> None:
        _escribir(self.carpeta, "2026-09-01.json", "2026-10-03", [_gasto("a", "abc")])
        _escribir(self.carpeta, "2026-09-02.json", "2026-10-03", [_gasto("b", -5)])
        _escribir(self.carpeta, "2026-09-03.json", "2026-10-03", [_gasto("c", 10)])
        cliente = ClienteFalso()
        resultados = subir_todos(cliente, self.carpeta)

        self.assertEqual([r.ok for r in resultados], [False, False, True])
        self.assertEqual(len(cliente.llamadas), 1)  # solo el válido

    def test_falta_de_campo_obligatorio_se_rechaza(self) -> None:
        malo = _gasto("a", 10)
        del malo["categoria"]
        _escribir(self.carpeta, "2026-09-04.json", "2026-10-03", [malo])
        resultados = subir_todos(ClienteFalso(), self.carpeta)
        self.assertFalse(resultados[0].ok)
        self.assertIn("categoria", resultados[0].error or "")

    def test_error_de_supabase_se_reporta_por_archivo(self) -> None:
        _escribir(self.carpeta, "2026-09-04.json", "2026-10-03", [_gasto("a", 10)])
        resultados = subir_todos(ClienteFalso(falla=True), self.carpeta)
        self.assertFalse(resultados[0].ok)
        self.assertIn("row-level security", resultados[0].error or "")

    def test_ignora_archivos_que_no_son_dias(self) -> None:
        _escribir(self.carpeta, "2026-10-03.json", "2026-10-03", [_gasto("a", 10)])
        (self.carpeta / "ciudades.json").write_text('{"CIU": "Ciudad X"}', encoding="utf-8")
        cliente = ClienteFalso()
        resultados = subir_todos(cliente, self.carpeta)
        self.assertEqual([r.archivo for r in resultados], ["2026-10-03.json"])

    def test_sin_sesion_se_rechaza_antes_de_llamar(self) -> None:
        _escribir(self.carpeta, "2026-10-03.json", "2026-10-03", [_gasto("a", 10)])
        cliente = ClienteFalso(con_sesion=False)
        with self.assertRaises(ValueError):
            subir_todos(cliente, self.carpeta)
        self.assertEqual(cliente.llamadas, [])

    def test_mas_de_500_gastos_se_parten_en_llamadas(self) -> None:
        gastos = [_gasto(f"g{i}", 1) for i in range(501)]
        _escribir(self.carpeta, "2026-09-05.json", "2026-10-03", gastos)
        cliente = ClienteFalso()
        subir_todos(cliente, self.carpeta)
        self.assertEqual([len(filas) for _, filas, _ in cliente.llamadas], [500, 1])

    def test_solo_sube_lo_que_cambio_desde_la_ultima_subida(self) -> None:
        _escribir(self.carpeta, "2026-09-05.json", "2026-09-05", [_gasto("g1", 100)])
        _escribir(self.carpeta, "2026-09-06.json", "2026-09-06", [_gasto("g2", 200)])
        cliente = ClienteFalso()
        self.assertEqual(len(subir_todos(cliente, self.carpeta)), 2)

        # Sin cambios: no se llama a Supabase ni se reportan archivos.
        cliente = ClienteFalso()
        self.assertEqual(subir_todos(cliente, self.carpeta), [])
        self.assertEqual(cliente.llamadas, [])

        # Cambia un día (p. ej. una regla recategorizó): solo ese vuelve a subir.
        _escribir(self.carpeta, "2026-09-06.json", "2026-09-06", [_gasto("g2", 200, categoria="Ocio")])
        resultados = subir_todos(cliente, self.carpeta)
        self.assertEqual([r.archivo for r in resultados], ["2026-09-06.json"])
        self.assertEqual(len(cliente.llamadas), 1)

    def test_un_archivo_que_falla_se_reintenta_la_proxima_vez(self) -> None:
        _escribir(self.carpeta, "2026-09-05.json", "2026-09-05", [_gasto("g1", 100)])
        self.assertFalse(subir_todos(ClienteFalso(falla=True), self.carpeta)[0].ok)
        cliente = ClienteFalso()
        resultados = subir_todos(cliente, self.carpeta)
        self.assertEqual([r.ok for r in resultados], [True])
        self.assertEqual(len(cliente.llamadas), 1)

    def test_varios_dias_viajan_en_una_sola_llamada(self) -> None:
        for dia in range(1, 31):
            fecha = f"2026-09-{dia:02d}"
            _escribir(self.carpeta, f"{fecha}.json", fecha, [_gasto(f"g{dia}", dia), _gasto(f"h{dia}", 1)])
        cliente = ClienteFalso()
        resultados = subir_todos(cliente, self.carpeta)
        self.assertEqual(len(cliente.llamadas), 1)
        self.assertEqual(len(cliente.llamadas[0][1]), 60)
        self.assertEqual([r.gastos_enviados for r in resultados], [2] * 30)

    def test_las_tandas_no_parten_un_dia_ni_pasan_de_500(self) -> None:
        _escribir(self.carpeta, "2026-09-01.json", "2026-09-01", [_gasto(f"a{i}", 1) for i in range(300)])
        _escribir(self.carpeta, "2026-09-02.json", "2026-09-02", [_gasto(f"b{i}", 1) for i in range(300)])
        cliente = ClienteFalso()
        subir_todos(cliente, self.carpeta)
        self.assertEqual([len(filas) for _, filas, _ in cliente.llamadas], [300, 300])

    def test_una_tanda_que_falla_marca_todos_sus_dias_y_se_reintentan(self) -> None:
        _escribir(self.carpeta, "2026-09-01.json", "2026-09-01", [_gasto("g1", 1)])
        _escribir(self.carpeta, "2026-09-02.json", "2026-09-02", [_gasto("g2", 1)])
        resultados = subir_todos(ClienteFalso(falla=True), self.carpeta)
        self.assertEqual([r.ok for r in resultados], [False, False])
        self.assertTrue(all("row-level security" in r.error for r in resultados))
        self.assertEqual(len(subir_todos(ClienteFalso(), self.carpeta)), 2)

    def test_un_mensaje_repetido_entre_dias_viaja_una_vez(self) -> None:
        _escribir(self.carpeta, "2026-09-01.json", "2026-09-01", [_gasto("g1", 100)])
        _escribir(self.carpeta, "2026-09-02.json", "2026-09-02", [_gasto("g1", 200)])
        cliente = ClienteFalso()
        subir_todos(cliente, self.carpeta)
        filas = cliente.llamadas[0][1]
        self.assertEqual([(f["mensaje_id"], f["monto"]) for f in filas], [("g1", "200.00")])

    def test_forzar_sube_todo_otra_vez(self) -> None:
        _escribir(self.carpeta, "2026-09-05.json", "2026-09-05", [_gasto("g1", 100)])
        subir_todos(ClienteFalso(), self.carpeta)
        cliente = ClienteFalso()
        self.assertEqual(len(subir_todos(cliente, self.carpeta, forzar=True)), 1)
        self.assertEqual(len(cliente.llamadas), 1)


if __name__ == "__main__":
    unittest.main()
