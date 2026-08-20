import { Topbar } from "@/components/Topbar";
import { DashboardView } from "./DashboardView";

/**
 * Dashboard base · HU-DAS-01, HU-DAS-02 y HU-DAS-07.
 *
 * Primera pantalla del CRM: oportunidades abiertas, ventas del período, tasa de
 * cierre y lo que exige atención hoy. Los gráficos de tendencia y el
 * comparativo contra el mes anterior llegan con Reportes, en el Sprint 8.
 */
export default function DashboardPage() {
  return (
    <>
      <Topbar crumbs={[{ label: "CRM" }, { label: "Dashboard", current: true }]} />
      <div className="pagebody">
        <DashboardView />
      </div>
    </>
  );
}
