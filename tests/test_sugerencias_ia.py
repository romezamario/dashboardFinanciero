import json
import unittest
from unittest import mock

from transform import sugerencias_ia
from transform.categorizador import Regla
from transform.sugerencias_ia import (
    ErrorSugerenciasIA,
    FaltaClaudeCode,
    FaltaIniciarSesion,
    construir_prompt,
    pedir_sugerencias,
)

REGLAS = [Regla("DOMINOS", "Restaurantes", "Domino's Pizza"), Regla("OXXO", "Tiendas de conveniencia")]


def respuesta(*objetos, envoltura="```json\n{}\n```"):
    return envoltura.format(json.dumps(list(objetos), ensure_ascii=False))


class PromptTest(unittest.TestCase):
    def test_incluye_categorias_reglas_y_descripciones(self):
        prompt = construir_prompt(["DP 11525 APODACA OPP 010927SA5"], REGLAS)
        self.assertIn("Tiendas de conveniencia", prompt)
        self.assertIn("DOMINOS → Restaurantes | Domino's Pizza", prompt)
        self.assertIn("DP 11525 APODACA OPP 010927SA5", prompt)


class PedirSugerenciasTest(unittest.TestCase):
    def test_respuesta_valida_en_bloque_de_codigo(self):
        texto = respuesta({
            "descripcion": "DP 11525 APODACA OPP 010927SA5", "patron": "OPP 010927SA5",
            "categoria": "Restaurantes", "comercio": "Domino's Pizza",
            "confianza": "alta", "nota": "DP = Domino's",
        })
        [s] = pedir_sugerencias(["DP 11525 APODACA OPP 010927SA5"], REGLAS, ejecutar=lambda _p: texto)
        self.assertTrue(s.aceptable)
        self.assertEqual((s.patron, s.categoria, s.comercio), ("OPP 010927SA5", "Restaurantes", "Domino's Pizza"))

    def test_marca_las_que_no_se_pueden_aceptar(self):
        descripciones = ["POINTMP*ARUA MAG 2105031W3", "CAFE LAUREL CPA", "BAR X", "TACOS PEPE"]
        texto = respuesta(
            {"descripcion": descripciones[0], "patron": "ARUA", "categoria": None, "comercio": None},
            {"descripcion": descripciones[1], "patron": "LAUREL CAFE", "categoria": "Restaurantes"},
            {"descripcion": descripciones[2], "patron": "BAR", "categoria": "Restaurantes"},
            # TACOS PEPE no viene en la respuesta
            envoltura="Aquí están:\n{}\nSaludos",
        )
        sugerencias = pedir_sugerencias(descripciones, REGLAS, ejecutar=lambda _p: texto)
        self.assertEqual([s.descripcion for s in sugerencias], descripciones)
        self.assertEqual(
            [s.problema for s in sugerencias],
            [
                "Claude no conoce el comercio",
                "el patrón no aparece en la descripción",
                "patrón de menos de 4 caracteres",
                "Claude no conoce el comercio",
            ],
        )
        self.assertIn("no la incluyó", sugerencias[3].nota)

    def test_patron_repetido_y_otras_coincidencias(self):
        descripciones = ["RAPPI TRA 150604TW1", "RAPPI RESTAURANTES"]
        texto = respuesta(
            {"descripcion": descripciones[0], "patron": "RAPPI", "categoria": "Restaurantes"},
            {"descripcion": descripciones[1], "patron": "RAPPI", "categoria": "Restaurantes"},
        )
        primera, segunda = pedir_sugerencias(descripciones, REGLAS, ejecutar=lambda _p: texto)
        self.assertTrue(primera.aceptable)
        self.assertEqual(primera.tambien_aplica_a, ("RAPPI RESTAURANTES",))
        self.assertEqual(segunda.problema, "ya existe una regla con ese patrón")

    def test_respuesta_sin_lista(self):
        with self.assertRaises(ErrorSugerenciasIA):
            pedir_sugerencias(["X"], REGLAS, ejecutar=lambda _p: "No sé.")

    def test_sin_descripciones_no_llama(self):
        ejecutar = mock.Mock()
        self.assertEqual(pedir_sugerencias([], REGLAS, ejecutar=ejecutar), [])
        ejecutar.assert_not_called()


class EjecutarClaudeTest(unittest.TestCase):
    def test_sin_claude_instalado(self):
        with mock.patch.object(sugerencias_ia, "buscar_claude", return_value=None):
            with self.assertRaises(FaltaClaudeCode):
                sugerencias_ia._ejecutar_claude("hola")

    def _correr(self, stdout, stderr=""):
        proceso = mock.Mock(stdout=stdout, stderr=stderr)
        with mock.patch.object(sugerencias_ia, "buscar_claude", return_value="claude"), \
                mock.patch.object(sugerencias_ia.subprocess, "run", return_value=proceso) as run:
            return sugerencias_ia._ejecutar_claude("hola"), run

    def test_devuelve_result_y_manda_el_prompt_por_stdin(self):
        texto, run = self._correr(json.dumps({"is_error": False, "result": "[]"}))
        self.assertEqual(texto, "[]")
        self.assertEqual(run.call_args.kwargs["input"], "hola")
        self.assertIn("-p", run.call_args.args[0])

    def test_sin_sesion(self):
        with self.assertRaises(FaltaIniciarSesion):
            self._correr(json.dumps({"is_error": True, "result": "Invalid API key · Please run /login"}))
        with self.assertRaises(FaltaIniciarSesion):
            self._correr("", stderr="Not logged in")

    def test_otro_error_de_claude(self):
        with self.assertRaises(ErrorSugerenciasIA) as contexto:
            self._correr(json.dumps({"is_error": True, "result": "Usage limit reached"}))
        self.assertNotIsInstance(contexto.exception, FaltaIniciarSesion)

    def test_instalar_usa_npm_si_existe(self):
        with mock.patch.object(sugerencias_ia.shutil, "which", return_value="npm.cmd"),                 mock.patch.object(sugerencias_ia.subprocess, "run") as run,                 mock.patch.object(sugerencias_ia, "buscar_claude", return_value="claude.cmd"):
            self.assertEqual(sugerencias_ia.instalar_claude(), "claude.cmd")
        self.assertEqual(run.call_args.args[0], ["npm.cmd", "install", "-g", "@anthropic-ai/claude-code"])

    def test_instalar_sin_npm_usa_el_instalador_oficial_y_reporta_fallo(self):
        proceso = mock.Mock(stdout="", stderr="sin internet")
        with mock.patch.object(sugerencias_ia.shutil, "which", return_value=None),                 mock.patch.object(sugerencias_ia.subprocess, "run", return_value=proceso) as run,                 mock.patch.object(sugerencias_ia, "buscar_claude", return_value=None):
            with self.assertRaisesRegex(ErrorSugerenciasIA, "sin internet"):
                sugerencias_ia.instalar_claude()
        self.assertIn("https://claude.ai/install.ps1", run.call_args.args[0][-1])


if __name__ == "__main__":
    unittest.main()
