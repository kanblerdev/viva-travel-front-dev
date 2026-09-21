import { Topbar } from "@/components/Topbar";
import { ReportesView } from "./ReportesView";

/**
 * Reportes comerciales · wireframe 11 · HU-REP-01 a HU-REP-06.
 *
 * Los cuatro análisis del Sprint 8 sobre el mismo período y el mismo corte por
 * asesor. Qué reportes se ofrecen lo decide el backend según el rol: el Asesor
 * no llega al desempeño por asesor ni por URL ni por API (HU-REP-02).
 */
export default function ReportesPage() {
  return (
    <>
      <Topbar crumbs={[{ label: "CRM" }, { label: "Reportes", current: true }]} />
      <div className="pagebody">
        <ReportesView />
      </div>
    </>
  );
}
