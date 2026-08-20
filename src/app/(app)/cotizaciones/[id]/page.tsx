import { Topbar } from "@/components/Topbar";
import { CotizacionView } from "./CotizacionView";

/**
 * Detalle de cotización · HU-COT-08, HU-COT-09, HU-COT-11 y HU-COT-12.
 *
 * Reúne lo que el asesor necesita para trabajarla: contenido de la versión
 * vigente, comisiones internas, PDF, historial y las transiciones que la
 * máquina de estados admite.
 */
export default async function CotizacionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <Topbar
        crumbs={[
          { label: "CRM" },
          { label: "Cotizaciones", href: "/cotizaciones" },
          { label: "Detalle", current: true },
        ]}
        showSearch={false}
      />
      <div className="pagebody">
        <CotizacionView quoteId={id} />
      </div>
    </>
  );
}
