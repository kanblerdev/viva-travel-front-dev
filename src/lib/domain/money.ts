/**
 * Aritmética de dinero en centavos enteros — espejo de `backend/src/common/utils/money.ts`.
 *
 * Se duplica a mano, como los enums, porque son tres proyectos independientes.
 * Acá solo alimenta la vista previa: el monto que se guarda siempre lo calcula
 * el backend. Aun así usa la misma aritmética, para que lo que el asesor ve
 * mientras escribe coincida al centavo con lo que queda guardado.
 */

export const DECIMAL_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export function isValidAmount(value: string): boolean {
  return DECIMAL_PATTERN.test(value.trim());
}

export function toCents(amount: string): bigint {
  const trimmed = amount.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return 0n;
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n)
    .toString()
    .padStart(2, "0")}`;
}

/** Porcentaje redondeado al centavo, medio hacia arriba. */
export function percentageOf(amountCents: bigint, percentage: string): bigint {
  const hundredths = toCents(percentage);
  const scaled = amountCents * hundredths;
  const quotient = scaled / 10_000n;
  return scaled % 10_000n >= 5_000n ? quotient + 1n : quotient;
}

/** Monto de una comisión sobre un precio, en texto listo para mostrar. */
export function commissionAmount(
  finalPrice: string,
  commission: { mode: "fixed" | "percentage"; value: string },
): string {
  const price = toCents(finalPrice);
  return fromCents(
    commission.mode === "percentage"
      ? percentageOf(price, commission.value)
      : toCents(commission.value),
  );
}
