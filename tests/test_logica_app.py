"""Lógica de la app de escritorio sin interfaz (app/logica.py): leer un PDF
con un extractor falso, recuperar lo hecho a mano y mover archivos."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

from app.logica import (
    PREFIJO_RENGLON_MANUAL,
    ErrorDeExtraccion,
    detectar_banco,
    hash_pdf,
    leer_estado_de_cuenta,
    mover_a_procesados_junto_al_pdf,
)
from parsers.base import BaseParser, RenglonCrudo, SugerenciaRenglonManual
from transform.categorizador import Regla

REGLAS = [Regla(patron="OXXO", categoria="Supermercado", comercio="Oxxo")]


class _ParserFalso(BaseParser):
    nombre_banco = "Falso"
    reconoce = True
    renglones = [
        RenglonCrudo("10/06/2026", "OXXO CENTRO", "-85.00", 1, "10/06 OXXO CENTRO -85.00"),
        RenglonCrudo("12/06/2026", "SU PAGO", "2000.00", 1, "12/06 SU PAGO 2000.00"),
    ]

    def puede_procesar(self, ruta_pdf: Path) -> bool:
        return self.reconoce

    def extraer(self, ruta_pdf: Path) -> list[RenglonCrudo]:
        return list(self.renglones)

    def extraer_info_cuenta(self, ruta_pdf: Path):
        return "Cuenta Falsa", "1234"

    def advertencias(self) -> list[str]:
        return ["Página 2: fila ilegible"]

    def sugerencias_renglon_manual(self):
        return [SugerenciaRenglonManual("15/06/2026", 2, "Titular"), SugerenciaRenglonManual("xx", 2, None)]


class _NoReconoce(_ParserFalso):
    reconoce = False


class _Roto(_ParserFalso):
    def extraer(self, ruta_pdf: Path):
        raise ValueError("PDF dañado")


class LeerEstadoDeCuentaTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.carpeta = Path(self._tmp.name)
        self.procesados = self.carpeta / "procesados_json"
        self.procesados.mkdir()
        self.pdf = self.carpeta / "estado.pdf"
        self.pdf.write_bytes(b"%PDF-falso")

    def _leer(self, parsers=None, banco_manual="Otro"):
        parsers = parsers or {"Falso": _ParserFalso, "Otro": _NoReconoce}
        return leer_estado_de_cuenta(
            self.pdf, banco_manual, REGLAS, parsers, self.procesados, hoy=datetime(2026, 7, 1)
        )

    def test_detecta_extrae_categoriza_y_convierte_sugerencias(self) -> None:
        lectura = self._leer()
        self.assertTrue(lectura.banco_detectado)
        self.assertEqual(lectura.banco, "Falso")
        self.assertEqual((lectura.alias_detectado, lectura.ultimos_4_detectados), ("Cuenta Falsa", "1234"))
        self.assertEqual(
            [(t.descripcion, t.tipo, t.categoria, t.origen) for t in lectura.transacciones],
            [("OXXO CENTRO", "cargo", "Supermercado", "estado.pdf"), ("SU PAGO", "abono", None, "estado.pdf")],
        )
        # La sugerencia con fecha ilegible se descarta; la otra pasa a ISO.
        self.assertEqual(lectura.sugerencias_manuales, [("2026-06-15", 2, "Titular")])
        self.assertEqual(lectura.advertencias, ["Página 2: fila ilegible"])

    def test_ambiguo_cae_al_banco_elegido_a_mano(self) -> None:
        lectura = self._leer({"Falso": _ParserFalso, "Otro": _ParserFalso}, banco_manual="Otro")
        self.assertFalse(lectura.banco_detectado)
        self.assertEqual(lectura.banco, "Otro")

    def test_error_del_extractor_trae_el_banco(self) -> None:
        with self.assertRaises(ErrorDeExtraccion) as contexto:
            self._leer({"Roto": _Roto})
        self.assertEqual(contexto.exception.banco, "Roto")
        self.assertIn("PDF dañado", str(contexto.exception))

    def test_recupera_renglones_y_categorias_puestos_a_mano(self) -> None:
        manual = f"{PREFIJO_RENGLON_MANUAL}2026-06-15 | CASETA | 50.00 | cargo"
        (self.procesados / f"{hash_pdf(self.pdf)}.json").write_text(
            json.dumps(
                {
                    "transacciones": [
                        {"fecha": "2026-06-12", "descripcion": "SU PAGO", "monto": "2000.00",
                         "tipo": "abono", "pagina": 1, "linea_cruda": "12/06 SU PAGO 2000.00",
                         "categoria": "Pago TDC", "comercio": None, "categoria_manual": True},
                        {"fecha": "2026-06-15", "descripcion": "CASETA", "monto": "50.00",
                         "tipo": "cargo", "pagina": 2, "linea_cruda": manual,
                         "categoria": "Transporte", "comercio": "Televia"},
                    ]
                }
            ),
            encoding="utf-8",
        )
        lectura = self._leer()
        self.assertEqual(lectura.manuales_recuperados, 1)
        por_descripcion = {t.descripcion: t for t in lectura.transacciones}
        self.assertEqual(por_descripcion["SU PAGO"].categoria, "Pago TDC")  # manual gana a las reglas
        self.assertEqual(
            (por_descripcion["CASETA"].categoria, por_descripcion["CASETA"].comercio),
            ("Transporte", "Televia"),  # ninguna regla: se conserva lo elegido
        )

    def test_olvida_el_texto_inicial_al_terminar(self) -> None:
        with mock.patch("app.logica.olvidar_textos_iniciales") as olvidar:
            self._leer()
            with self.assertRaises(ErrorDeExtraccion):
                self._leer({"Roto": _Roto})
        self.assertEqual(olvidar.call_count, 2)


class DetectarBancoTest(unittest.TestCase):
    def test_un_extractor_roto_no_tumba_la_deteccion(self) -> None:
        class Explota(_ParserFalso):
            def puede_procesar(self, ruta_pdf):
                raise RuntimeError("bug")

        self.assertEqual(detectar_banco(Path("x.pdf"), {"A": Explota, "B": _ParserFalso}), "B")


class MoverAProcesadosTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.carpeta = Path(self._tmp.name)

    def test_mueve_a_la_subcarpeta_procesados(self) -> None:
        pdf = self.carpeta / "a.pdf"
        pdf.write_bytes(b"1")
        destino = mover_a_procesados_junto_al_pdf(pdf)
        self.assertEqual(destino, self.carpeta / "procesados" / "a.pdf")
        self.assertFalse(pdf.exists())

    def test_no_anida_procesados_ni_pisa_otro_archivo(self) -> None:
        (self.carpeta / "procesados").mkdir()
        ya_ahi = self.carpeta / "procesados" / "a.pdf"
        ya_ahi.write_bytes(b"viejo")
        self.assertEqual(mover_a_procesados_junto_al_pdf(ya_ahi), ya_ahi)

        otro = self.carpeta / "a.pdf"
        otro.write_bytes(b"nuevo")
        destino = mover_a_procesados_junto_al_pdf(otro)
        self.assertEqual(destino.name, "a (1).pdf")
        self.assertEqual(ya_ahi.read_bytes(), b"viejo")


if __name__ == "__main__":
    unittest.main()
