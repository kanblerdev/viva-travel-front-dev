import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Hasta esta distancia del final, la persona sigue "abajo" y el hilo la acompaña. */
const NEAR_BOTTOM_PX = 80;

/**
 * Desplazamiento de un hilo de chat, como en WhatsApp.
 *
 * Abre en el último mensaje y lo sigue mientras la persona esté abajo. Lo que
 * envía ella siempre la lleva al final. Si subió a leer mensajes viejos, uno que
 * llega no la mueve: se avisa con `hasNew`.
 *
 * El desplazamiento es instantáneo a propósito: una animación dispara eventos de
 * scroll a mitad de camino, que se leerían como que la persona subió.
 */
export function useThreadScroll(messages: { id: string }[]) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [hasNew, setHasNew] = useState(false);

  const stuckToBottom = useRef(true);
  const forceBottom = useRef(false);
  const lastId = useRef<string | null>(null);
  const beforePrepend = useRef<{ height: number; top: number } | null>(null);

  const toBottom = useCallback(() => {
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
    stuckToBottom.current = true;
    setHasNew(false);
  }, [viewport]);

  // Antes de pintar: si no, el hilo se vería un instante desde el principio.
  useLayoutEffect(() => {
    if (!viewport) return;

    const saved = beforePrepend.current;
    if (saved) {
      beforePrepend.current = null;
      viewport.scrollTop = viewport.scrollHeight - saved.height + saved.top;
    }

    const newest = messages[messages.length - 1]?.id ?? null;
    if (!newest || newest === lastId.current) return;
    const firstLoad = lastId.current === null;
    lastId.current = newest;

    if (firstLoad || forceBottom.current || stuckToBottom.current) {
      forceBottom.current = false;
      toBottom();
    } else {
      setHasNew(true);
    }
  }, [messages, viewport, toBottom]);

  useEffect(() => {
    if (!viewport) return;
    const onScroll = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      stuckToBottom.current = distance <= NEAR_BOTTOM_PX;
      if (stuckToBottom.current) setHasNew(false);
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [viewport]);

  // Una foto que termina de cargar, o un cuadro de respuesta que crece, cambian
  // las medidas sin que llegue ningún mensaje: quien está abajo sigue abajo.
  useEffect(() => {
    if (!viewport || !content) return;
    const observer = new ResizeObserver(() => {
      if (stuckToBottom.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [viewport, content]);

  /** Llamar antes de pintar lo que envió la persona. */
  const revealNext = useCallback(() => {
    forceBottom.current = true;
  }, []);

  /** Llamar antes de sumar mensajes antiguos: la lectura se queda donde estaba. */
  const keepPositionOnPrepend = useCallback(() => {
    if (!viewport) return;
    stuckToBottom.current = false;
    beforePrepend.current = { height: viewport.scrollHeight, top: viewport.scrollTop };
  }, [viewport]);

  return {
    viewportRef: setViewport,
    contentRef: setContent,
    hasNew,
    toBottom,
    revealNext,
    keepPositionOnPrepend,
  };
}
