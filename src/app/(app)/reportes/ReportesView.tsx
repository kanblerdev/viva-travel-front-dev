"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { BarList, type BarDatum } from "@/components/BarList";
import { EmptyState, ErrorCard, LoadingCard } from "@/components/StateCards";
import { TabPanel, Tabs, type TabOption } from "@/components/Tabs";
import { useSession } from "@/lib/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import {
  crmApi,
  formatMoney,
  type ChannelsReport,
  type FunnelReport,
  type PerformanceReport,
  type ReportFilters,
  type TeamMember,
  type UtilityReport,
} from "@/lib/api/crm";
import { CHANNEL_LABEL, type Channel } from "@/lib/domain/enums";

type ReportKind = "utilidad" | "desempeno" | "embudo" | "canales";

const GROUP_LABEL: Record<NonNullable<ReportFilters["groupBy"]>, string> = {
  destination: "Destino",
  agency: "Agencia proveedora",
  advisor: "Asesor",
};

const CHANNEL_CLASS: Record<string, string> = {
  whatsapp: "wa",
  messenger: "ms",
  instagram: "ig",
  other: "",
};

/** El mes en curso, en la zona del usuario. Es el corte que el equipo mira. */
function currentMonth(): { from: string; to: string } {
  const now = new Date();
  const iso = (date: Date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2).replace(/\.00$/, "")} %`;
}

/**
 * Reportes comerciales · wireframe 11 · HU-REP-01 a HU-REP-06.
 *
 * Cuatro reportes sobre el mismo período y el mismo filtro de asesor, para que
 * cambiar de uno a otro no obligue a rearmar el corte.
 *
 * **El catálogo lo decide el backend.** La pantalla no sabe qué puede ver cada
 * rol: pide la lista y dibuja lo que venga. Así el Asesor no ve una pestaña de
 * desempeño que después responde 403 (HU-REP-02).
 */
export function ReportesView() {
  const { user } = useSession();
  const [range, setRange] = useState(currentMonth);
  const [advisorId, setAdvisorId] = useState("");
  const [groupBy, setGroupBy] = useState<NonNullable<ReportFilters["groupBy"]>>("destination");
  const [kind, setKind] = useState<ReportKind>("utilidad");

  const [available, setAvailable] = useState<TabOption<ReportKind>[] | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  /*
   * El reporte viaja JUNTO al tipo que lo produjo.
   *
   * Guardarlo suelto tenía un defecto real: al cambiar de pestaña, `kind` cambia
   * en el mismo instante y `data` todavía es el reporte anterior, así que el
   * render leía el de utilidad con la forma del de canales y reventaba en
   * `sales.map`. Emparejarlos hace imposible dibujar uno con la forma de otro.
   */
  const [loaded, setLoaded] = useState<
    | { kind: "utilidad"; report: UtilityReport }
    | { kind: "desempeno"; report: PerformanceReport }
    | { kind: "embudo"; report: FunnelReport }
    | { kind: "canales"; report: ChannelsReport }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const filters = useMemo<ReportFilters>(
    () => ({
      from: range.from,
      to: range.to,
      ...(advisorId ? { advisorId } : {}),
      ...(kind === "utilidad" ? { groupBy } : {}),
    }),
    [range, advisorId, kind, groupBy],
  );

  useEffect(() => {
    crmApi
      .reportCatalog()
      .then((response) =>
        setAvailable(
          response.items.map((item) => ({ id: item.kind as ReportKind, label: item.label })),
        ),
      )
      .catch(() => setAvailable([{ id: "utilidad", label: "Utilidad por comisiones" }]));
    crmApi.team().then(setTeam).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setLoaded(null);
    try {
      if (kind === "utilidad") setLoaded({ kind, report: await crmApi.utilityReport(filters) });
      else if (kind === "desempeno")
        setLoaded({ kind, report: await crmApi.performanceReport(filters) });
      else if (kind === "embudo")
        setLoaded({ kind, report: await crmApi.funnelReport(filters) });
      else setLoaded({ kind, report: await crmApi.channelsReport(filters) });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo cargar el reporte.",
      );
    }
  }, [kind, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await crmApi.downloadReport(kind, filters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${kind}-${range.from}-a-${range.to}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo generar el archivo.",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Reportes comerciales</h1>
          <div className="sub">
            Análisis del período, con corte por asesor. Los mismos números que el
            dashboard: salen del mismo cálculo.
          </div>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => void download()}
            disabled={downloading || loaded === null}
          >
            <Icon name="download" />
            {downloading ? "Generando…" : "Exportar a Excel"}
          </button>
        </div>
      </div>

      <div className="filterbar">
        {available && (
          <Tabs
            options={available}
            value={kind}
            onChange={setKind}
            label="Reporte"
            idPrefix="reportes"
          />
        )}

        <label className="sr-only" htmlFor="reportFrom">
          Desde
        </label>
        <input
          id="reportFrom"
          type="date"
          className="selectfilter"
          value={range.from}
          max={range.to}
          onChange={(event) => setRange((prev) => ({ ...prev, from: event.target.value }))}
        />
        <label className="sr-only" htmlFor="reportTo">
          Hasta
        </label>
        <input
          id="reportTo"
          type="date"
          className="selectfilter"
          value={range.to}
          min={range.from}
          onChange={(event) => setRange((prev) => ({ ...prev, to: event.target.value }))}
        />

        {/*
          El filtro de asesor no se le ofrece al Asesor: su reporte ya viene
          recortado al suyo (DM-19) y un selector que no cambia nada confunde.
        */}
        {user?.role !== "advisor" && (
          <select
            className="selectfilter"
            value={advisorId}
            onChange={(event) => setAdvisorId(event.target.value)}
            aria-label="Filtrar por asesor"
          >
            <option value="">Toda la agencia</option>
            {team.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
              </option>
            ))}
          </select>
        )}

        {kind === "utilidad" && (
          <select
            className="selectfilter"
            value={groupBy}
            onChange={(event) =>
              setGroupBy(event.target.value as NonNullable<ReportFilters["groupBy"]>)
            }
            aria-label="Agrupar por"
          >
            {Object.entries(GROUP_LABEL).map(([value, text]) => (
              <option key={value} value={value}>
                Por {text.toLowerCase()}
              </option>
            ))}
          </select>
        )}
      </div>

      {error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : loaded === null || loaded.kind !== kind ? (
        <LoadingCard>Calculando el reporte…</LoadingCard>
      ) : (
        <TabPanel id={kind} idPrefix="reportes">
          {loaded.kind === "utilidad" && <Utilidad report={loaded.report} />}
          {loaded.kind === "desempeno" && <Desempeno report={loaded.report} />}
          {loaded.kind === "embudo" && <Embudo report={loaded.report} />}
          {loaded.kind === "canales" && <Canales report={loaded.report} />}
        </TabPanel>
      )}
    </>
  );
}

/* ───────────────────── HU-REP-01 · utilidad por comisiones ────────────────── */

function Utilidad({ report }: { report: UtilityReport }) {
  const bars: BarDatum[] = report.breakdown.map((row) => ({
    key: row.key ?? row.label,
    label: row.label,
    value: Number(row.utility),
    display: `${formatMoney(row.utility)} USD`,
    note: `${row.salesCount} venta${row.salesCount === 1 ? "" : "s"} · ${formatMoney(
      row.revenue,
    )} vendidos · margen ${percent(row.marginPercent)}`,
  }));

  return (
    <>
      {/*
        Cuatro cifras de titular, no un gráfico de cuatro barras: son magnitudes
        de escalas distintas y lo que hay que leer es el número, no compararlos
        entre sí.
      */}
      <div className="stats">
        <Stat label="Vendido" value={`$${formatMoney(report.totals.revenue)}`} unit="USD" />
        <Stat label="Utilidad" value={`$${formatMoney(report.totals.utility)}`} unit="USD" />
        <Stat label="Margen" value={percent(report.totals.marginPercent)} unit="sobre lo vendido" />
        <Stat
          label="Ventas"
          value={String(report.totals.salesCount)}
          unit="sin contar canceladas"
        />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 className="card-title">Utilidad por {GROUP_LABEL[report.groupBy].toLowerCase()}</h2>
        <p className="card-hint">
          Comisión de gestión más comisión de agencia. El margen es sobre el precio de
          venta: <b>DM-08</b> resolvió que el costo del proveedor no se registra.
        </p>
        <BarList data={bars} emptyText="No hubo ventas en este período." />
      </div>

      <div className="card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="t">
            <thead>
              <tr>
                <th>{GROUP_LABEL[report.groupBy]}</th>
                <th>Ventas</th>
                <th>Vendido</th>
                <th>Utilidad</th>
                <th>Margen</th>
              </tr>
            </thead>
            <tbody>
              {report.breakdown.map((row) => (
                <tr key={row.key ?? row.label}>
                  <td>{row.label}</td>
                  <td className="num">{row.salesCount}</td>
                  <td className="num">{formatMoney(row.revenue)}</td>
                  <td className="num">{formatMoney(row.utility)}</td>
                  <td className="num">{percent(row.marginPercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ────────────────────── HU-REP-02 · desempeño por asesor ──────────────────── */

function Desempeno({ report }: { report: PerformanceReport }) {
  if (report.rows.length === 0) {
    return <EmptyState icon="users" title="No hay nadie en el equipo todavía" />;
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead>
            <tr>
              <th>Asesor</th>
              <th>Cotizaciones</th>
              <th>Ventas</th>
              <th>Vendido</th>
              <th>Utilidad</th>
              <th>Margen</th>
              <th>Tasa de cierre</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.advisor.id}>
                <td>
                  {row.advisor.fullName}
                  {row.advisor.status !== "active" && (
                    <span className="chip" style={{ marginLeft: 6 }}>
                      Inactivo
                    </span>
                  )}
                </td>
                <td className="num">{row.quotesSent}</td>
                <td className="num">{row.salesCount}</td>
                <td className="num">{formatMoney(row.revenue)}</td>
                <td className="num">{formatMoney(row.utility)}</td>
                <td className="num">{percent(row.marginPercent)}</td>
                <td className="num">
                  {row.closeRate === null ? "—" : `${Math.round(row.closeRate * 100)} %`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="card-hint" style={{ padding: "0 16px 14px" }}>
        La tasa de cierre es ventas creadas ÷ cotizaciones enviadas en el período
        (<b>DM-03</b>). Una venta puede nacer de una cotización enviada antes, así que un
        mes aislado puede pasar del 100 %.
      </p>
    </div>
  );
}

/* ───────────────────── HU-REP-03 · embudo de conversión ───────────────────── */

function Embudo({ report }: { report: FunnelReport }) {
  /*
   * El orden lo carga la POSICIÓN, no el color: las filas van en el orden del
   * tablero. La nota de cada paso es la conversión respecto del anterior, que
   * ahora significa algo porque la serie es acumulada: cuántos LLEGARON a la
   * etapa, no cuántos están parados en ella.
   */
  const bars: BarDatum[] = report.stages.map((stage, index) => {
    const previous = index > 0 ? report.stages[index - 1].count : null;
    const rate = previous && previous > 0 ? Math.round((stage.count / previous) * 100) : null;
    const parts = [
      rate === null ? null : `${rate} % de los que llegaron a la etapa anterior`,
      stage.current > 0 ? `${stage.current} ahí ahora` : null,
    ].filter(Boolean);
    return {
      key: stage.code,
      label: stage.name,
      value: stage.count,
      display: String(stage.count),
      note: parts.length > 0 ? parts.join(" · ") : undefined,
    };
  });

  const lost: BarDatum[] = report.lostReasons.map((reason) => ({
    key: reason.id ?? "sin-motivo",
    label: reason.name,
    value: reason.count,
    display: String(reason.count),
  }));

  return (
    <div className="report-grid">
      <div className="card">
        <h2 className="card-title">Cuántos llegaron a cada etapa</h2>
        <p className="card-hint">
          De los expedientes que entraron en el período. Es <b>acumulado</b>: quien hoy
          está en &ldquo;Venta cerrada&rdquo; pasó por todas las anteriores. Por eso el
          porcentaje entre pasos dice algo.
        </p>
        <BarList data={bars} emptyText="No entró ningún expediente en el período." />
      </div>

      <div className="card">
        <h2 className="card-title">Por qué se pierden</h2>
        <p className="card-hint">
          {report.lost} expediente{report.lost === 1 ? "" : "s"} descartado
          {report.lost === 1 ? "" : "s"} en el período. La fuga no es un escalón del
          embudo: se sale de él. Agrupado por el motivo del catálogo, no por el texto de
          la nota, para que se pueda sumar (<b>B7</b>).
        </p>
        <BarList data={lost} emptyText="No se descartó ningún expediente en el período." />
      </div>
    </div>
  );
}

/* ─────────── HU-REP-04 y HU-REP-05 · ventas y conversaciones por canal ────── */

function Canales({ report }: { report: ChannelsReport }) {
  /*
   * El chip del canal va en la etiqueta y no en el color de la barra: el CRM ya
   * le dio un color a cada canal, y repetirlo en la barra gastaría el canal de
   * color en algo que el chip ya dice.
   */
  const chip = (channel: string) => (
    <>
      <span className={`chip ${CHANNEL_CLASS[channel] ?? ""}`}>
        {CHANNEL_LABEL[channel as Channel] ?? "Otro"}
      </span>
    </>
  );

  const sales: BarDatum[] = report.sales.map((row) => ({
    key: row.channel,
    label: chip(row.channel),
    value: Number(row.revenue),
    display: `${formatMoney(row.revenue)} USD`,
    note: `${row.count} venta${row.count === 1 ? "" : "s"}`,
  }));

  const conversations: BarDatum[] = report.conversations.map((row) => ({
    key: row.channel,
    label: chip(row.channel),
    value: row.conversations,
    display: String(row.conversations),
    note: `${row.messages} mensaje${row.messages === 1 ? "" : "s"} en el período`,
  }));

  return (
    <div className="report-grid">
      <div className="card">
        <h2 className="card-title">Ventas por canal de origen</h2>
        <p className="card-hint">
          El canal es el del expediente que originó la venta: la venta no guarda canal
          propio.
        </p>
        <BarList data={sales} emptyText="No hubo ventas en el período." />
      </div>

      <div className="card">
        <h2 className="card-title">Conversaciones por canal</h2>
        <p className="card-hint">Hilos con actividad en el período, y cuánto se habló.</p>
        <BarList
          data={conversations}
          emptyText="No hubo conversaciones en el período."
        />
      </div>
    </div>
  );
}

/* ──────────────────────────────── Cifra suelta ────────────────────────────── */

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="val">
        {value} <span className="u">{unit}</span>
      </div>
    </div>
  );
}
