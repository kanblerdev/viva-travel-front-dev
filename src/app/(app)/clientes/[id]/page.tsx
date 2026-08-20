import { Topbar } from "@/components/Topbar";
import { ExpedienteView } from "./ExpedienteView";

/**
 * Expediente 360° · wireframe 04.
 *
 * Es el eje que vincula cotizaciones, ventas, conversaciones y archivos
 * (Modelo de Datos · 3). Cada pestaña muestra únicamente registros de este
 * cliente (HU-EXP-01).
 */
export default async function ExpedientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <Topbar
        crumbs={[
          { label: "Clientes", href: "/clientes" },
          { label: "Expediente", current: true },
        ]}
      />
      <div className="pagebody">
        <ExpedienteView clientId={id} />
      </div>
    </>
  );
}
