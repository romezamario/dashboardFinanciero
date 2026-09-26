from __future__ import annotations

import unittest

from parsers.banamex import BanamexParser


class BanamexAdvertenciasTest(unittest.TestCase):
    def test_movimientos_descartados_se_reportan(self) -> None:
        parser = BanamexParser("2026")
        renglones = parser._procesar_documento(
            [
                (1, "01 AGO SALDO ANTERIOR 1,000.00"),
                (1, "02 AGO PAGO A"),
                (1, "CONCEPTO A 100.00 900.00"),
                (1, "03 AGO MOVIMIENTO ROTO"),
                (2, "04 AGO PAGO C 50.00 850.00"),
                (2, "05 AGO SIN CIERRE"),
            ]
        )
        self.assertEqual([r.monto_texto for r in renglones], ["-100.00", "-50.00"])
        advertencias = parser.advertencias()
        self.assertEqual(len(advertencias), 2)
        self.assertIn("MOVIMIENTO ROTO", advertencias[0])
        self.assertIn("SIN CIERRE", advertencias[1])

    def test_sin_advertencias_en_documento_limpio(self) -> None:
        parser = BanamexParser("2026")
        parser._procesar_documento(
            [(1, "01 AGO SALDO ANTERIOR 1,000.00"), (1, "02 AGO PAGO 100.00 900.00")]
        )
        self.assertEqual(parser.advertencias(), [])


if __name__ == "__main__":
    unittest.main()
