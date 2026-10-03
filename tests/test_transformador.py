from __future__ import annotations

import unittest
from dataclasses import replace
from decimal import Decimal

from parsers.base import RenglonCrudo
from transform.transformador import (
    ErrorTransformacion,
    descartar_ya_capturadas_a_mano,
    transformar_monto,
    transformar_renglones,
    validar_contra_total,
)


def _renglon(linea: str, monto: str = "-10.00", pagina: int = 1) -> RenglonCrudo:
    return RenglonCrudo("01/08/2026", linea, monto, pagina, linea)


class TransformadorTest(unittest.TestCase):
    def test_monto_con_signo(self) -> None:
        self.assertEqual(transformar_monto("-1,500.00"), (Decimal("1500.00"), "cargo"))
        self.assertEqual(transformar_monto("199.00"), (Decimal("199.00"), "abono"))
        with self.assertRaises(ErrorTransformacion):
            transformar_monto("abc")

    def test_lineas_identicas_se_desambiguan_de_forma_determinista(self) -> None:
        renglones = [_renglon("TELEVIA 50.00"), _renglon("TELEVIA 50.00"), _renglon("TELEVIA 50.00")]
        ok, fallidas = transformar_renglones(renglones)
        self.assertEqual(fallidas, [])
        self.assertEqual(
            [t.linea_cruda for t in ok],
            ["TELEVIA 50.00", "TELEVIA 50.00 (2)", "TELEVIA 50.00 (3)"],
        )
        # Reprocesar da exactamente los mismos sufijos (upsert idempotente).
        otra_vez, _ = transformar_renglones(renglones)
        self.assertEqual([t.linea_cruda for t in ok], [t.linea_cruda for t in otra_vez])

    def test_misma_linea_en_otra_pagina_no_es_duplicado(self) -> None:
        ok, _ = transformar_renglones([_renglon("X", pagina=1), _renglon("X", pagina=2)])
        self.assertEqual([t.linea_cruda for t in ok], ["X", "X"])

    def test_validar_contra_total(self) -> None:
        ok, _ = transformar_renglones([_renglon("A", "-100.00"), _renglon("B", "30.00")])
        self.assertTrue(validar_contra_total(ok, Decimal("-70.00")).ok)
        self.assertFalse(validar_contra_total(ok, Decimal("-69.99")).ok)

    def test_extraida_ya_capturada_a_mano_se_descarta(self) -> None:
        extraidas, _ = transformar_renglones(
            [_renglon("SU ABONO", "500.00"), _renglon("SU ABONO 2", "500.00"), _renglon("OXXO", "-10.00")]
        )
        manual = replace(extraidas[0], linea_cruda="(manual) 2026-08-01 | PAGO | 500.00 | abono")
        quedan, descartadas = descartar_ya_capturadas_a_mano(extraidas, [manual])
        # Una a una: un solo manual cubre una sola de las dos filas iguales.
        self.assertEqual(descartadas, 1)
        self.assertEqual([t.linea_cruda for t in quedan], ["SU ABONO 2", "OXXO"])


if __name__ == "__main__":
    unittest.main()
