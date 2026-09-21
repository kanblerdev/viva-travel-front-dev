"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  /**
   * Fuerza —o desactiva— el aviso de cambios sin guardar.
   *
   * Por defecto el diálogo lo decide solo (ver abajo). Esto existe para los
   * casos que el diálogo no puede ver: un editor que guarda en un estado
   * externo, o un diálogo de solo lectura donde preguntar sobraría.
   */
  hasUnsavedChanges,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  hasUnsavedChanges?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  /*
   * ¿Hay algo escrito que se perdería al cerrar? · `E1`
   *
   * Cerrar un diálogo es fácil de hacer sin querer —Escape, un clic fuera, la
   * X— y con un formulario a medio llenar eso borra minutos de trabajo sin
   * preguntar.
   *
   * Se detecta escuchando los eventos `input` y `change` NATIVOS del diálogo,
   * en vez de pedirle la respuesta a cada uno de los veintiún diálogos del CRM.
   * La clave es que un `setState` de React que cambia el valor de un campo
   * controlado NO dispara un evento nativo: solo lo dispara una persona
   * escribiendo o eligiendo. Así no hay falsos positivos por un `select` que se
   * completa solo cuando llega su catálogo, que es justo lo que arruinaría la
   * idea.
   *
   * En una `ref` y no en el estado: el efecto monta la trampa de foco una sola
   * vez, y volver a montarla al primer tecleo devolvería el foco al primer
   * campo a media palabra.
   *
   * El botón **Cancelar** de cada diálogo NO pregunta, a propósito: cancelar es
   * decir "descartá esto", y volver a preguntarlo sería ruido. El aviso es para
   * las tres formas de cerrar sin querer.
   */
  const dirtyRef = useRef(false);

  const requestClose = useCallback(() => {
    if (hasUnsavedChanges ?? dirtyRef.current) setConfirmingDiscard(true);
    else onClose();
  }, [hasUnsavedChanges, onClose]);

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
        requestClose();
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

    const markDirty = () => {
      dirtyRef.current = true;
    };
    dialog?.addEventListener("input", markDirty);
    dialog?.addEventListener("change", markDirty);

    document.addEventListener("keydown", onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      dialog?.removeEventListener("input", markDirty);
      dialog?.removeEventListener("change", markDirty);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [requestClose]);

  return (
    <div className="modal-backdrop" onMouseDown={requestClose}>
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
          <button type="button" className="iconbtn" onClick={requestClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>

        {confirmingDiscard && (
          <div className="modal-discard" role="alert">
            <b>Hay cambios sin guardar.</b> Si cerrás ahora se pierden.
            <div>
              <button type="button" className="btn danger tiny" onClick={onClose}>
                Descartar cambios
              </button>
              <button
                type="button"
                className="btn ghost tiny"
                onClick={() => setConfirmingDiscard(false)}
              >
                Seguir editando
              </button>
            </div>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
