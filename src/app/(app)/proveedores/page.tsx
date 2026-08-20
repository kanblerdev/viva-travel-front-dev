import { Topbar } from "@/components/Topbar";
import { ProveedoresView } from "./ProveedoresView";

/**
 * Proveedores · HU-PRO-01 a HU-PRO-05 · wireframe 10.
 *
 * Agencias mayoristas que entregan el paquete armado y proveedores de servicios
 * sueltos con los que se construye un paquete propio. Un proveedor con
 * cotizaciones nunca se elimina: se desactiva (DM-06 adoptada).
 */
export default function ProveedoresPage() {
  return (
    <>
      <Topbar
        crumbs={[{ label: "CRM" }, { label: "Proveedores", current: true }]}
      />
      <div className="pagebody">
        <div className="page-h">
          <div>
            <h1>Proveedores</h1>
            <div className="sub">
              Catálogo compartido: alimenta las cotizaciones de todo el equipo.
            </div>
          </div>
        </div>

        <ProveedoresView />
      </div>
    </>
  );
}
