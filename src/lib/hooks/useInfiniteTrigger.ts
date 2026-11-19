"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Carga automática al acercarse a un borde, como en WhatsApp Web.
 *
 * Se engancha a un elemento —el botón "Cargar más" al pie de la lista, o
 * "Ver mensajes anteriores" arriba del hilo— y llama a `onTrigger` cuando ese
 * elemento entra a `margin` píxeles de la zona visible de su contenedor con
 * scroll. El botón sigue ahí: con teclado, o si el navegador no avisa, se
 * puede pulsar igual.
 *
 * `version` tiene que cambiar después de cada carga (el largo de la lista).
 * Así el observador se vuelve a crear y revisa si el elemento SIGUE visible:
 * una tanda que no llena la pantalla pide la siguiente sin esperar al usuario.
 */
export function useInfiniteTrigger(
  onTrigger: () => void,
  {
    enabled,
    version,
    rootSelector,
    margin = 240,
  }: { enabled: boolean; version: number; rootSelector: string; margin?: number },
) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const latest = useRef(onTrigger);
  latest.current = onTrigger;

  useEffect(() => {
    if (!enabled || !element || typeof IntersectionObserver === "undefined") return;

    const root = element.closest(rootSelector);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { root, rootMargin: `${margin}px 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, element, version, rootSelector, margin]);

  return useCallback((node: HTMLElement | null) => setElement(node), []);
}
