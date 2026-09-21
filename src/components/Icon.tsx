import type { CSSProperties } from "react";

export type IconName =
  | "dashboard" | "kanban" | "users" | "doc" | "cart" | "truck"
  | "chart" | "folder" | "shield" | "settings" | "bell" | "search"
  | "plus" | "filter" | "sort" | "lock" | "mail" | "arrow-up"
  | "arrow-down" | "check" | "target" | "tag" | "paperclip"
  | "download" | "edit" | "trash" | "eye" | "pin" | "arrow-right"
  | "phone" | "calendar" | "globe" | "image" | "plane" | "logout"
  | "menu" | "x" | "dots";

type Props = {
  name: IconName;
  className?: string;
  style?: CSSProperties;
  width?: number | string;
  height?: number | string;
};

/**
 * Tamaño de reserva.
 *
 * Sin él, un icono cuyo contenedor no fija `width`/`height` por CSS se dibuja
 * al tamaño por defecto de un SVG sin dimensiones —cientos de píxeles— y
 * revienta la caja que lo contiene. Pasó en el botón de enviar de la bandeja,
 * que era el único sitio sin su regla. Como `width` y `height` son atributos de
 * presentación, cualquier regla CSS existente les sigue ganando: esto no
 * cambia ningún icono ya dimensionado.
 */
const DEFAULT_SIZE = 16;

export function Icon({ name, className, style, width, height }: Props) {
  return (
    <svg
      className={className}
      style={style}
      width={width ?? DEFAULT_SIZE}
      height={height ?? DEFAULT_SIZE}
      aria-hidden="true"
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}
