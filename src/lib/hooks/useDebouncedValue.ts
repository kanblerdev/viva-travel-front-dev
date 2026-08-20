"use client";

import { useEffect, useState } from "react";

/**
 * Retrasa un valor hasta que deja de cambiar durante `delayMs`.
 *
 * Pensado para campos de texto que disparan una consulta al servidor: sin esto,
 * escribir "maría" son cinco renders con su tanda de peticiones cada uno.
 *
 * Solo se aplica a lo que se ESCRIBE. Los selectores de filtro no pasan por acá:
 * elegir una opción es una decisión terminada y esperar 300 ms se siente lento.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
