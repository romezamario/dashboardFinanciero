from __future__ import annotations

import unittest

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


if __name__ == "__main__":
    unittest.main()
