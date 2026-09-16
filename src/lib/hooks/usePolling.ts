"use client";

import { useEffect, useRef } from "react";

/**
 * Ejecuta `task` ahora y después cada `intervalMs` · HU-MSG-02.
 *
 * La bandeja es "casi en tiempo real" por consulta periódica y no por socket: el
 * API corre detrás del proxy de Railway y el CRM en Vercel, y una consulta cada
 * pocos segundos no necesita infraestructura nueva ni se cae con un proxy.
 *
 * Dos cuidados:
 *  - Con la pestaña oculta no consulta: diez pestañas abiertas del CRM serían
 *    diez veces la carga para nadie mirando. Al volver, consulta en el acto.
 *  - Usa siempre la última versión de `task` sin reiniciar el intervalo, así
 *    un render no deja dos temporizadores corriendo. Lo que SÍ tiene que
 *    consultar en el acto —otro filtro, otra conversación— se pasa en
 *    `restartOn`: sin eso, cambiar de pestaña esperaría hasta el próximo ciclo.
 */
export function usePolling(
  task: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
  restartOn?: unknown,
) {
  const latest = useRef(task);
  latest.current = task;

  useEffect(() => {
    if (!enabled) return;

    const run = () => {
      if (document.visibilityState === "visible") void latest.current();
    };

    run();
    const timer = setInterval(run, intervalMs);
    document.addEventListener("visibilitychange", run);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [intervalMs, enabled, restartOn]);
}
