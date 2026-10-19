"use client";

import { useState } from "react";

export type TrendPoint = {
  key: string;
  /** Eje X, corto: "nov", "dic", "ene"… */
  label: string;
  /** Segunda línea bajo la etiqueta —el año donde cambia—, para que la
   *  primera siga entrando cuando las columnas son angostas. */
  sublabel?: string;
  /** `null` = sin dato (la tasa de cierre de un mes sin cotizaciones). */
  value: number | null;
  /** Lo que muestra la burbuja al pasar o enfocar la columna: cada fila ya formateada. */
  tooltip: { title: string; rows: { value: string; label: string }[] };
  /** Mes incompleto: se dibuja más claro para que no se lea como una caída. */
  partial?: boolean;
};

/**
 * Columnas de doce meses · la tendencia del tablero.
 *
 * Reemplaza a las doce barras apiladas de `BarList`: ahí cada mes ocupaba tres
 * líneas y la "película" no se veía entera sin desplazarse. Lo que se quiere
 * leer en una tendencia es la silueta —qué meses subieron, cuáles cayeron— y en
 * 180 px de alto entran los doce.
 *
 * Mismo criterio de color que el resto del CRM: una serie, un color. La cifra
 * directa va solo sobre el mes más alto; el resto lo dan la burbuja (al pasar
 * o al enfocar con el teclado) y la tabla plegada debajo, así que ningún valor
 * depende de pasar el puntero.
 *
 * Es HTML y CSS, no SVG: las columnas son cajas flexibles y las alturas van en
 * porcentaje, así que el gráfico se adapta al ancho de la tarjeta sin medir
 * nada.
 */
export function TrendChart({
  points,
  format,
  formatTick = format,
  height = 180,
  table,
  emptyText = "Sin datos en el período.",
}: {
  points: TrendPoint[];
  /** Cómo se escribe un valor: la cifra sobre la columna más alta. */
  format: (value: number) => string;
  /** Cómo se escribe una marca del eje; por defecto igual que el valor. */
  formatTick?: (value: number) => string;
  /** Alto mínimo del área de dibujo, en píxeles, sin contar el eje X; crece si la tarjeta lo permite. */
  height?: number;
  /** La tabla equivalente, plegada: cabeceras y filas ya formateadas. */
  table?: { head: string[]; rows: string[][] };
  emptyText?: string;
}) {
  const [active, setActive] = useState<string | null>(null);

  if (points.length === 0) {
    return <p className="barlist-empty">{emptyText}</p>;
  }

  const max = Math.max(...points.map((point) => point.value ?? 0), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const maxKey = max > 0 ? points.find((point) => point.value === max)?.key : undefined;

  return (
    <div className="tchart">
      <div className="tchart-plot" style={{ minHeight: height }}>
        <div className="tchart-inner">
          {ticks.map((tick) => (
            <div
              key={tick}
              className={`tchart-grid${tick === 0 ? " is-base" : ""}`}
              style={{ bottom: `${(tick / top) * 100}%` }}
            >
              <span>{formatTick(tick)}</span>
            </div>
          ))}

          <div className="tchart-cols" onMouseLeave={() => setActive(null)}>
            {points.map((point) => {
              const pct = point.value === null ? 0 : (point.value / top) * 100;
              const isActive = active === point.key;
              return (
                <button
                  key={point.key}
                  type="button"
                  className={`tchart-col${isActive ? " is-active" : ""}`}
                  aria-label={`${point.tooltip.title}: ${
                    point.value === null ? "sin dato" : format(point.value)
                  }`}
                  onMouseEnter={() => setActive(point.key)}
                  onFocus={() => setActive(point.key)}
                  onBlur={() => setActive(null)}
                >
                  {point.key === maxKey && !isActive && point.value !== null && (
                    <span className="tchart-cap" style={{ bottom: `calc(${pct}% + 4px)` }}>
                      {format(point.value)}
                    </span>
                  )}
                  <span
                    className={`tchart-bar${point.partial ? " is-partial" : ""}${
                      point.value === null ? " is-null" : ""
                    }`}
                    style={{ height: `${pct}%` }}
                  />
                  {isActive && (
                    <span className="tchart-tip" role="tooltip">
                      <b>{point.tooltip.title}</b>
                      {point.tooltip.rows.map((row) => (
                        <span key={row.label}>
                          <em>{row.value}</em>
                          <i>{row.label}</i>
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="tchart-x" aria-hidden="true">
        {points.map((point) => (
          <span key={point.key}>
            {point.label}
            {point.sublabel && <small>{point.sublabel}</small>}
          </span>
        ))}
      </div>

      {max === 0 && <p className="tchart-empty">{emptyText}</p>}

      {table && (
        <details className="tchart-table">
          <summary>Ver como tabla</summary>
          <table className="t">
            <thead>
              <tr>
                {table.head.map((cell, index) => (
                  <th key={cell} className={index === 0 ? undefined : "num"}>
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, index) => (
                    <td key={index} className={index === 0 ? undefined : "num"}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

/**
 * Marcas "redondas" del eje: cuatro o cinco pasos de 1, 2, 2.5 o 5 por potencia
 * de diez, nunca menores que 1 (los conteos y los porcentajes no se parten).
 * Con 2,000 da 0 · 500 · 1,000 · 1,500 · 2,000; con 7 ventas, 0 · 2 · 4 · 6 · 8.
 */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(
    1,
    [1, 2, 2.5, 5, 10].map((unit) => unit * magnitude).find((candidate) => candidate >= raw) ??
      magnitude * 10,
  );
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= top + step / 2; tick += step) {
    ticks.push(Math.round(tick * 100) / 100);
  }
  return ticks;
}
