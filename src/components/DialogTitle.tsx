"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";

/*
 * Piezas que comparten los diálogos de Ventas y del expediente · `D3`.
 *
 * Vivían dentro de `app/(app)/ventas/modals.tsx`, así que el expediente tenía
 * que cruzar carpetas de ruta para alcanzarlas.
 */

/**
 * Hoy, en la zona del usuario · hallazgo `E2`.
 *
 * `toISOString()` da la fecha en UTC: después de las 18:00 en El Salvador ya
 * devuelve el día siguiente, y el abono nacía con un comprobante fechado
 * mañana. El backend ahora lo rechaza, así que el valor por defecto tenía que
 * dejar de producirlo.
 */
function localDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export const todayLocal = localDate(new Date());

/** Título con icono, para el `Modal` compartido que solo recibe un nodo. */
export function DialogTitle({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <>
      <Icon name={icon} style={{ color: "var(--orange)" }} />
      {children}
    </>
  );
}
