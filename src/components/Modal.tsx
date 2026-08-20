"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "@/components/Icon";

/** Elementos que pueden recibir el foco dentro del diálogo. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Diálogo del CRM · hallazgo G4.
 *
 * Los cuatro módulos traían su propia copia, y ninguna atrapaba el foco: el
 * tabulador se escapaba hacia la página de atrás, que sigue ahí y sigue siendo
 * navegable aunque no se vea. Para quien usa teclado o lector de pantalla eso
 * significa perderse fuera de un diálogo que dice ser modal.
 *
 * Hace las cuatro cosas que un diálogo debe hacer y ninguna hacía completa:
 * atrapar el foco, devolverlo al cerrar, cerrar con Escape y bloquear el
 * desplazamiento del fondo.
 */
export function Modal({
  title,
  onClose,
  children,
  /** Ancho máximo, para los diálogos que muestran más que un formulario corto. */
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    // Se guarda ANTES de mover el foco: al cerrar hay que devolverlo al control
    // que abrió el diálogo, no dejarlo al principio de la página.
    const opener = document.activeElement as HTMLElement | null;

    function focusables(): HTMLElement[] {
      return Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.offsetParent !== null,
      );
    }

    // El primer campo, o el diálogo mismo si no hay ninguno: abrir un diálogo
    // con el foco todavía detrás es lo que rompe la navegación por teclado.
    const first = focusables()[0];
    (first ?? dialog)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const elements = focusables();
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = elements[0];
      const lastElement = elements[elements.length - 1];
      const active = document.activeElement;

      // El ciclo se cierra a mano en los dos extremos; sin esto el tabulador
      // sale del diálogo hacia la página de atrás.
      if (event.shiftKey && (active === firstElement || !dialog?.contains(active))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && active === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={wide ? { maxWidth: 720 } : undefined}
        // `onMouseDown` y no `onClick`: soltar el botón fuera del diálogo tras
        // seleccionar texto dentro lo cerraba y se perdía lo escrito.
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
