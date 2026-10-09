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
        self.filtros_in: dict[str, set] = {}
        self._accion: tuple | None = None

    def select(self, _columnas: str) -> "_Consulta":
        self._accion = ("select",)
        return self

    def eq(self, campo, valor) -> "_Consulta":
        self.filtros[campo] = valor
        return self

    def in_(self, campo, valores) -> "_Consulta":
        self.filtros_in[campo] = set(valores)
        return self

    def _coincide(self, fila) -> bool:
        return all(fila.get(k) == v for k, v in self.filtros.items()) and all(
            fila.get(k) in v for k, v in self.filtros_in.items()
        )

    def insert(self, fila) -> "_Consulta":
        self._accion = ("insert", fila)
        return self

    def update(self, valores) -> "_Consulta":
        self._accion = ("update", valores)
        return self

    def upsert(self, filas, on_conflict: str) -> "_Consulta":
        self._accion = ("upsert", filas, on_conflict.split(","))
        return self

    def execute(self):
        self.cliente.llamadas.append((self.tabla, self._accion[0]))
        filas = self.cliente.tablas.setdefault(self.tabla, [])
        tipo = self._accion[0]
        if tipo == "select":
            data = [f for f in filas if self._coincide(f)]
        elif tipo == "insert":
            lote = self._accion[1] if isinstance(self._accion[1], list) else [self._accion[1]]
            data = []
            for fila in lote:
                nueva = {**fila, "id": f"{self.tabla}-{len(filas) + 1}"}
                filas.append(nueva)
                data.append(nueva)
        elif tipo == "update":
            data = [f for f in filas if self._coincide(f)]
            for fila in data:
                fila.update(self._accion[1])
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
        self.llamadas: list[tuple[str, str]] = []  # (tabla, acción) por execute()

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

    def test_cuenta_existente_toma_el_alias_nuevo_sin_duplicarse(self) -> None:
        viejo = _documento("a", ["L1"])
        viejo["cuenta_alias"] = "TDC Mensual"
        nuevo = _documento("b", ["L2"])
        nuevo["cuenta_alias"] = "TDC Platino"  # mismo banco y últimos 4
        self._escribir("a.json", json.dumps(viejo))
        cliente = ClienteFalso()
        sincronizar_todos(cliente, self.carpeta)
        self.assertEqual([c["alias"] for c in cliente.tablas["cuentas"]], ["TDC Mensual"])

        self._escribir("b.json", json.dumps(nuevo))
        sincronizar_todos(cliente, self.carpeta)
        self.assertEqual([c["alias"] for c in cliente.tablas["cuentas"]], ["TDC Platino"])

    def test_ids_se_reusan_entre_documentos_y_categorias_van_en_lote(self) -> None:
        a = _documento("a", ["L1", "L2"])
        a["transacciones"][1]["categoria"] = "Transporte"
        b = _documento("b", ["L3"])
        b["transacciones"][0]["categoria"] = "Salud"  # nueva en el 2o documento
        self._escribir("a.json", json.dumps(a))
        self._escribir("b.json", json.dumps(b))
        cliente = ClienteFalso()

        self.assertTrue(all(r.ok for r in sincronizar_todos(cliente, self.carpeta)))

        por_tabla: dict[str, list[str]] = {}
        for tabla, accion in cliente.llamadas:
            por_tabla.setdefault(tabla, []).append(accion)
        # Banco y cuenta: se resuelven una vez para los dos documentos.
        self.assertEqual(por_tabla["bancos"], ["select", "insert"])
        self.assertEqual(por_tabla["cuentas"], ["select", "insert"])
        # Categorías: un select + un insert en lote por documento con nuevas.
        self.assertEqual(por_tabla["categorias"], ["select", "insert", "select", "insert"])
        self.assertEqual(
            sorted(c["nombre"] for c in cliente.tablas["categorias"]), ["Comida", "Salud", "Transporte"]
        )
        ids = {c["nombre"]: c["id"] for c in cliente.tablas["categorias"]}
        self.assertEqual(
            sorted(t["categoria_id"] for t in cliente.tablas["transacciones"]),
            sorted([ids["Comida"], ids["Transporte"], ids["Salud"]]),
        )

    def test_categorias_existentes_no_se_duplican(self) -> None:
        cliente = ClienteFalso()
        cliente.tablas["categorias"] = [{"id": "cat-x", "nombre": "Comida"}]
        self._escribir("a.json", json.dumps(_documento("a", ["L1"])))
        sincronizar_todos(cliente, self.carpeta)
        self.assertEqual(len(cliente.tablas["categorias"]), 1)
        self.assertEqual(cliente.tablas["transacciones"][0]["categoria_id"], "cat-x")

    def test_resincronizar_es_idempotente(self) -> None:
        self._escribir("a.json", json.dumps(_documento("a", ["L1", "L2"])))
        cliente = ClienteFalso()
        sincronizar_todos(cliente, self.carpeta)
        sincronizar_todos(cliente, self.carpeta, forzar_todos=True)
        self.assertEqual(len(cliente.tablas["transacciones"]), 2)
        self.assertEqual(len(cliente.tablas["documentos"]), 1)


if __name__ == "__main__":
    unittest.main()
