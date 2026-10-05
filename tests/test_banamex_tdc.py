from __future__ import annotations

import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

from parsers.banamex_tdc import BanamexTdcParser, _detectar_tipo_tarjeta


class DetectarTipoTarjetaTest(unittest.TestCase):
    def test_por_nombre_en_el_texto(self) -> None:
        self.assertEqual(_detectar_tipo_tarjeta("Estado de Cuenta Beyond"), "TDC Beyond")
        self.assertEqual(_detectar_tipo_tarjeta("TARJETA PRESTIGE"), "TDC Conquista")

    def test_sin_nombre_cae_a_los_ultimos_4_digitos(self) -> None:
        texto = "Estado de Cuenta Mensual\nNúmero de tarjeta: 0 0 0000000000001236"
        self.assertEqual(_detectar_tipo_tarjeta(texto), "TDC Conquista")

    def test_el_nombre_gana_sobre_los_ultimos_4(self) -> None:
        texto = "Estado de Cuenta Platino\nNúmero de tarjeta: 0 0 0000000000001236"
        self.assertEqual(_detectar_tipo_tarjeta(texto), "TDC Platino")

    def test_tarjeta_no_listada_queda_sin_tipo(self) -> None:
        texto = "Estado de Cuenta Mensual\nNúmero de tarjeta: 0 0 0000000000000001"
        self.assertIsNone(_detectar_tipo_tarjeta(texto))
        self.assertIsNone(_detectar_tipo_tarjeta("sin numero de tarjeta"))


class DescripcionParaCategorizarTest(unittest.TestCase):
    def test_abono_de_cortesia_se_reescribe_con_el_tier_del_documento(self) -> None:
        parser = BanamexTdcParser()
        parser._tipo_tarjeta_documento = "TDC Beyond"
        for tecleado in ("SU ABONO...GRACIAS", "su abono... gracias"):
            self.assertEqual(parser.descripcion_para_categorizar(tecleado), "PAGO TDC BEYOND")

    def test_sin_tier_detectado_no_reescribe(self) -> None:
        parser = BanamexTdcParser()
        self.assertEqual(
            parser.descripcion_para_categorizar("SU ABONO...GRACIAS"), "SU ABONO...GRACIAS"
        )

    def test_otras_descripciones_no_se_tocan(self) -> None:
        parser = BanamexTdcParser()
        parser._tipo_tarjeta_documento = "TDC Platino"
        self.assertEqual(parser.descripcion_para_categorizar("UBER *TRIP"), "UBER *TRIP")


class _Pagina:
    def __init__(self, texto: str) -> None:
        self.texto, self.images = texto, []  # sin imágenes: no entra a parsers/glifos

    def extract_text(self) -> str:
        return self.texto


def _extraer(*paginas: str):
    """Corre `extraer()` sobre páginas de texto sintético (los PDFs reales
    nunca son fixtures: no salen de la laptop)."""

    @contextmanager
    def abrir(_ruta):
        yield type("Pdf", (), {"pages": [_Pagina(t) for t in paginas]})()

    parser = BanamexTdcParser()
    with mock.patch("parsers.banamex_tdc.pdfplumber.open", abrir):
        return parser, parser.extraer(Path("demo.pdf"))


PORTADA_2024 = "\n".join([
    "Estado de Cuenta Platino",
    "BANCO NACIONAL DE MEXICO Del 13 de diciembre al 12 de enero de 2025,",
    "PAGO MINIMO $1,000.00",
])


class Formato2024Test(unittest.TestCase):
    """Formato anterior (hasta 2024-10): "Mes día CONCEPTO monto[ -]", sin año."""

    def test_cargos_abonos_moneda_extranjera_y_anio_del_periodo(self) -> None:
        parser, renglones = _extraer(PORTADA_2024, "\n".join([
            "Detalle de Operaciones",
            "Fecha Concepto/Lugar de Compra Importe / USD Monto Pesos",
            "Dic 20 TIENDA DEMO SA 0000000X0 1,234.50",
            "Ene 3 SU ABONO...GRACIAS 9,183.49 -",
            "Ene 5 ZOOM.US 888-799-9666 SAN JOSE CA",
            "U.S. DOLLAR 20.00 380.10",
            "Ene 6 PAGO INTERBANCARIO 500.00 -",
            "Pagina 2 de 4",
        ]))
        self.assertEqual(
            [(r.fecha_texto, r.descripcion_texto, r.monto_texto) for r in renglones],
            [
                ("20/12/2024", "TIENDA DEMO SA 0000000X0", "-1234.50"),  # periodo cruza el año
                ("03/01/2025", "PAGO TDC PLATINO", "9183.49"),
                ("05/01/2025", "ZOOM.US 888-799-9666 SAN JOSE CA", "-380.10"),
                ("06/01/2025", "PAGO RECIBIDO", "500.00"),  # SPEI recibido, no enviado
            ],
        )
        self.assertEqual(
            renglones[2].linea_cruda,
            "Ene 5 ZOOM.US 888-799-9666 SAN JOSE CA | U.S. DOLLAR 20.00 380.10",
        )
        self.assertEqual({r.tarjeta for r in renglones}, {"Titular"})
        self.assertEqual(parser.advertencias(), [])

    def test_ignora_spei_repetidos_y_meses_sin_intereses(self) -> None:
        _parser, renglones = _extraer(PORTADA_2024, "\n".join([
            "Detalle de Operaciones",
            "Ene 2 OXXO DEMO 0000000X0 45.00",
            "Por su Tarjeta Adicional: NOMBRE DEMO 0000 0000",
            "Ene 4 CAFE DEMO 0000000X0 85.00",
            "Detalle de Pagos Interbancarios recibidos a traves del SPEI",
            "Ene 6 BANCO DEMO PAGO X 000000000000000000 0000000",
            "PROMOCIONES SIN INTERESES - EN PESOS MONEDA NACIONAL",
            "POR SU TARJETA TITULAR # 0000 0000 0000 0000",
            "Abr 10 MACSTORE SAN AGUSTIN 12,000.00 3 de 12 1,000.00",
        ]))
        self.assertEqual(
            [(r.descripcion_texto, r.tarjeta) for r in renglones],
            [("OXXO DEMO 0000000X0", "Titular"), ("CAFE DEMO 0000000X0", "Adicional")],
        )

    def test_renglon_sin_monto_ni_linea_de_moneda_se_advierte(self) -> None:
        parser, renglones = _extraer(PORTADA_2024, "\n".join([
            "Detalle de Operaciones", "Ene 5 COMPRA RARA SIN MONTO", "Ene 6 OXXO 45.00",
        ]))
        self.assertEqual([r.descripcion_texto for r in renglones], ["OXXO"])
        self.assertEqual(len(parser.advertencias()), 1)
        self.assertEqual(parser.sugerencias_renglon_manual()[0].fecha_texto, "05/01/2025")

    def test_formato_actual_no_se_ve_afectado(self) -> None:
        _parser, renglones = _extraer(
            "Estado de Cuenta Platino\nPAGO MINIMO",
            "Detalle de Operaciones\n01-ene-2025 02-ene-2025 TIENDA DEMO + $10.00",
        )
        self.assertEqual([(r.fecha_texto, r.monto_texto) for r in renglones], [("01/01/2025", "-10.00")])


if __name__ == "__main__":
    unittest.main()
