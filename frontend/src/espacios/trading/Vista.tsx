import { AnalisisTecnicoTab } from "../../components/AnalisisTecnicoTab";
import { MarcoEspacio } from "../../components/MarcoEspacio";
import type { PropsEspacio } from "../../lib/espacios";

export default function VistaTrading({ onIrAInicio }: PropsEspacio) {
  return (
    <MarcoEspacio titulo="Trading" onIrAInicio={onIrAInicio}>
      <AnalisisTecnicoTab />
    </MarcoEspacio>
  );
}
