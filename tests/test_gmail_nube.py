"""Subida de reglas y del permiso de Gmail para la revisión en la nube, contra
un cliente falso (sin red ni credenciales)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from sync.gmail_nube import SIN_TOKEN, SUBIDO, YA_CONECTADO, conectar_gmail_web, subir_reglas
from transform.categorizador import Regla


class _Consulta:
    def __init__(self, registro: list, nombre: str, datos, respuesta=None) -> None:
        self.registro, self.nombre, self.datos, self.respuesta = registro, nombre, datos, respuesta

    def execute(self):
        self.registro.append((self.nombre, self.datos))
        return SimpleNamespace(data=self.respuesta)


class ClienteFalso:
    def __init__(self, respuesta_rpc=None) -> None:
        self.llamadas: list = []
        self.respuesta_rpc = respuesta_rpc
        self.auth = SimpleNamespace(get_session=lambda: SimpleNamespace(user=SimpleNamespace(id="u1")))

    def table(self, nombre: str):
        cliente = self

        class _Tabla:
            def upsert(self, filas, on_conflict):
                return _Consulta(cliente.llamadas, f"{nombre}:{on_conflict}", filas)

        return _Tabla()

    def rpc(self, nombre: str, parametros: dict):
        return _Consulta(self.llamadas, f"rpc:{nombre}", parametros, self.respuesta_rpc)


class SubirReglasTest(unittest.TestCase):
    def test_sube_reglas_y_ciudades_en_mayusculas(self) -> None:
        c = ClienteFalso()
        subir_reglas(c, [Regla("OXXO", "Súper", "Oxxo"), Regla("GAS", "Transporte")], {"ciu": "Ciudad X"})
        nombre, filas = c.llamadas[0]
        self.assertEqual(nombre, "preferencias:user_id,clave")
        self.assertEqual(filas[0]["valor"][0], {"patron": "OXXO", "categoria": "Súper", "comercio": "Oxxo"})
        self.assertEqual(filas[0]["valor"][1]["comercio"], None)
        self.assertEqual(filas[1], {"user_id": "u1", "clave": "ciudades_correo", "valor": {"CIU": "Ciudad X"}})

    def test_sin_reglas_no_sube_nada(self) -> None:
        c = ClienteFalso()
        subir_reglas(c, [], {"CIU": "X"})
        self.assertEqual(c.llamadas, [])


class ConectarGmailTest(unittest.TestCase):
    def test_sube_el_permiso_del_token(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "token.json"
            ruta.write_text(json.dumps({"client_id": "id", "client_secret": "s", "refresh_token": "r", "token": "x"}))
            c = ClienteFalso(respuesta_rpc=True)
            self.assertEqual(conectar_gmail_web(c, ruta), SUBIDO)
            self.assertEqual(
                c.llamadas,
                [("rpc:conectar_gmail", {"p_client_id": "id", "p_client_secret": "s", "p_refresh_token": "r", "p_correo": None})],
            )

    def test_sin_token_o_sin_refresh_no_hace_nada(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "token.json"
            c = ClienteFalso()
            self.assertEqual(conectar_gmail_web(c, ruta), SIN_TOKEN)
            ruta.write_text(json.dumps({"client_id": "id", "client_secret": "s"}))
            self.assertEqual(conectar_gmail_web(c, ruta), SIN_TOKEN)
            self.assertEqual(c.llamadas, [])

    def test_no_pisa_una_conexion_que_funciona(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "token.json"
            ruta.write_text(json.dumps({"client_id": "id", "client_secret": "s", "refresh_token": "viejo"}))
            self.assertEqual(conectar_gmail_web(ClienteFalso(respuesta_rpc=False), ruta), YA_CONECTADO)


if __name__ == "__main__":
    unittest.main()
