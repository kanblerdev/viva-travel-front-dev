import { Suspense } from "react";
import { Topbar } from "@/components/Topbar";
import { BandejaView } from "./BandejaView";

/**
 * Bandeja de mensajería unificada · wireframe 06.
 *
 * Centraliza las conversaciones uno a uno de WhatsApp, Messenger e Instagram y
 * las vincula al expediente del cliente (Levantamiento Funcional · 7.9).
 * Recepción, asignación y resolución en el Sprint 6; envío en el Sprint 7.
 */
export default function BandejaPage() {
  return (
    <>
      <Topbar
        crumbs={[{ label: "Comunicación" }, { label: "Bandeja", current: true }]}
      />
      <div className="pagebody">
        {/* La vista y la conversación abierta viven en la URL, y `useSearchParams`
            exige Suspense para no bloquear el prerender de la ruta. */}
        <Suspense
          fallback={
            <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-mute)" }}>
              Cargando bandeja…
            </div>
          }
        >
          <BandejaView />
        </Suspense>
      </div>
    </>
  );
}
