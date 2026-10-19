"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { BarList, type BarDatum } from "@/components/BarList";
import { TrendChart, type TrendPoint } from "@/components/TrendChart";
import { useSession } from "@/lib/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import {
  crmApi,
  formatMoney,
  type ChannelsReport,
  type DashboardSummary,
  type FunnelReport,
  type SaleSummary,
  type TrendReport,
  type UtilityReport,
} from "@/lib/api/crm";
import {
  CHANNEL_LABEL,
  PIPELINE_STAGE_LABEL,
  type Channel,
  type PipelineStageCode,
} from "@/lib/domain/enums";

const CHANNEL_CLASS: Record<string, string> = {
  whatsapp: "wa",
  messenger: "ms",
  instagram: "ig",
  other: "",
};

/** `undefined` = cargando, `null` = falló, y el dato cuando llegó. */
type Loadable<T> = T | null | undefined;

/**
 * Dashboard · HU-DAS-01 a HU-DAS-08.
 *
 * Todos los números vienen calculados del backend. La pantalla no deriva
 * ninguno: los mismos indicadores se reproducen igual en Reportes, porque
 * salen de los mismos endpoints. Dos cálculos del mismo KPI terminan siempre
 * discrepando, y que el tablero y el reporte no coincidan por el mismo período
 * es peor que no tener el tablero.
 *
 * La retícula (18 oct 2026) va en filas de altura parecida para que ninguna
 * deje huecos: seis indicadores en una línea (tres y tres en pantallas
 * medianas); la tendencia junto a los pendientes; las dos lecturas de las
 * etapas lado a lado, con las mismas ocho filas; y tres tarjetas cortas con
 * sucursales y canales. Cada tarjeta conserva su sitio mientras carga o si
 * falla, así el tablero no salta.
 */
export function DashboardView() {
  const { user } = useSession();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const advisorId = onlyMine ? user?.id : undefined;

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await crmApi.dashboard(advisorId ? { advisorId } : {}));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo cargar el dashboard.",
      );
    }
  }, [advisorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const analysis = useAnalisis(advisorId);

  if (error) {
    return (
      <div className="card" style={{ padding: 48, textAlign: "center" }}>
        <div style={{ color: "var(--red)", fontWeight: 600, marginBottom: 10 }}>{error}</div>
        <button className="btn ghost" onClick={() => void load()}>
          Reintentar
        </button>
      </div>
    );
  }

  const closeRate = data?.closeRate.rate;

  return (
    <>
      <div className="page-h">
        <div>
          <h1>{user ? `¡Hola, ${user.fullName.split(" ")[0]}!` : "Dashboard"}</h1>
          <div className="sub">
            Resumen comercial de {data ? formatPeriod(data.period) : "este mes"}.
          </div>
        </div>
        <div className="actions">
          <button
            type="button"
            className={`btn ${onlyMine ? "primary" : "ghost"}`}
            onClick={() => setOnlyMine((value) => !value)}
          >
            <Icon name="users" />
            {onlyMine ? "Solo lo mío" : "Todo el equipo"}
          </button>
        </div>
      </div>

      {/* Fila 1 · los seis indicadores del período en una sola línea. Antes
          eran cinco y el quinto quedaba solo en una segunda fila, con tres
          huecos al lado. Van en dos grupos de tres —el dinero (ventas,
          utilidad, por cobrar) y el embudo (esperado, abiertas, cierre)— que es
          como se parten cuando la pantalla no da para seis. */}
      <div className="stats six">
        <div className="stat">
          <div className="label">
            Ventas del período
            <div className="ico orange">
              <Icon name="cart" width={14} height={14} />
            </div>
          </div>
          <div className="val">
            {data ? formatMoney(data.sales.totalAmount) : "—"}
            <span className="u">USD</span>
          </div>
          <div style={subtleStyle}>
            {data
              ? `${data.sales.count} ${plural(data.sales.count, "operación", "operaciones")} · ticket ${formatMoney(data.sales.averageTicket)}`
              : "Cargando…"}
          </div>
          {data && (
            <Delta
              current={Number(data.sales.totalAmount)}
              previous={Number(data.previous.sales.totalAmount)}
            />
          )}
        </div>

        {/* HU-DAS-03 · lo que dejó el período. Es un indicador más del período,
            así que va entre los indicadores y no en una tarjeta aparte. */}
        <div className="stat">
          <div className="label">
            Utilidad del período
            <div className="ico green">
              <Icon name="chart" width={14} height={14} />
            </div>
          </div>
          <div className="val">
            {analysis.utility ? formatMoney(analysis.utility.totals.utility) : "—"}
            <span className="u">USD</span>
          </div>
          <div style={subtleStyle}>
            {analysis.utility === undefined
              ? "Cargando…"
              : analysis.utility === null
                ? "No se pudo cargar"
                : `margen ${marginLabel(analysis.utility.totals.marginPercent)} · gestión ${formatMoney(analysis.utility.totals.managementCommission)} · agencia ${formatMoney(analysis.utility.totals.agencyCommission)}`}
          </div>
        </div>

        <div className="stat">
          <div className="label">
            Por cobrar
            <div className="ico purple">
              <Icon name="tag" width={14} height={14} />
            </div>
          </div>
          <div className="val" style={{ color: "var(--orange-deep)" }}>
            {data ? formatMoney(data.pending.outstandingAmount) : "—"}
            <span className="u">USD</span>
          </div>
          <div style={subtleStyle}>
            {data
              ? `${data.pending.salesWithBalance} ${plural(data.pending.salesWithBalance, "venta con saldo", "ventas con saldo")}`
              : "Cargando…"}
          </div>
        </div>

        {/* HU-REP-07 · lo que viene en camino, a hoy. Es foto, no período: no
            lleva delta. */}
        <div className="stat">
          <div className="label">
            Dinero esperado
            <div className="ico blue">
              <Icon name="doc" width={14} height={14} />
            </div>
          </div>
          <div className="val">
            {data ? formatMoney(data.expected.amount) : "—"}
            <span className="u">USD</span>
          </div>
          <div style={subtleStyle}>
            {data
              ? `${data.expected.count} ${plural(data.expected.count, "cotización vigente", "cotizaciones vigentes")}`
              : "Cargando…"}
          </div>
          {data && data.expected.expiringSoon.count > 0 && (
            <div style={{ fontSize: 11, color: "var(--orange-deep)", marginTop: 4, fontWeight: 600 }}>
              {data.expected.expiringSoon.count}{" "}
              {plural(data.expected.expiringSoon.count, "vence", "vencen")} en{" "}
              {data.expected.expiringSoon.days} días · {formatMoney(data.expected.expiringSoon.amount)}
            </div>
          )}
        </div>

        <div className="stat">
          <div className="label">
            Oportunidades abiertas
            <div className="ico blue">
              <Icon name="target" width={14} height={14} />
            </div>
          </div>
          <div className="val">{data ? data.openOpportunities.count : "—"}</div>
          <div style={subtleStyle}>
            {data
              ? `${formatMoney(data.openOpportunities.estimatedValue)} en valor estimado`
              : "Cargando…"}
          </div>
        </div>

        {/* La aclaración de la fórmula (una venta puede venir de una cotización
            de otro período) va acá, en el indicador al que pertenece, y no al
            pie del embudo como antes. */}
        <div className="stat" title={data?.closeRate.caveat}>
          <div className="label">
            Tasa de cierre
            <div className="ico green">
              <Icon name="check" width={14} height={14} />
            </div>
          </div>
          <div className="val">
            {closeRate === null || closeRate === undefined
              ? "—"
              : Math.round(closeRate * 100)}
            {closeRate !== null && closeRate !== undefined && <span className="u">%</span>}
          </div>
          <div style={subtleStyle}>
            {data
              ? `${data.closeRate.salesCreated} ${plural(data.closeRate.salesCreated, "venta", "ventas")} de ${data.closeRate.quotesSent} ${plural(data.closeRate.quotesSent, "cotización enviada", "cotizaciones enviadas")}`
              : "Cargando…"}
          </div>
          {/* En puntos, no en variación relativa: "del 40 % al 52 %" se lee
              directo; "+30 %" sobre una tasa confunde. */}
          {data && data.previous.closeRate.rate !== null && closeRate !== null && closeRate !== undefined && (
            <Delta
              current={Math.round(closeRate * 100)}
              previous={Math.round(data.previous.closeRate.rate * 100)}
              unit="pts"
            />
          )}
        </div>

      </div>

      {/* Fila 2 · la película y la lista de hoy. La tendencia va arriba y a lo
          ancho porque es el contexto de todos los números del período;
          Pendientes a su lado, porque es lo que hay que hacer hoy. */}
      <div className="row-split" style={{ marginTop: 14 }}>
        <Tendencia advisorId={advisorId} />
        <PendientesCard data={data} />
      </div>

      <AlertasDeViaje />

      {/* Fila 3 · las etapas, dos veces y con las mismas ocho filas en el mismo
          orden: cuántos llegaron a cada una en el período (acumulado) y cuántos
          están hoy en cada una. Se leen una contra la otra, y al compartir
          estructura las dos tarjetas miden lo mismo. */}
      <div className="report-grid" style={{ marginTop: 14 }}>
        <EmbudoPeriodoCard funnel={analysis.funnel} />
        <EmbudoAbiertoCard data={data} funnel={analysis.funnel} />
      </div>

      {/* Fila 4 · de dónde viene el dinero y por dónde se habla: tres tarjetas
          cortas, de la misma altura. */}
      <div className="dash-grid-3" style={{ marginTop: 14 }}>
        <SucursalesCard data={data} />
        <CanalVentasCard channels={analysis.channels} />
        <CanalConversacionesCard channels={analysis.channels} />
      </div>
    </>
  );
}

/**
 * La variación contra el período equivalente anterior · HU-DAS-08.
 *
 * Verde cuando sube y rojo cuando baja; sin base (anterior = 0) no se muestra
 * nada: un "+∞ %" es ruido. Con `unit="pts"` compara en puntos directos, que
 * es como se lee una tasa.
 */
function Delta({
  current,
  previous,
  unit,
}: {
  current: number;
  previous: number;
  unit?: "pts";
}) {
  if (unit !== "pts" && previous === 0) return null;

  const value =
    unit === "pts"
      ? Math.round((current - previous) * 10) / 10
      : Math.round(((current - previous) / previous) * 1000) / 10;
  if (value === 0) {
    return (
      <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 4 }}>
        Igual que el período anterior
      </div>
    );
  }

  const up = value > 0;
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        marginTop: 4,
        color: up ? "var(--green)" : "var(--red)",
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <Icon name={up ? "arrow-up" : "arrow-down"} width={11} height={11} />
      {up ? "+" : ""}
      {value} {unit === "pts" ? "pts" : "%"}
      <span style={{ color: "var(--text-mute)", fontWeight: 500 }}>vs período anterior</span>
    </div>
  );
}

/* ───────────────────── HU-REP-12 · tendencia de 12 meses ──────────────────── */

type Metric = "revenue" | "utility" | "sales" | "closeRate";

const METRICS: { key: Metric; label: string }[] = [
  { key: "revenue", label: "Ingresos" },
  { key: "utility", label: "Utilidad" },
  { key: "sales", label: "Ventas" },
  { key: "closeRate", label: "Cierre" },
];

/**
 * Tendencia de 12 meses · HU-REP-12.
 *
 * Mismo endpoint que el reporte. Un gráfico de columnas con un selector de
 * indicador en vez de doce barras apiladas: la silueta de los doce meses se
 * ve entera, y el resumen de la cabecera da los totales sin tener que sumar
 * mes por mes. La burbuja de cada mes trae los cuatro indicadores, se mire el
 * que se mire. El último mes es el que corre: se dibuja más claro para que no
 * se lea como una caída.
 */
function Tendencia({ advisorId }: { advisorId?: string }) {
  const [trend, setTrend] = useState<Loadable<TrendReport>>(undefined);
  const [metric, setMetric] = useState<Metric>("revenue");

  useEffect(() => {
    let vigente = true;
    crmApi
      .trendReport(advisorId ? { advisorId } : {})
      .then((loaded) => {
        if (vigente) setTrend(loaded);
      })
      .catch(() => {
        if (vigente) setTrend(null);
      });
    return () => {
      vigente = false;
    };
  }, [advisorId]);

  const months = trend?.months ?? [];
  const isMoney = metric === "revenue" || metric === "utility";
  const format = (value: number) =>
    isMoney ? money(value) : metric === "closeRate" ? `${value} %` : String(value);
  const formatTick = (value: number) => (isMoney ? compactMoney(value) : format(value));

  const points: TrendPoint[] = months.map((month, index) => {
    const current = index === months.length - 1;
    const [year, mm] = month.month.split("-");
    return {
      key: month.month,
      label: MONTH_NAMES[Number(mm) - 1] ?? mm,
      // El año solo donde cambia (y en el primer mes), para no repetirlo doce veces.
      sublabel: index === 0 || mm === "01" ? `'${year.slice(2)}` : undefined,
      value: metricValue(month, metric),
      partial: current,
      tooltip: {
        title: `${monthLabel(month.month)}${current ? " · en curso" : ""}`,
        rows: [
          { value: formatMoney(month.revenue), label: "ingresos" },
          { value: String(month.salesCount), label: plural(month.salesCount, "venta", "ventas") },
          { value: formatMoney(month.utility), label: "utilidad" },
          { value: percent(month.closeRate), label: "cierre" },
        ],
      },
    };
  });

  const totalRevenue = months.reduce((sum, month) => sum + Number(month.revenue), 0);
  const totalUtility = months.reduce((sum, month) => sum + Number(month.utility), 0);
  const totalSales = months.reduce((sum, month) => sum + month.salesCount, 0);
  const average = months.length > 0 ? totalRevenue / months.length : 0;

  return (
    <div className="card dash-trend">
      <div className="card-h">
        <div>
          <span className="ttl">Tendencia · últimos 12 meses</span>
          {trend && (
            <div className="dash-trend-sum">
              Ingresos <b>{money(totalRevenue)}</b> · <b>{totalSales}</b>{" "}
              {plural(totalSales, "venta", "ventas")} · utilidad <b>{money(totalUtility)}</b> ·
              promedio <b>{money(average)}</b>/mes
            </div>
          )}
        </div>
        <div className="dash-trend-ctl">
          <div className="viewtabs small" role="tablist" aria-label="Indicador de la tendencia">
            {METRICS.map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={metric === option.key}
                onClick={() => setMetric(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Link href="/reportes" className="btn ghost tiny">
            Ver reportes
          </Link>
        </div>
      </div>

      {trend === undefined ? (
        <p className="dash-state" style={{ minHeight: 204 }}>
          Cargando…
        </p>
      ) : trend === null ? (
        <p className="dash-state">No se pudo cargar la tendencia.</p>
      ) : (
        <>
          <TrendChart
            points={points}
            format={format}
            formatTick={formatTick}
            emptyText="Todavía no hay ventas registradas."
            table={{
              head: ["Mes", "Ingresos", "Ventas", "Utilidad", "Cierre"],
              rows: months.map((month) => [
                monthLabel(month.month),
                formatMoney(month.revenue),
                String(month.salesCount),
                formatMoney(month.utility),
                percent(month.closeRate),
              ]),
            }}
          />
          {metric === "closeRate" && <div className="dash-foot">{trend.caveat}</div>}
        </>
      )}
    </div>
  );
}

function metricValue(month: TrendReport["months"][number], metric: Metric): number | null {
  switch (metric) {
    case "revenue":
      return Number(month.revenue);
    case "utility":
      return Number(month.utility);
    case "sales":
      return month.salesCount;
    case "closeRate":
      return month.closeRate === null ? null : Math.round(month.closeRate * 100);
  }
}

const MONTH_NAMES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/** `2026-10` → `oct 2026`, sin pasar por `Date`: la clave ya es calendario. */
function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`;
}

function percent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)} %`;
}

/** El margen viene en porcentaje con dos decimales; `.00` sobra. */
function marginLabel(margin: number | null): string {
  return margin === null ? "—" : `${margin.toFixed(2).replace(/\.00$/, "")} %`;
}

function money(value: number): string {
  return formatMoney(String(value));
}

/** Marcas del eje: `$2K`, `$1.5K`, `$150K`, `$1.2M`. */
function compactMoney(value: number): string {
  const abs = Math.abs(value);
  const short = (amount: number) => String(Math.round(amount * 10) / 10);
  if (abs >= 1_000_000) return `$${short(value / 1_000_000)}M`;
  if (abs >= 1_000) return `$${short(value / 1_000)}K`;
  return `$${short(value)}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/* ─────────────────────── HU-DAS-07 · pendientes ───────────────────────────── */

function PendientesCard({ data }: { data: DashboardSummary | null }) {
  return (
    <div className="card">
      <div className="card-h">
        <span className="ttl">Pendientes</span>
      </div>

      {!data ? (
        <p className="dash-state">Cargando…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <PendingRow
            label="Cotizaciones sin respuesta"
            hint={`${data.pending.noAnswerBusinessDays} días hábiles desde el envío`}
            value={data.pending.quotesNoAnswer}
            href="/cotizaciones?status=sent"
            tone="orange"
          />
          <PendingRow
            label="Cotizaciones por vencer"
            hint={`Vigencia en los próximos ${data.pending.expiringSoonDays} días`}
            value={data.pending.quotesExpiringSoon}
            href="/cotizaciones"
            tone="amber"
          />
          <PendingRow
            label="Cotizaciones vencidas"
            hint="La vigencia ya pasó"
            value={data.pending.quotesOverdue}
            href="/cotizaciones?status=expired"
            tone="red"
          />
          <PendingRow
            label="Cobros atrasados"
            hint="Fecha límite de pago vencida"
            value={data.pending.salesPaymentOverdue}
            href="/ventas"
            tone="red"
          />
          <PendingRow
            label="Viajes por cerrar"
            hint="Terminaron y siguen en curso"
            value={data.pending.salesToComplete}
            href="/ventas?saleStatus=in_progress"
            tone="blue"
          />
        </div>
      )}
    </div>
  );
}

function PendingRow({
  label,
  hint,
  value,
  href,
  tone,
}: {
  label: string;
  hint: string;
  value: number;
  href: string;
  tone: "orange" | "amber" | "red" | "blue";
}) {
  const color =
    tone === "red"
      ? "var(--red)"
      : tone === "blue"
        ? "var(--blue)"
        : tone === "amber"
          ? "var(--amber)"
          : "var(--orange-deep)";

  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        border: "1px solid var(--border-soft)",
        borderRadius: 10,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--text-mute)" }}>{hint}</div>
      </div>
      <b style={{ fontSize: 20, color: value > 0 ? color : "var(--text-faint)" }}>{value}</b>
    </Link>
  );
}

/* ──────────────────── Etapas: hoy (HU-DAS-02) y período (HU-DAS-04) ───────── */

/**
 * Dónde están HOY los expedientes en juego. Es la foto del tablero Kanban.
 *
 * Lleva las mismas filas y el mismo orden que "Cuántos llegaron a cada etapa",
 * incluidas las etapas vacías: las dos tarjetas se leen una contra la otra, y
 * si cada una mostrara solo sus etapas con datos dejarían de alinearse. El
 * orden y los nombres salen del embudo (el catálogo manda); mientras carga, de
 * la lista fija del dominio.
 */
function EmbudoAbiertoCard({
  data,
  funnel,
}: {
  data: DashboardSummary | null;
  funnel: Loadable<FunnelReport>;
}) {
  const stages: { code: PipelineStageCode; name: string }[] =
    funnel?.stages.map((stage) => ({ code: stage.code, name: stage.name })) ??
    (Object.keys(PIPELINE_STAGE_LABEL) as PipelineStageCode[])
      .filter((code) => code !== "lost_discarded")
      .map((code) => ({ code, name: PIPELINE_STAGE_LABEL[code] }));

  const byCode = new Map(
    (data?.openOpportunities.byStage ?? [])
      .filter((stage) => stage.stageCode)
      .map((stage) => [stage.stageCode!, stage] as const),
  );
  const bars: BarDatum[] = stages.map(({ code, name }) => {
    const stage = byCode.get(code);
    return {
      key: code,
      label: name,
      value: stage?.count ?? 0,
      display: String(stage?.count ?? 0),
      note: stage ? `${formatMoney(stage.estimatedValue)} en valor estimado` : "Sin expedientes",
    };
  });
  // Una etapa con expedientes que no esté en la lista (no debería pasar) se
  // agrega al final antes que esconderla.
  for (const stage of byCode.values()) {
    if (!stages.some((known) => known.code === stage.stageCode)) {
      bars.push({
        key: stage.stageCode!,
        label: PIPELINE_STAGE_LABEL[stage.stageCode!] ?? stage.stageCode!,
        value: stage.count,
        display: String(stage.count),
        note: `${formatMoney(stage.estimatedValue)} en valor estimado`,
      });
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <span className="ttl">Oportunidades abiertas por etapa</span>
        <Link href="/clientes" className="btn ghost tiny">
          Ver tablero
        </Link>
      </div>
      <p className="card-hint">
        Dónde están <b>hoy</b> los expedientes en juego y cuánto valen. Es la foto del
        tablero, no el período.
      </p>
      {!data ? (
        <p className="dash-state">Cargando…</p>
      ) : (
        <BarList
          data={bars}
          emptyText="No hay expedientes en juego. Los prospectos nuevos aparecen acá en cuanto se cargan."
        />
      )}
    </div>
  );
}

/**
 * El embudo de verdad · HU-DAS-04: cuántos LLEGARON a cada etapa en el período.
 * Es acumulado, por eso el porcentaje entre pasos significa algo.
 */
function EmbudoPeriodoCard({ funnel }: { funnel: Loadable<FunnelReport> }) {
  const bars: BarDatum[] =
    funnel?.stages.map((stage, index) => {
      const previous = index > 0 ? funnel.stages[index - 1].count : null;
      const rate = previous && previous > 0 ? Math.round((stage.count / previous) * 100) : null;
      return {
        key: stage.code,
        label: stage.name,
        value: stage.count,
        display: String(stage.count),
        note: rate === null ? "Entraron en el período" : `${rate} % de la etapa anterior`,
      };
    }) ?? [];

  return (
    <div className="card">
      <div className="card-h">
        <span className="ttl">Cuántos llegaron a cada etapa</span>
        <Link href="/reportes" className="btn ghost tiny">
          Ver reportes
        </Link>
      </div>
      <p className="card-hint">
        De los expedientes que entraron en el período. Es <b>acumulado</b>: quien hoy está en
        &ldquo;Venta cerrada&rdquo; pasó por todas las anteriores.
      </p>
      <CardBody state={funnel} failed="No se pudo cargar el embudo.">
        <BarList data={bars} emptyText="No entró ningún expediente en el período." />
      </CardBody>
    </div>
  );
}

/* ─────────────────────── Ingresos por sucursal (2 oct 2026) ───────────────── */

/**
 * Ingresos por sucursal de ORIGEN del cliente. El alta de prospecto exige la
 * sucursal y cotizar la completa para los que entraron solos por Meta; acá se
 * tabula lo vendido y lo cobrado.
 */
function SucursalesCard({ data }: { data: DashboardSummary | null }) {
  return (
    <div className="card">
      <div className="card-h">
        <span className="ttl">Ingresos por sucursal</span>
        <span className="chip blue">Según el origen del cliente</span>
      </div>

      {!data ? (
        <p className="dash-state">Cargando…</p>
      ) : data.salesByBranch.length === 0 ? (
        <p className="dash-state">
          Sin ventas en el período. La tabla se arma con la sucursal de origen de cada
          cliente.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="t">
            <thead>
              <tr>
                <th>Sucursal</th>
                <th className="num">Ventas</th>
                <th className="num">Monto</th>
                <th className="num">Cobrado</th>
              </tr>
            </thead>
            <tbody>
              {data.salesByBranch.map((row) => (
                <tr key={row.branchId ?? "none"}>
                  <td style={{ fontWeight: 600 }}>
                    {row.branchName ?? (
                      <span style={{ color: "var(--text-mute)", fontWeight: 500 }}>
                        Sin sucursal · expedientes anteriores al campo
                      </span>
                    )}
                  </td>
                  <td className="num">{row.count}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {formatMoney(row.totalAmount)}
                  </td>
                  <td className="num" style={{ color: "var(--green)" }}>
                    {formatMoney(row.collectedAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ──────────────── HU-DAS-03, HU-DAS-05 y HU-DAS-06 · análisis ─────────────── */

/**
 * Utilidad, embudo y canales del período.
 *
 * Se piden por separado del resumen principal y de forma tolerante: si una de
 * las tres falla, el tablero sigue mostrando lo demás. Son datos de análisis,
 * no la operación del día: perderlos un rato no impide trabajar. Al cambiar el
 * filtro se conserva lo anterior hasta que llega lo nuevo, para que la
 * pantalla no salte.
 */
function useAnalisis(advisorId?: string) {
  const [utility, setUtility] = useState<Loadable<UtilityReport>>(undefined);
  const [funnel, setFunnel] = useState<Loadable<FunnelReport>>(undefined);
  const [channels, setChannels] = useState<Loadable<ChannelsReport>>(undefined);

  useEffect(() => {
    let vigente = true;
    const filters = advisorId ? { advisorId } : {};
    const keep =
      <T,>(set: (value: Loadable<T>) => void) =>
      (promise: Promise<T>) =>
        promise
          .then((value) => {
            if (vigente) set(value);
          })
          .catch(() => {
            if (vigente) set(null);
          });
    void keep(setUtility)(crmApi.utilityReport(filters));
    void keep(setFunnel)(crmApi.funnelReport(filters));
    void keep(setChannels)(crmApi.channelsReport(filters));
    return () => {
      vigente = false;
    };
  }, [advisorId]);

  return { utility, funnel, channels };
}

/** Cargando o fallido, en el mismo sitio que ocupará el contenido. */
function CardBody<T>({
  state,
  failed,
  children,
}: {
  state: Loadable<T>;
  failed: string;
  children: ReactNode;
}) {
  if (state === undefined) return <p className="dash-state">Cargando…</p>;
  if (state === null) return <p className="dash-state">{failed}</p>;
  return <>{children}</>;
}

/** HU-DAS-05 · de dónde vienen los que compran. El chip del canal lleva la identidad. */
function CanalVentasCard({ channels }: { channels: Loadable<ChannelsReport> }) {
  const bars: BarDatum[] =
    channels?.sales.map((row) => ({
      key: row.channel,
      label: (
        <span className={`chip ${CHANNEL_CLASS[row.channel] ?? ""}`}>
          {CHANNEL_LABEL[row.channel as Channel] ?? "Otro"}
        </span>
      ),
      value: Number(row.revenue),
      display: `${formatMoney(row.revenue)} USD`,
      note: `${row.count} ${plural(row.count, "venta", "ventas")}`,
    })) ?? [];

  return (
    <div className="card">
      <div className="card-h">
        <span className="ttl">Ventas por canal</span>
        <Link href="/reportes" className="btn ghost tiny">
          Ver reportes
        </Link>
      </div>
      <p className="card-hint">Por el canal de origen del cliente, en el período.</p>
      <CardBody state={channels} failed="No se pudieron cargar los canales.">
        <BarList data={bars} emptyText="Sin ventas en el período." />
      </CardBody>
    </div>
  );
}

/** HU-DAS-06 · por dónde se habla. Es otra pregunta que la anterior: va en su tarjeta. */
function CanalConversacionesCard({ channels }: { channels: Loadable<ChannelsReport> }) {
  const bars: BarDatum[] =
    channels?.conversations.map((row) => ({
      key: row.channel,
      label: (
        <span className={`chip ${CHANNEL_CLASS[row.channel] ?? ""}`}>
          {CHANNEL_LABEL[row.channel] ?? row.channel}
        </span>
      ),
      value: row.conversations,
      display: String(row.conversations),
      note: `${row.messages} ${plural(row.messages, "mensaje", "mensajes")}`,
    })) ?? [];

  return (
    <div className="card">
      <div className="card-h">
        <span className="ttl">Conversaciones por canal</span>
        <Link href="/bandeja" className="btn ghost tiny">
          Ver bandeja
        </Link>
      </div>
      <p className="card-hint">Conversaciones abiertas en el período y cuántos mensajes llevan.</p>
      <CardBody state={channels} failed="No se pudieron cargar los canales.">
        <BarList data={bars} emptyText="Sin conversaciones en el período." />
      </CardBody>
    </div>
  );
}

/* ──────────────── Alertas de viaje · acabado de Ventas ───────────────────── */

/**
 * Las dos llamadas que hay que hacer hoy.
 *
 * - **Sale pronto con saldo**: el viaje arranca dentro de siete días y el
 *   cliente todavía debe. Después de la salida cobrar es mucho más difícil, así
 *   que esta es la lista que hace ganar plata.
 * - **Terminó y sigue en curso**: el regreso ya pasó y la venta no se cerró. No
 *   es una deuda: es una venta que nadie terminó, y mientras siga abierta
 *   ensucia todos los indicadores del período.
 *
 * Si no hay nada que avisar, la tarjeta no aparece. Un tablero con una sección
 * que dice "todo bien" todos los días deja de mirarse.
 */
function AlertasDeViaje() {
  const [alerts, setAlerts] = useState<{
    departingWithBalance: SaleSummary[];
    endedInProgress: SaleSummary[];
  } | null>(null);

  useEffect(() => {
    crmApi.travelAlerts().then(setAlerts).catch(() => setAlerts(null));
  }, []);

  if (!alerts) return null;
  const total = alerts.departingWithBalance.length + alerts.endedInProgress.length;
  if (total === 0) return null;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ttl">Alertas de viaje</span>
        <Link href="/ventas?vista=agenda" className="btn ghost tiny">
          Agenda de cobro
        </Link>
      </div>

      <div className="report-grid">
        <div>
          <p className="card-hint">
            <b>Sale dentro de 7 días y todavía debe.</b> Después de la salida cobrar es
            mucho más difícil.
          </p>
          {alerts.departingWithBalance.length === 0 ? (
            <p className="barlist-empty">Ninguno.</p>
          ) : (
            <ul className="alert-list">
              {alerts.departingWithBalance.map((sale) => (
                <li key={sale.id}>
                  <Link href={`/ventas/${sale.id}`}>{sale.code}</Link>
                  <span>{sale.client?.name ?? "—"}</span>
                  <b>{formatMoney(sale.balanceAmount)} USD</b>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="card-hint">
            <b>El viaje terminó y la venta sigue en curso.</b> Nadie la cerró, y así
            ensucia los indicadores del período.
          </p>
          {alerts.endedInProgress.length === 0 ? (
            <p className="barlist-empty">Ninguna.</p>
          ) : (
            <ul className="alert-list">
              {alerts.endedInProgress.map((sale) => (
                <li key={sale.id}>
                  <Link href={`/ventas/${sale.id}`}>{sale.code}</Link>
                  <span>{sale.client?.name ?? "—"}</span>
                  <b>{sale.destination}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Utilidades ───────────────────────────────── */

function formatPeriod(period: { from: string; to: string }): string {
  const from = new Date(period.from);
  const to = new Date(period.to);
  const formatter = new Intl.DateTimeFormat("es-SV", { day: "2-digit", month: "short" });
  return `${formatter.format(from)} al ${formatter.format(to)}`;
}

const subtleStyle = { fontSize: 11, color: "var(--text-mute)", marginTop: 6 } as const;
