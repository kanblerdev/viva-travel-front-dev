"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { BarList, type BarDatum } from "@/components/BarList";
import { useSession } from "@/lib/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import {
  crmApi,
  formatMoney,
  type ChannelsReport,
  type DashboardSummary,
  type FunnelReport,
  type UtilityReport,
} from "@/lib/api/crm";
import { CHANNEL_LABEL, PIPELINE_STAGE_LABEL, type Channel } from "@/lib/domain/enums";

const CHANNEL_CLASS: Record<string, string> = {
  whatsapp: "wa",
  messenger: "ms",
  instagram: "ig",
  other: "",
};

/**
 * Dashboard · HU-DAS-01 a HU-DAS-07.
 *
 * Todos los números vienen calculados del backend. La pantalla no deriva
 * ninguno: los mismos indicadores se reproducen igual en Reportes, porque
 * salen de los mismos endpoints. Dos cálculos del mismo KPI terminan siempre
 * discrepando, y que el tablero y el reporte no coincidan por el mismo período
 * es peor que no tener el tablero.
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

      <div className="stats">
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
            {data ? `${data.sales.count} operaciones · ticket ${formatMoney(data.sales.averageTicket)}` : "Cargando…"}
          </div>
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

        <div className="stat">
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
              ? `${data.closeRate.salesCreated} ventas ÷ ${data.closeRate.quotesSent} cotizaciones enviadas`
              : "Cargando…"}
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
            {data ? `${data.pending.salesWithBalance} ventas con saldo` : "Cargando…"}
          </div>
        </div>
      </div>

      <div className="row-split" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-h">
            <span className="ttl">Embudo · oportunidades abiertas</span>
            <Link href="/clientes" className="btn ghost tiny">
              Ver tablero
            </Link>
          </div>

          {!data ? (
            <div style={{ fontSize: 13, color: "var(--text-mute)" }}>Cargando…</div>
          ) : data.openOpportunities.count === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-mute)", lineHeight: 1.7 }}>
              No hay expedientes en juego. Los prospectos nuevos aparecen acá en cuanto se
              cargan.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.openOpportunities.byStage
                .filter((stage) => stage.stageCode)
                .sort((a, b) => b.count - a.count)
                .map((stage) => (
                  <div key={stage.stageCode}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 12,
                        marginBottom: 4,
                      }}
                    >
                      <span>{PIPELINE_STAGE_LABEL[stage.stageCode!]}</span>
                      <span className="num">
                        <b>{stage.count}</b>
                        <span style={{ color: "var(--text-mute)", marginLeft: 8 }}>
                          {formatMoney(stage.estimatedValue)}
                        </span>
                      </span>
                    </div>
                    <div
                      style={{
                        background: "var(--border-soft)",
                        height: 6,
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          background: "var(--orange)",
                          height: "100%",
                          width: `${percentageOfMax(stage.count, data.openOpportunities.byStage)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}

          {data && (
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 14, lineHeight: 1.6 }}>
              {data.closeRate.caveat}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-h">
            <span className="ttl">Pendientes</span>
          </div>

          {!data ? (
            <div style={{ fontSize: 13, color: "var(--text-mute)" }}>Cargando…</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <PendingRow
                label={`Cotizaciones sin respuesta`}
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
      </div>

      {/*
        HU-DAS-03 a HU-DAS-06 · lo que el Sprint 8 agrega al tablero.

        Sale de los MISMOS endpoints que Reportes, no de un cálculo propio: que
        el tablero y el reporte discrepen por el mismo período es peor que no
        tener el tablero. Acá va el resumen; el corte por fecha y la exportación
        viven en Reportes, que es adonde lleva el enlace.
      */}
      <AnalisisDelPeriodo advisorId={advisorId} />
    </>
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

/** Ancho relativo a la etapa más poblada: el embudo se lee por comparación. */
function percentageOfMax(count: number, stages: { count: number }[]): number {
  const max = Math.max(...stages.map((stage) => stage.count), 1);
  return Math.round((count / max) * 100);
}

function formatPeriod(period: { from: string; to: string }): string {
  const from = new Date(period.from);
  const to = new Date(period.to);
  const formatter = new Intl.DateTimeFormat("es-SV", { day: "2-digit", month: "short" });
  return `${formatter.format(from)} al ${formatter.format(to)}`;
}

const subtleStyle = { fontSize: 11, color: "var(--text-mute)", marginTop: 6 } as const;

/* ──────────────────── HU-DAS-03 a HU-DAS-06 · análisis ───────────────────── */

/**
 * Utilidad, embudo y canales del período.
 *
 * Se piden por separado del resumen principal y de forma tolerante: si una de
 * las tres falla, el tablero sigue mostrando lo demás. Son datos de análisis, no
 * la operación del día: perderlos un rato no impide trabajar.
 */
function AnalisisDelPeriodo({ advisorId }: { advisorId?: string }) {
  const [utility, setUtility] = useState<UtilityReport | null>(null);
  const [funnel, setFunnel] = useState<FunnelReport | null>(null);
  const [channels, setChannels] = useState<ChannelsReport | null>(null);

  useEffect(() => {
    const filters = advisorId ? { advisorId } : {};
    crmApi.utilityReport(filters).then(setUtility).catch(() => setUtility(null));
    crmApi.funnelReport(filters).then(setFunnel).catch(() => setFunnel(null));
    crmApi.channelsReport(filters).then(setChannels).catch(() => setChannels(null));
  }, [advisorId]);

  const funnelBars: BarDatum[] =
    funnel?.stages.map((stage, index) => {
      const previous = index > 0 ? funnel.stages[index - 1].count : null;
      const rate = previous && previous > 0 ? Math.round((stage.count / previous) * 100) : null;
      return {
        key: stage.code,
        label: stage.name,
        value: stage.count,
        display: String(stage.count),
        note: rate === null ? undefined : `${rate} % de la etapa anterior`,
      };
    }) ?? [];

  const salesBars: BarDatum[] =
    channels?.sales.map((row) => ({
      key: row.channel,
      label: (
        <span className={`chip ${CHANNEL_CLASS[row.channel] ?? ""}`}>
          {CHANNEL_LABEL[row.channel as Channel] ?? "Otro"}
        </span>
      ),
      value: Number(row.revenue),
      display: `${formatMoney(row.revenue)} USD`,
      note: `${row.count} venta${row.count === 1 ? "" : "s"}`,
    })) ?? [];

  const conversationBars: BarDatum[] =
    channels?.conversations.map((row) => ({
      key: row.channel,
      label: (
        <span className={`chip ${CHANNEL_CLASS[row.channel] ?? ""}`}>
          {CHANNEL_LABEL[row.channel] ?? row.channel}
        </span>
      ),
      value: row.conversations,
      display: String(row.conversations),
      note: `${row.messages} mensaje${row.messages === 1 ? "" : "s"}`,
    })) ?? [];

  return (
    <>
      {/* HU-DAS-03 · lo que dejó el período. Tres cifras, no un gráfico: son
          magnitudes distintas y lo que se lee es el número. */}
      {utility && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <span className="ttl">Utilidad del período</span>
            <Link href="/reportes" className="btn ghost tiny">
              Ver reportes
            </Link>
          </div>
          <div className="dash-money">
            <div>
              <span className="k">Comisión de gestión</span>
              <span className="v">{formatMoney(utility.totals.managementCommission)}</span>
            </div>
            <div>
              <span className="k">Comisión de agencia</span>
              <span className="v">{formatMoney(utility.totals.agencyCommission)}</span>
            </div>
            <div>
              <span className="k">Utilidad total</span>
              <span className="v">{formatMoney(utility.totals.utility)}</span>
            </div>
            <div>
              <span className="k">Margen</span>
              <span className="v">
                {utility.totals.marginPercent === null
                  ? "—"
                  : `${utility.totals.marginPercent.toFixed(2).replace(/\.00$/, "")} %`}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="report-grid" style={{ marginTop: 14 }}>
        {/* HU-DAS-04 · el embudo de verdad: cuántos LLEGARON a cada etapa. */}
        {funnel && (
          <div className="card">
            <div className="card-h">
              <span className="ttl">Cuántos llegaron a cada etapa</span>
            </div>
            <BarList data={funnelBars} emptyText="No entró ningún expediente este mes." />
          </div>
        )}

        {/* HU-DAS-05 y HU-DAS-06 · de dónde vienen los que compran y por dónde
            se habla. Dos listas y no un gráfico apilado: son dos preguntas. */}
        {channels && (
          <div className="card">
            <div className="card-h">
              <span className="ttl">Por canal</span>
            </div>
            <div className="dash-channels">
              <div>
                <p className="card-hint">Ventas por canal de origen</p>
                <BarList data={salesBars} emptyText="Sin ventas este mes." />
              </div>
              <div>
                <p className="card-hint">Conversaciones por canal</p>
                <BarList data={conversationBars} emptyText="Sin conversaciones este mes." />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
