"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";

/**
 * Los tres estados que toda pantalla de listado tiene que cubrir · `D7`.
 *
 * El DoD del plan los exige —"carga, vacío, error y guardado"— y cada módulo
 * los había escrito por su cuenta: `padding: 48` en un `style` inline, repetido
 * en Cotizaciones, Ventas, Proveedores y Clientes. Cuatro copias del mismo
 * bloque significan cuatro lugares donde corregir un cambio de maqueta, y ya
 * habían empezado a divergir en el color y en el texto del botón.
 *
 * La maqueta vive en la hoja de estilos (`.state-card`) y no en atributos
 * `style`: la lección del Sprint 5C es que una maqueta en línea le gana a
 * cualquier `@media` y rompe el móvil sin avisar.
 */

/** Mientras llegan los datos. */
export function LoadingCard({ children }: { children: ReactNode }) {
  return (
    <div className="card state-card" role="status" aria-live="polite">
      <p className="state-card-note">{children}</p>
    </div>
  );
}

/**
 * La petición falló.
 *
 * Siempre con la salida a mano: un error sin botón obliga a recargar la página
 * entera y perder los filtros que costó armar.
 */
export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card state-card" role="alert">
      <p className="state-card-error">{message}</p>
      <button type="button" className="btn ghost" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}

/**
 * No hay nada que mostrar.
 *
 * `hint` explica por qué está vacío —no es lo mismo "todavía no cargaste
 * ninguna" que "ningún resultado con estos filtros"— y `action` ofrece la
 * salida cuando la hay.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: IconName;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card state-card">
      {icon && <Icon name={icon} width={28} height={28} className="state-card-icon" />}
      <p className="state-card-title">{title}</p>
      {hint && <p className="state-card-note">{hint}</p>}
      {action}
    </div>
  );
}
