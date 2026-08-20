import { Suspense } from "react";
import { Topbar } from "@/components/Topbar";
import { CotizacionesView } from "./CotizacionesView";

/**
 * Cotizaciones · HU-COT-01.
 *
 * El listado resalta las tres situaciones que exigen acción: la versión emitida
 * que todavía no se envió, la vigencia vencida, y las enviadas que llevan 5 días
 * hábiles sin respuesta (DV-07 adoptada).
 */
export default function CotizacionesPage() {
  return (
    <>
      <Topbar
        crumbs={[{ label: "CRM" }, { label: "Cotizaciones", current: true }]}
      />
      <div className="pagebody">
        <div className="page-h">
          <div>
            <h1>Cotizaciones</h1>
            <div className="sub">
              Creá, versioná y enviá cotizaciones con el PDF de marca Viva Travel.
            </div>
          </div>
        </div>

        {/* Los filtros viven en la URL, y `useSearchParams` exige Suspense para
            no bloquear el prerender de la ruta. */}
        <Suspense
          fallback={
            <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-mute)" }}>
              Cargando cotizaciones…
            </div>
          }
        >
          <CotizacionesView />
        </Suspense>
      </div>
    </>
  );
}
