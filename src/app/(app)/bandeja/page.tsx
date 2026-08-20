import { Topbar } from "@/components/Topbar";
import { BandejaView } from "./BandejaView";

/**
 * Bandeja de mensajería unificada · wireframe 06.
 *
 * Centraliza conversaciones uno a uno de WhatsApp, Messenger e Instagram y las
 * vincula al expediente del cliente (Levantamiento Funcional · 7.9).
 * Recepción de mensajes en Sprint 5; envío en Sprint 6.
 */
export default function BandejaPage() {
  return (
    <>
      <Topbar
        crumbs={[{ label: "Comunicación" }, { label: "Bandeja", current: true }]}
      />
      <div className="pagebody">
        <BandejaView />
      </div>
    </>
  );
}
