"""Invex TDC: sus dos formatos (V1 con signo, V2 con "CR") sobre texto
sintético -- los PDFs reales nunca son fixtures."""

from __future__ import annotations

import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

from parsers.banamex_tdc import BanamexTdcParser
from parsers.comun import olvidar_textos_iniciales
from parsers.invex_tdc import InvexTdcParser


class _Pagina:
    def __init__(self, texto: str) -> None:
        self.texto = texto

    def extract_text(self) -> str:
        return self.texto


def _pdf_falso(*paginas: str):
    @contextmanager
    def abrir(_ruta):
        yield type("Pdf", (), {"pages": [_Pagina(t) for t in paginas]})()

    return abrir


def _extraer(*paginas: str) -> tuple[InvexTdcParser, list]:
    parser = InvexTdcParser()
    with mock.patch("parsers.invex_tdc.pdfplumber.open", _pdf_falso(*paginas)):
        return parser, parser.extraer(Path("demo.pdf"))


class FormatoV1Test(unittest.TestCase):
    def test_signo_mas_es_cargo_y_menos_es_abono(self) -> None:
        _, renglones = _extraer(
            "Tarjeta Titular ************1234 NOMBRE\n"
            "01-May-2026 02-May-2026 AMAZON MX CDMX + $1,234.50\n"
            "05-May-2026 05-May-2026 PAGO RECIBIDO - $500.00 ..",
        )
        self.assertEqual(
            [(r.fecha_texto, r.monto_texto, r.tarjeta) for r in renglones],
            [("01/05/2026", "-1234.50", "Titular"), ("05/05/2026", "500.00", "Titular")],
        )

    def test_fila_sin_monto_legible_se_advierte_con_su_fecha(self) -> None:
        parser, renglones = _extraer("03-Jun-2026 04-Jun-2026")
        self.assertEqual(renglones, [])
        self.assertEqual(len(parser.advertencias()), 1)
        self.assertEqual(parser.sugerencias_renglon_manual()[0].fecha_texto, "03/06/2026")


class FormatoV2Test(unittest.TestCase):
    def test_cr_marca_abono_y_su_ausencia_cargo(self) -> None:
        _, renglones = _extraer(
            "************1096 NOMBRE APELLIDO\n"
            "10/06/2026 OXXO MONTERREY $85.00\n"
            "12/06/2026 SU PAGO GRACIAS $2,000.00 CR\n"
            "************7777 OTRA PERSONA\n"
            "13/06/2026 CINE $150.00",
        )
        self.assertEqual(
            [(r.monto_texto, r.tarjeta) for r in renglones],
            [("-85.00", "Titular"), ("2000.00", "Titular"), ("-150.00", "7777")],
        )


class DeteccionTest(unittest.TestCase):
    """`puede_procesar` lee el texto inicial con `parsers.comun` (una sola
    lectura del PDF por carga, compartida por todos los extractores)."""

    def setUp(self) -> None:
        olvidar_textos_iniciales()
        self.addCleanup(olvidar_textos_iniciales)
        self.ruta = Path(__file__)  # cualquier archivo real: solo se usa su stat()

    def _detectar(self, *paginas: str) -> tuple[bool, bool, int]:
        llamadas = []

        @contextmanager
        def abrir(ruta):
            llamadas.append(ruta)
            yield type("Pdf", (), {"pages": [_Pagina(t) for t in paginas]})()

        with mock.patch("parsers.comun.pdfplumber.open", abrir):
            invex = InvexTdcParser().puede_procesar(self.ruta)
            banamex = BanamexTdcParser().puede_procesar(self.ruta)
            InvexTdcParser().extraer_info_cuenta(self.ruta)
        return invex, banamex, len(llamadas)

    def test_invex_no_se_confunde_con_banamex_tdc(self) -> None:
        self.assertEqual(self._detectar("INVEX\nPago mínimo $500.00"), (True, False, 1))
        olvidar_textos_iniciales()
        self.assertEqual(self._detectar("Estado de Cuenta\nPago minimo $500.00")[:2], (False, True))

    def test_ultimos_4_desde_la_tarjeta_enmascarada(self) -> None:
        with mock.patch(
            "parsers.comun.pdfplumber.open", _pdf_falso("INVEX", "************4321 NOMBRE")
        ):
            self.assertEqual(InvexTdcParser().extraer_info_cuenta(self.ruta), ("Invex TDC", "4321"))


if __name__ == "__main__":
    unittest.main()
