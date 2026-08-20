"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { useSession } from "@/lib/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import { crmApi, formatMoney, type DashboardSummary } from "@/lib/api/crm";
import { PIPELINE_STAGE_LABEL } from "@/lib/domain/enums";

/**
 * Dashboard base · HU-DAS-01, HU-DAS-02 y HU-DAS-07.
 *
 * Todos los números vienen calculados del backend. La pantalla no deriva
 * ninguno: los mismos indicadores tienen que reproducirse igual en Reportes
 * (Sprint 8), y dos cálculos del mismo KPI terminan siempre discrepando.
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
