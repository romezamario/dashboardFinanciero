from __future__ import annotations

import unittest

from parsers.banamex_tdc import BanamexTdcParser


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
