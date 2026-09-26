"""Sincronizador contra un cliente falso en memoria (sin red ni credenciales)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from sync.sincronizador import NOMBRE_ARCHIVO_ESTADO_SYNC, sincronizar_todos


class _Consulta:
    def __init__(self, cliente: "ClienteFalso", tabla: str) -> None:
        self.cliente, self.tabla, self.filtros = cliente, tabla, {}
        self._accion: tuple | None = None

    def select(self, _columnas: str) -> "_Consulta":
        self._accion = ("select",)
        return self

    def eq(self, campo, valor) -> "_Consulta":
        self.filtros[campo] = valor
        return self

    def insert(self, fila) -> "_Consulta":
        self._accion = ("insert", fila)
        return self

    def upsert(self, filas, on_conflict: str) -> "_Consulta":
        self._accion = ("upsert", filas, on_conflict.split(","))
        return self

    def execute(self):
        filas = self.cliente.tablas.setdefault(self.tabla, [])
        tipo = self._accion[0]
        if tipo == "select":
            data = [f for f in filas if all(f.get(k) == v for k, v in self.filtros.items())]
        elif tipo == "insert":
            nueva = {**self._accion[1], "id": f"{self.tabla}-{len(filas) + 1}"}
            filas.append(nueva)
            data = [nueva]
        else:
            _, nuevas, claves = self._accion
            vistas = set()
            for fila in nuevas:
                clave = tuple(fila[c] for c in claves)
                if clave in vistas:  # lo que haría Postgres (error 21000)
                    raise RuntimeError("ON CONFLICT DO UPDATE command cannot affect row a second time")
                vistas.add(clave)
                existente = next((f for f in filas if tuple(f[c] for c in claves) == clave), None)
                if existente:
                    existente.update(fila)
                else:
                    filas.append(dict(fila))
            data = nuevas
        return type("Resultado", (), {"data": data})()


class ClienteFalso:
    def __init__(self) -> None:
        self.tablas: dict[str, list[dict]] = {}

    def table(self, nombre: str) -> _Consulta:
        return _Consulta(self, nombre)


def _documento(hash_: str, lineas: list[str]) -> dict:
    return {
        "banco": "Banamex",
        "cuenta_alias": "Cheques",
        "cuenta_ultimos_4_digitos": "1234",
        "documento_hash": hash_,
        "transacciones": [
            {
                "fecha": "2026-08-01", "descripcion": linea, "monto": "10.00",
                "tipo": "cargo", "moneda": "MXN", "pagina": 1, "linea_cruda": linea,
                "categoria": "Comida",
            }
            for linea in lineas
        ],
    }


class SincronizarTodosTest(unittest.TestCase):
    def setUp(self) -> None:
        self.carpeta = Path(tempfile.mkdtemp())

    def _escribir(self, nombre: str, contenido: str) -> None:
        (self.carpeta / nombre).write_text(contenido, encoding="utf-8")

    def test_json_corrupto_no_aborta_los_demas(self) -> None:
        self._escribir("a.json", json.dumps(_documento("a", ["L1", "L2"])))
        self._escribir("b.json", "{esto no es json")
        self._escribir("c.json", json.dumps(_documento("c", ["L3"])))

        resultados = sincronizar_todos(ClienteFalso(), self.carpeta)

        por_archivo = {r.archivo: r for r in resultados}
        self.assertTrue(por_archivo["a.json"].ok)
        self.assertFalse(por_archivo["b.json"].ok)
        self.assertTrue(por_archivo["c.json"].ok)
        estado = json.loads((self.carpeta / NOMBRE_ARCHIVO_ESTADO_SYNC).read_text())
        self.assertEqual(set(estado), {"a.json", "c.json"})  # el corrupto se reintenta

    def test_sin_cambios_no_se_vuelve_a_subir(self) -> None:
        self._escribir("a.json", json.dumps(_documento("a", ["L1"])))
        cliente = ClienteFalso()
        self.assertEqual(len(sincronizar_todos(cliente, self.carpeta)), 1)
        self.assertEqual(sincronizar_todos(cliente, self.carpeta), [])

    def test_resincronizar_es_idempotente(self) -> None:
        self._escribir("a.json", json.dumps(_documento("a", ["L1", "L2"])))
        cliente = ClienteFalso()
        sincronizar_todos(cliente, self.carpeta)
        sincronizar_todos(cliente, self.carpeta, forzar_todos=True)
        self.assertEqual(len(cliente.tablas["transacciones"]), 2)
        self.assertEqual(len(cliente.tablas["documentos"]), 1)


if __name__ == "__main__":
    unittest.main()
