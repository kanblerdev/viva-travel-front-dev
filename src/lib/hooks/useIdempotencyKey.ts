"use client";

import { useMemo, useRef } from "react";

/**
 * Clave de idempotencia para una acción que crea o envía algo.
 *
 * El backend recuerda cada `Idempotency-Key` por 24 h. Si la misma petición
 * llega dos veces —doble clic, o un reintento después de "el servidor no
 * respondió a tiempo" cuando en realidad sí lo hizo—, la segunda no se ejecuta:
 * devuelve la respuesta de la primera.
 *
 * La clave tiene dos partes:
 *
 *  - un **intento** al azar, que dura hasta que la acción sale bien, y
 *  - la **huella** de lo que se manda.
 *
 * Así, reintentar lo mismo reusa la clave y no duplica nada. Si se cambian
 * los datos (otro monto, otro texto), la clave también cambia y es una
 * operación nueva. Después de un éxito hay que llamar a `renew()`: dos abonos
 * iguales hechos a propósito son dos abonos.
 *
 * Uso:
 *
 *   const idem = useIdempotencyKey();
 *   await crmApi.registerPayment(id, input, { idempotencyKey: idem.keyFor(input) });
 *   idem.renew();
 */
export function useIdempotencyKey() {
  const attempt = useRef<string>(newAttemptId());

  return useMemo(
    () => ({
      keyFor: (payload: unknown = null) => `${attempt.current}.${fingerprint(payload)}`,
      renew: () => {
        attempt.current = newAttemptId();
      },
    }),
    [],
  );
}

function newAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // `randomUUID` exige contexto seguro; en http://<ip-de-la-red> no existe.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Huella corta de lo que se manda. Un `File` se resume por nombre, tamaño, tipo
 * y fecha: leerlo entero para firmarlo sería lento.
 */
function fingerprint(payload: unknown): string {
  const text = JSON.stringify(payload ?? null, (_key, value: unknown) =>
    typeof File !== "undefined" && value instanceof File
      ? { file: value.name, size: value.size, type: value.type, modified: value.lastModified }
      : value,
  );
  return cyrb53(text).toString(16);
}

/** Hash de 53 bits, sin dependencias. Basta para distinguir dos cuerpos. */
function cyrb53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
