from __future__ import annotations

import unittest
from dataclasses import dataclass

from transform.categorizador import Regla, categorizar, inferir_categoria_comercio


@dataclass
class Cargada:
    descripcion: str
    categoria: str | None
    comercio: str | None = None
    linea_cruda: str = ""


class CategorizarTest(unittest.TestCase):
    def test_primera_regla_que_matchea_gana(self) -> None:
        reglas = [Regla("SU PAGO INTERBANCARIO", "Recibida"), Regla("PAGO INTERBANCARIO", "Enviada")]
        self.assertEqual(categorizar("SU PAGO INTERBANCARIO X", reglas), ("Recibida", None))


class InferirCategoriaComercioTest(unittest.TestCase):
    def test_reglas_ganan_sobre_lo_cargado(self) -> None:
        reglas = [Regla("TELEVIA", "Transporte", "Televia")]
        cargadas = [Cargada("TELEVIA 123", "Otra", "Otro")]
        self.assertEqual(
            inferir_categoria_comercio("televia", reglas, cargadas), ("Transporte", "Televia")
        )

    def test_misma_descripcion_cargada(self) -> None:
        cargadas = [Cargada("PAGO TDC BEYOND", "Pago TDC", "Pago TDC Beyond")]
        self.assertEqual(
            inferir_categoria_comercio("pago tdc beyond", [], cargadas),
            ("Pago TDC", "Pago TDC Beyond"),
        )

    def test_coincidencia_parcial_elige_el_par_mas_frecuente(self) -> None:
        cargadas = [
            Cargada("UBER *TRIP 1", "Transporte", "Uber"),
            Cargada("UBER *TRIP 2", "Transporte", "Uber"),
            Cargada("UBER EATS", "Comida", "Uber Eats"),
        ]
        self.assertEqual(inferir_categoria_comercio("UBER", [], cargadas), ("Transporte", "Uber"))

    def test_ignora_las_cargadas_sin_categoria(self) -> None:
        cargadas = [Cargada("OXXO 1", None), Cargada("OXXO 2", "Comida", "Oxxo")]
        self.assertEqual(inferir_categoria_comercio("OXXO", [], cargadas), ("Comida", "Oxxo"))

    def test_busca_tambien_en_la_linea_cruda_ignorando_espacios(self) -> None:
        # El parser reescribió la descripción a "PAGO TDC BEYOND"; el texto
        # original del PDF solo sobrevive en linea_cruda.
        cargadas = [
            Cargada(
                "PAGO TDC BEYOND",
                "Pago TDC",
                "Pago TDC Beyond",
                linea_cruda="10-abr-2025 10-abr-2025 SU ABONO...GRACIAS - $2,006.50",
            )
        ]
        self.assertEqual(
            inferir_categoria_comercio("SU ABONO... GRACIAS", [], cargadas),
            ("Pago TDC", "Pago TDC Beyond"),
        )

    def test_texto_muy_corto_no_busca_coincidencia_parcial(self) -> None:
        cargadas = [Cargada("UBER", "Transporte", "Uber")]
        self.assertEqual(inferir_categoria_comercio("UB", [], cargadas), (None, None))

    def test_sin_nada_que_inferir(self) -> None:
        self.assertEqual(inferir_categoria_comercio("", [], []), (None, None))
        self.assertEqual(inferir_categoria_comercio("DESCONOCIDO", [], []), (None, None))


if __name__ == "__main__":
    unittest.main()
