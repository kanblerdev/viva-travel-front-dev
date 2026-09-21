"use client";

import { useRef, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";

export type TabOption<T extends string> = {
  id: T;
  label: ReactNode;
  icon?: IconName;
  /** Cuántos elementos hay detrás de la pestaña. `null` mientras se cargan. */
  count?: number | null;
};

/**
 * Pestañas con la semántica que exige ARIA · `E2`.
 *
 * Las tres pantallas que las usaban las habían resuelto con `aria-pressed`, que
 * describe un botón que queda hundido —negrita, silenciar— y no una pestaña. Un
 * lector de pantalla anunciaba "botón, presionado" y no "pestaña 2 de 4", así
 * que no había forma de saber cuántas vistas hay ni en cuál se está.
 *
 * Lo que ARIA pide y esto hace: `tablist` con `tab` dentro, `aria-selected`
 * marcando la activa, y cada pestaña apuntando a su panel con `aria-controls`.
 *
 * Y el teclado, que es lo que más cambia en la práctica: **una sola parada de
 * tabulador** para todo el grupo, y las flechas se mueven entre pestañas. Con
 * botones sueltos había que tabular por cada una para llegar al contenido, y en
 * el expediente —cinco pestañas— eso son cinco pulsaciones de más en cada
 * vuelta.
 */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  label,
  idPrefix,
  className,
  style,
}: {
  options: readonly TabOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Qué agrupan, para quien no ve la pantalla. */
  label: string;
  /** Prefijo de los `id`, para que dos grupos en la misma página no choquen. */
  idPrefix: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const index = options.findIndex((option) => option.id === value);
    const last = options.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowLeft"
            ? (index - 1 + options.length) % options.length
            : (index + 1) % options.length;

    onChange(options[next].id);
    // El foco sigue a la selección, como pide el patrón de pestañas
    // automáticas: si se quedara atrás, la siguiente flecha partiría del lugar
    // equivocado.
    listRef.current?.querySelector<HTMLElement>(`#${idPrefix}-tab-${options[next].id}`)?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={className ?? "viewtabs"}
      style={style}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            id={`${idPrefix}-tab-${option.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${option.id}`}
            // Una sola parada de tabulador para el grupo entero.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.id)}
          >
            {option.icon && <Icon name={option.icon} />}
            {option.label}
            {option.count != null && <span className="tab-count">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** El contenido de la pestaña activa, atado a ella por `aria-labelledby`. */
export function TabPanel({
  id,
  idPrefix,
  children,
  className,
  style,
}: {
  id: string;
  idPrefix: string;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      id={`${idPrefix}-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`${idPrefix}-tab-${id}`}
      // Enfocable para que el tabulador entre al contenido después de la
      // pestaña, que es a donde la persona espera llegar.
      tabIndex={0}
      className={className}
      style={style}
    >
      {children}
    </div>
  );
}
