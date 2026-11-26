// La tarjeta Viajes abre directo la Bitácora de viajes, que se usa dentro de
// este sitio en /viajes/ (la publica el deploy desde el repo GestionViajes; ver
// .github/scripts/incluir-viajes.sh). `replace` para que «Atrás» desde la bitácora vuelva al
// inicio del dashboard y no rebote aquí.
import { useEffect } from "react";

export default function VistaViajes() {
  useEffect(() => {
    window.location.replace("/viajes/");
  }, []);
  return <p className="p-6 text-sm text-[var(--text-secondary)]">Abriendo la bitácora de viajes…</p>;
}
