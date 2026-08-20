import { Suspense } from "react";
import { Topbar } from "@/components/Topbar";
import { VentasView } from "./VentasView";

/**
 * Ventas · HU-VEN-01 · wireframe 09.
 *
 * El listado gira alrededor del cobro: cuánto se vendió importa menos que
 * cuánto falta cobrar y qué venta tiene la fecha límite vencida.
 */
export default function VentasPage() {
  return (
    <>
      <Topbar
        crumbs={[{ label: "CRM" }, { label: "Ventas", current: true }]}
      />
      <div className="pagebody">
        <div className="page-h">
          <div>
            <h1>Ventas</h1>
            <div className="sub">
              Seguimiento de cobros, factura interna y estado de cada operación.
            </div>
          </div>
        </div>

        {/* Los filtros viven en la URL, y `useSearchParams` exige Suspense para
            no bloquear el prerender de la ruta. */}
        <Suspense
          fallback={
            <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-mute)" }}>
              Cargando ventas…
            </div>
          }
        >
          <VentasView />
        </Suspense>
      </div>
    </>
  );
}
