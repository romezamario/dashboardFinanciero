"""BBVA débito (Tarjeta Nómina): texto sintético con la misma estructura que
el estado de cuenta real anonimizado (los PDFs reales nunca salen de la laptop)."""

from __future__ import annotations

import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

from parsers.banamex import BanamexParser
from parsers.bbva_debito import BbvaDebitoParser
from parsers.comun import olvidar_textos_iniciales

PORTADA = [
    "Estado de Cuenta",
    "TARJETA NOMINA LIBRETON BBVA",
    "PAGINA 1 / 6",
    "Periodo DEL 15/10/2026 AL 14/11/2026",
    "Fecha de Corte 14/11/2026",
    "No. de Cuenta 0123456789",
    "No. de Cliente A1234567",
    "Saldo Promedio 10,000.00 Saldo Anterior 1,000.00",
    "Detalle de Movimientos Realizados",
    "FECHA SALDO",
    "OPER LIQ DESCRIPCION REFERENCIA CARGOS ABONOS OPERACION LIQUIDACION",
]


def documento(*paginas: list[str]) -> list[tuple[int, str]]:
    return [(n, linea) for n, lineas in enumerate(paginas, start=1) for linea in lineas]


class BbvaDebitoTest(unittest.TestCase):
    def test_signo_por_saldo_y_detalle_multilinea(self) -> None:
        parser = BbvaDebitoParser()
        renglones = parser._procesar_documento(
            documento(
                PORTADA
                + [
                    "16/OCT 16/OCT PAGO CUENTA DE TERCERO 15,000.00 16,000.00 16,000.00",
                    "BNET 0123456789 Nomina octubre Referencia 0000000001",
                    "La GAT Real es el rendimiento que obtendria",
                    "BBVA MEXICO, S.A., INSTITUCION DE BANCA MULTIPLE",
                    "Av. Paseo de la Reforma 510",
                ],
                [
                    "Estado de Cuenta",
                    "TARJETA NOMINA LIBRETON BBVA",
                    "PAGINA 2 / 6",
                    "No. de Cuenta 0123456789",
                    "No. de Cliente A1234567",
                    "20/OCT 20/OCT SPEI ENVIADO BANORTE 500.00 15,500.00 15,500.00",
                    "0012345Renta Referencia 0000000002 072",
                    "00000000000000000000",
                    "Juan Perez",
                    "03/NOV 03/NOV PAGO CUENTA DE TERCERO 2,000.00 13,500.00 13,500.00",
                    "BNET 0123456789 Ahorro Referencia 0000000003",
                    "Total de Movimientos",
                    "TOTAL IMPORTE CARGOS 2,500.00 TOTAL MOVIMIENTOS CARGOS 2",
                    "TOTAL IMPORTE ABONOS 15,000.00 TOTAL MOVIMIENTOS ABONOS 1",
                    "Concepto Saldo Anterior 1,000.00",
                ],
            )
        )
        self.assertEqual(
            [(r.fecha_texto, r.monto_texto, r.pagina) for r in renglones],
            [
                ("16/10/2026", "15000.00", 1),
                ("20/10/2026", "-500.00", 2),
                ("03/11/2026", "-2000.00", 2),
            ],
        )
        self.assertEqual(
            renglones[1].descripcion_texto,
            "SPEI ENVIADO BANORTE 0012345Renta Referencia 0000000002 072 "
            "00000000000000000000 Juan Perez",
        )
        # El pie de página no se pegó al primer movimiento.
        self.assertNotIn("GAT", renglones[0].descripcion_texto)
        self.assertEqual(parser.advertencias(), [])

    def test_movimientos_sin_saldo_se_resuelven_con_el_siguiente(self) -> None:
        parser = BbvaDebitoParser()
        renglones = parser._procesar_documento(
            documento(
                PORTADA
                + [
                    "16/OCT 16/OCT SPEI RECIBIDO SANTANDER 3,000.00",
                    "16/OCT 16/OCT PAGO CUENTA DE TERCERO 700.00",
                    "16/OCT 16/OCT OXXO 120.00 3,180.00 3,180.00",
                ]
            )
        )
        self.assertEqual([r.monto_texto for r in renglones], ["3000.00", "-700.00", "-120.00"])
        self.assertEqual(parser.advertencias(), [])

    def test_periodo_que_cruza_de_anio(self) -> None:
        parser = BbvaDebitoParser()
        lineas = [l.replace("15/10/2026 AL 14/11/2026", "15/12/2026 AL 14/01/2027") for l in PORTADA]
        renglones = parser._procesar_documento(
            documento(
                lineas
                + [
                    "20/DIC 20/DIC OXXO 100.00 900.00 900.00",
                    "05/ENE 05/ENE OXXO 100.00 800.00 800.00",
                ]
            )
        )
        self.assertEqual([r.fecha_texto for r in renglones], ["20/12/2026", "05/01/2027"])

    def test_totales_que_no_cuadran_avisan(self) -> None:
        parser = BbvaDebitoParser()
        parser._procesar_documento(
            documento(
                PORTADA
                + [
                    "20/OCT 20/OCT OXXO 100.00 900.00 900.00",
                    "TOTAL IMPORTE CARGOS 250.00 TOTAL MOVIMIENTOS CARGOS 2",
                ]
            )
        )
        self.assertEqual(len(parser.advertencias()), 1)
        self.assertIn("250.00", parser.advertencias()[0])

    def test_saldo_que_no_cuadra_avisa_y_sugiere_renglon(self) -> None:
        parser = BbvaDebitoParser()
        parser._procesar_documento(
            documento(PORTADA + ["20/OCT 20/OCT OXXO 100.00 500.00 500.00"])
        )
        self.assertEqual(len(parser.advertencias()), 1)
        self.assertEqual(
            [(s.fecha_texto, s.pagina) for s in parser.sugerencias_renglon_manual()],
            [("20/10/2026", 1)],
        )


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


class BbvaDeteccionTest(unittest.TestCase):
    def setUp(self) -> None:
        olvidar_textos_iniciales()
        self.ruta = Path(__file__)

    def tearDown(self) -> None:
        olvidar_textos_iniciales()

    def test_detecta_bbva_y_no_banamex(self) -> None:
        with mock.patch("parsers.comun.pdfplumber.open", _pdf_falso("\n".join(PORTADA))):
            self.assertTrue(BbvaDebitoParser().puede_procesar(self.ruta))
            self.assertFalse(BanamexParser().puede_procesar(self.ruta))
            self.assertEqual(
                BbvaDebitoParser().extraer_info_cuenta(self.ruta), ("BBVA Nómina", "6789")
            )

    def test_banamex_no_se_detecta_como_bbva(self) -> None:
        with mock.patch(
            "parsers.comun.pdfplumber.open",
            _pdf_falso("BANAMEX\nFECHA CONCEPTO RETIROS DEPOSITOS SALDO"),
        ):
            self.assertFalse(BbvaDebitoParser().puede_procesar(self.ruta))


if __name__ == "__main__":
    unittest.main()
