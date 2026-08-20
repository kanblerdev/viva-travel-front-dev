import { Suspense } from "react";
import { Topbar } from "@/components/Topbar";
import { VentaView } from "./VentaView";

/**
 * Detalle de venta · HU-VEN-04 a HU-VEN-08 · wireframe 09 y Documentos · 3.
 *
 * Reúne el seguimiento de cobro, el historial de abonos, los documentos de la
 * operación y las transiciones que la máquina de estados admite.
 */
export default async function VentaPage({
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
          { label: "Ventas", href: "/ventas" },
          { label: "Detalle", current: true },
        ]}
        showSearch={false}
      />
      <div className="pagebody">
        {/* `useSearchParams` lee el aviso de la aceptación, y exige Suspense. */}
        <Suspense
          fallback={
            <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-mute)" }}>
              Cargando venta…
            </div>
          }
        >
          <VentaView saleId={id} />
        </Suspense>
      </div>
    </>
  );
}
