from __future__ import annotations

import unittest
from unittest import mock

from parsers.glifos import (
    _CLAVE_I_O_L,
    UMBRAL_ESPACIO,
    _agregar_encabezados,
    _agrupar_en_renglones,
    _unir,
)


def _letra(x0: float, caracter: str, avance: float = 4.5):
    return (x0, x0 + avance, caracter, avance)


def _imagen(x0: float, bottom: float) -> dict:
    return {"x0": x0, "top": bottom - 26, "bottom": bottom}


class GlifosTest(unittest.TestCase):
    def test_espacio_por_avance(self) -> None:
        piezas = [
            _letra(0, "S"),
            _letra(4.5, "U"),  # avance normal: sin espacio
            _letra(9.0 + 4.5 + UMBRAL_ESPACIO + 0.3, "A"),  # hueco extra: espacio
        ]
        self.assertEqual(_unir(piezas), "SU A")

    def test_variacion_de_cuantizacion_no_es_espacio(self) -> None:
        self.assertEqual(_unir([_letra(0, "A", 6.0), _letra(6.6, "B")]), "AB")

    def test_i_mayuscula_o_ele_minuscula_segun_la_letra_anterior(self) -> None:
        self.assertEqual(_unir([_letra(0, _CLAVE_I_O_L, 2.1), _letra(2.1, "N")]), "IN")
        self.assertEqual(_unir([_letra(0, "a"), _letra(4.5, _CLAVE_I_O_L, 2.1)]), "al")

    def test_palabra_de_texto_junto_a_imagenes_lleva_espacio(self) -> None:
        texto = (0.0, 30.0, "01-oct-2025", None)
        self.assertEqual(_unir([texto, _letra(29.0, "S"), _letra(33.5, "U")]), "01-oct-2025 SU")

    def test_puntuacion_desplazada_se_une_a_su_renglon(self) -> None:
        letras = [_imagen(x, 669.0) for x in (0, 5, 10, 15, 20)]
        coma = _imagen(12.5, 673.5)  # caja de "," o "$" un poco más abajo
        siguiente = [_imagen(x, 681.0) for x in (0, 5, 10, 15)]
        renglones = _agrupar_en_renglones([*letras, coma, *siguiente])
        self.assertEqual(len(renglones), 2)
        self.assertIn(coma, renglones[0])
        self.assertEqual([i["x0"] for i in renglones[0]], [0, 5, 10, 12.5, 15, 20])

    def test_encabezado_en_imagen_se_inserta_en_su_lugar(self) -> None:
        resultado = [(100.0, "01-oct-2025 01-oct-2025 OXXO + $10.00", 0), (140.0, "02-oct-2025 ...", 1)]
        encabezado = [_imagen(x, 133.0) for x in (0, 5, 10, 15)]  # centro 120
        aviso = [_imagen(x, 213.0) for x in (0, 5, 10, 15)]  # centro 200
        traducciones = {id(encabezado[0]): "Tarjeta titular:", id(aviso[0]): "Aviso importante"}
        with mock.patch(
            "parsers.glifos._piezas_de_imagenes",
            side_effect=lambda g: [(0.0, 1.0, traducciones[id(g[0])], None)],
        ):
            _agregar_encabezados(
                [], [*encabezado, *aviso], [], resultado, lambda t: t.startswith("Tarjeta")
            )
        self.assertEqual(
            [linea for _c, linea, _i in resultado],
            ["01-oct-2025 01-oct-2025 OXXO + $10.00", "Tarjeta titular:", "02-oct-2025 ..."],
        )


if __name__ == "__main__":
    unittest.main()
