import { relativeTime } from "@/lib/api/crm";

/**
 * Una fecha relativa que no esconde la absoluta · `E3`.
 *
 * "hace 3 d" se lee de un vistazo y por eso el CRM la usa en todos lados, pero
 * sola no sirve para lo que el equipo hace a diario: decidir si llamar hoy,
 * copiar la fecha a un correo, discutir con un proveedor qué día se mandó algo.
 * Para eso hace falta el día exacto, y hasta ahora había que abrir el registro.
 *
 * `<time dateTime>` es lo que además deja que un lector de pantalla anuncie la
 * fecha real en vez de "3 d", y que el navegador la entienda como fecha.
 *
 * La absoluta va en `title` —visible al pasar el puntero— y no en el texto,
 * porque duplicarla en pantalla ensucia las tablas que son casi todo el CRM.
 */
export function RelativeTime({
  iso,
  empty = "—",
  className,
}: {
  iso: string | null | undefined;
  /** Qué mostrar cuando no hay fecha. */
  empty?: string;
  className?: string;
}) {
  if (!iso) return <span className={className}>{empty}</span>;

  return (
    <time className={className} dateTime={iso} title={absoluteDate(iso)}>
      {relativeTime(iso)}
    </time>
  );
}

/** Día, mes, año y hora en la zona de la agencia. Es lo que se copia a un correo. */
export function absoluteDate(iso: string): string {
  return new Date(iso).toLocaleString("es-SV", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
