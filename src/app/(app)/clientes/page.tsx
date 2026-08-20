import { Suspense } from "react";
import { Topbar } from "@/components/Topbar";
import { ClientesView } from "./ClientesView";

/**
 * Clientes y prospectos · wireframes 03 (Kanban) y 07 (Lista).
 *
 * Cliente y Prospecto son la misma entidad; la situación comercial se expresa
 * con `pipelineStageId` y `status` (Modelo de Datos · 6.2). Por eso el Kanban y
 * el listado son dos vistas del mismo conjunto de registros y no dos módulos.
 */
export default function ClientesPage() {
  return (
    <>
      <Topbar
        crumbs={[{ label: "CRM" }, { label: "Clientes y prospectos", current: true }]}
      />
      <div className="pagebody">
        {/* `useSearchParams` necesita este límite: sin él, Next no puede
            prerenderizar la ruta. */}
        <Suspense fallback={null}>
          <ClientesView />
        </Suspense>
      </div>
    </>
  );
}
