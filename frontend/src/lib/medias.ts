// Las medias móviles de la gráfica de precio (pestaña Trading): mismo color por
// periodo en SMA y EMA -- 20 = magenta (slot 5), 50 = aqua, 200 = amarillo --; la
// SMA va continua y la EMA punteada. Un botón prende/apaga cada tipo completo.

export const PUNTEADO_EMA = "6 3";

export const MEDIAS = [
  { periodo: 20, sma: "sma20", ema: "ema20", color: "var(--series-5)" },
  { periodo: 50, sma: "sma50", ema: "ema50", color: "var(--series-3)" },
  { periodo: 200, sma: "sma200", ema: "ema200", color: "var(--series-4)" },
] as const;
