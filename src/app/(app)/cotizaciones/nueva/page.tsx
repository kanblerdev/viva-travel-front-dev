"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { QuoteEditor } from "../QuoteEditor";

/**
 * Nueva cotización · HU-COT-02 y HU-EXP-04.
 *
 * Con `?clientId=` llega desde el expediente y el cliente viene precargado, que
 * es como se cotiza en la práctica: primero se abre la ficha, después se cotiza.
 */
function NuevaCotizacion() {
  const clientId = useSearchParams().get("clientId");

  return (
    <>
      <Topbar
        crumbs={[
          { label: "CRM" },
          { label: "Cotizaciones", href: "/cotizaciones" },
          { label: "Nueva", current: true },
        ]}
        showSearch={false}
      />
      <div className="pagebody">
        <div className="page-h">
          <div>
            <h1>Nueva cotización</h1>
            <div className="sub">
              Se guarda como borrador: no mueve la etapa del expediente hasta que se
              envíe.
            </div>
          </div>
        </div>

        <QuoteEditor defaultClientId={clientId} />
      </div>
    </>
  );
}

export default function NuevaCotizacionPage() {
  // `useSearchParams` exige Suspense para no bloquear el prerender de la ruta.
  return (
    <Suspense fallback={<div className="pagebody">Cargando…</div>}>
      <NuevaCotizacion />
    </Suspense>
  );
}
