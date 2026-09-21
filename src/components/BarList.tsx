"use client";

import type { ReactNode } from "react";

export type BarDatum = {
  key: string;
  /** Lo que se lee a la izquierda. Puede llevar un chip o un icono. */
  label: ReactNode;
  /** El que dibuja la barra. */
  value: number;
  /** Lo que se escribe al final de la barra: el valor con su unidad. */
  display: string;
  /** Segunda línea bajo la etiqueta: la conversión del paso, el margen… */
  note?: string;
};

/**
 * Barras horizontales · el gráfico de todo este CRM.
 *
 * Horizontal y no vertical porque las categorías son nombres largos —"Cotización
 * enviada", "Punta Cana", "Mayorista Caribe"— y en vertical habría que girarlos.
 *
 * **Un solo color para todas las barras, a propósito.** El largo de la barra ya
 * dice la magnitud, y gastar el canal de color en repetirlo deja sin recursos lo
 * que sí necesita identidad. Cuando el orden importa —el embudo— lo carga la
 * posición: las filas van en el orden del tablero y de arriba hacia abajo.
 *
 * Se descartó la rampa ordinal de un hue: con ocho etapas los pasos de
 * luminosidad quedan por debajo del mínimo legible (verificado con el validador
 * de la guía; cinco pasos es el máximo que pasa), así que el degradado habría
 * sido decorativo y no informativo.
 *
 * Cada valor se lee de tres formas —etiqueta, número al final y la tabla que
 * acompaña a cada reporte—, así que nada depende de pasar el puntero.
 */
export function BarList({
  data,
  emptyText = "Sin datos en el período.",
}: {
  data: BarDatum[];
  emptyText?: string;
}) {
  const max = Math.max(...data.map((item) => item.value), 0);

  if (data.length === 0 || max === 0) {
    return <p className="barlist-empty">{emptyText}</p>;
  }

  return (
    <ul className="barlist">
      {data.map((item) => (
        <li key={item.key}>
          <div className="barlist-head">
            <span className="barlist-label">{item.label}</span>
            <span className="barlist-value">{item.display}</span>
          </div>
          <div className="barlist-track">
            <div
              className="barlist-fill"
              // El ancho es el dato: se calcula acá porque depende del máximo de
              // la serie, que la hoja de estilos no conoce.
              style={{ width: `${Math.max(1.5, (item.value / max) * 100)}%` }}
            />
          </div>
          {item.note && <div className="barlist-note">{item.note}</div>}
        </li>
      ))}
    </ul>
  );
}
