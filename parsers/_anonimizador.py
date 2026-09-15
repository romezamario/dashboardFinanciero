"""Anonimiza texto de un estado de cuenta preservando su ESTRUCTURA, para
poder compartir el patrón de un banco (con Claude, o con quien sea) sin
exponer datos personales reales.

Reemplaza:
  - cada dígito por '0'
  - cada letra por 'X' (mayúscula) o 'x' (minúscula)
excepto las palabras en VOCABULARIO_BANCARIO (términos genéricos de
estados de cuenta — no son información personal de nadie).

Puntuación, espacios y separadores de columna quedan intactos, así que se
conserva: formato de fecha, si hay separador de miles, cuántos dígitos
tiene un número de página/cuenta, estructura de la tabla, mayúsculas vs.
minúsculas, longitud de las palabras.

Aun así, revisa el resultado antes de compartirlo — esto es un mejor
esfuerzo, no una garantía criptográfica.
"""

from __future__ import annotations

import re

VOCABULARIO_BANCARIO = {
    "FECHA", "CONCEPTO", "DESCRIPCION", "RETIROS", "RETIRO", "DEPOSITOS",
    "DEPOSITO", "SALDO", "ANTERIOR", "ACTUAL", "CARGO", "CARGOS", "ABONO",
    "ABONOS", "PAGO", "PAGOS", "RECIBIDO", "ENVIADO", "TRANSFERENCIA",
    "SPEI", "INTERBANCARIO", "REF", "REFERENCIA", "RASTREO", "CLAVE",
    "CUENTA", "CTA", "ORDENANTE", "BENEFICIARIO", "INSTITUCION",
    "VERIFICADO", "DATO", "COMISION", "EXENCION", "COBRO", "MANEJO",
    "PERIODO", "IMPORTE", "INVERSION", "MISMO", "DIA", "CREDITO", "NOMINA",
    "TC", "SU", "A", "DE", "DEL", "POR", "ORDEN", "AL", "EN", "CON", "SIN",
    "NO", "SI", "ESTADO", "MONEDA", "NACIONAL", "PESOS", "DETALLE",
    "OPERACIONES", "IVA", "ISR", "RETENCION", "COMPRA", "VENTA",
    "SERVICIO", "SUCURSAL", "CAJERO", "TARJETA", "DEBITO", "ATM",
    "PRIORITY", "TOTAL", "SUBTOTAL", "RESUMEN", "MOVIMIENTOS",
    "ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT",
    "NOV", "DIC",
    "BBVA", "BANAMEX", "SANTANDER", "BANORTE", "SCOTIABANK", "HSBC",
    "INBURSA", "AZTECA", "MEXICO",
}

_PATRON_PALABRA = re.compile(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]+")
_PATRON_DIGITO = re.compile(r"\d")


def _anonimizar_palabra(match: re.Match[str]) -> str:
    palabra = match.group(0)
    if palabra.upper() in VOCABULARIO_BANCARIO:
        return palabra
    return "".join("x" if c.islower() else "X" for c in palabra)


def anonimizar(texto: str) -> str:
    texto = _PATRON_DIGITO.sub("0", texto)
    texto = _PATRON_PALABRA.sub(_anonimizar_palabra, texto)
    return texto
