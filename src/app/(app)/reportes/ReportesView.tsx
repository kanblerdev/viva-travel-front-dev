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
  type BranchSalesReport,
  type ChannelsReport,
  type ExpectedReport,
  type FunnelReport,
  type PerformanceReport,
  type ReceivableBucket,
  type ReceivablesReport,
  type ReportFilters,
  type TeamMember,
  type TrendReport,
  type UtilityReport,
} from "@/lib/api/crm";
import { CHANNEL_LABEL, type Channel } from "@/lib/domain/enums";

type ReportKind =
  | "utilidad"
  | "desempeno"
  | "embudo"
  | "canales"
  | "esperado"
  | "cobranza"
  | "sucursales"
  | "tendencia";

/** Etiquetas de los tramos de cobranza · DV-13. */
const BUCKET_LABEL: Record<ReceivableBucket, string> = {
  current: "Por vencer",
  due_1_30: "Vencido 1–30 días",
  due_31_60: "Vencido 31–60 días",
  due_61_plus: "Vencido +60 días",
  no_due_date: "Sin fecha límite",
};

const BUCKET_TONE: Record<ReceivableBucket, string> = {
  current: "var(--green)",
  due_1_30: "var(--amber)",
  due_31_60: "var(--orange-deep)",
  due_61_plus: "var(--red)",
  no_due_date: "var(--text-mute)",
};

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
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [branchId, setBranchId] = useState("");
  const [loaded, setLoaded] = useState<
    | { kind: "utilidad"; report: UtilityReport }
    | { kind: "desempeno"; report: PerformanceReport }
    | { kind: "embudo"; report: FunnelReport }
    | { kind: "canales"; report: ChannelsReport }
    | { kind: "esperado"; report: ExpectedReport }
    | { kind: "cobranza"; report: ReceivablesReport }
    | { kind: "sucursales"; report: BranchSalesReport }
    | { kind: "tendencia"; report: TrendReport }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const filters = useMemo<ReportFilters>(
    () => ({
      from: range.from,
      to: range.to,
      ...(advisorId ? { advisorId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(kind === "utilidad" ? { groupBy } : {}),
    }),
    [range, advisorId, branchId, kind, groupBy],
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
    crmApi.branches().then(setBranches).catch(() => undefined);
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
      else if (kind === "canales")
        setLoaded({ kind, report: await crmApi.channelsReport(filters) });
      else if (kind === "esperado")
        setLoaded({ kind, report: await crmApi.expectedReport(filters) });
      else if (kind === "cobranza")
        setLoaded({ kind, report: await crmApi.receivablesReport(filters) });
      else if (kind === "sucursales")
        setLoaded({ kind, report: await crmApi.branchSalesReport(filters) });
      else setLoaded({ kind, report: await crmApi.trendReport(filters) });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo cargar el reporte.",
      );
    }
  }, [kind, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Descarga el reporte actual o el libro completo, en Excel o PDF (DV-14). */
  async function download(format: "xlsx" | "pdf", book = false) {
    const job = `${book ? "libro" : kind}-${format}`;
    setDownloading(job);
    setError(null);
    try {
      const blob = book
        ? await crmApi.downloadReportBook(filters, format)
        : await crmApi.downloadReport(kind, filters, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${book ? "reportes" : kind}-${range.from}-a-${range.to}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo generar el archivo.",
      );
    } finally {
      setDownloading(null);
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
        <div className="actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => void download("xlsx")}
            disabled={downloading !== null || loaded === null}
          >
            <Icon name="download" />
            {downloading === `${kind}-xlsx` ? "Generando…" : "Excel"}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void download("pdf")}
            disabled={downloading !== null || loaded === null}
            title="El mismo reporte, en PDF para compartir (DV-14)"
          >
            <Icon name="doc" />
            {downloading === `${kind}-pdf` ? "Generando…" : "PDF"}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void download("xlsx", true)}
            disabled={downloading !== null}
            title="Todos los reportes del período en un solo libro, una hoja por reporte"
          >
            <Icon name="folder" />
            {downloading === "libro-xlsx" ? "Generando…" : "Libro Excel"}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void download("pdf", true)}
            disabled={downloading !== null}
            title="El resumen ejecutivo completo, en PDF"
          >
            <Icon name="folder" />
            {downloading === "libro-pdf" ? "Generando…" : "Libro PDF"}
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

        {/* HU-REP-09: la sucursal de ORIGEN del cliente, en toda la reportería.
            Las conversaciones del reporte de canales no se filtran: un hilo no
            tiene sucursal. */}
        {branches.length > 0 && (
          <select
            className="selectfilter"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            aria-label="Filtrar por sucursal"
          >
            <option value="">Todas las sucursales</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
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
          {loaded.kind === "esperado" && <Esperado report={loaded.report} />}
          {loaded.kind === "cobranza" && <Cobranza report={loaded.report} />}
          {loaded.kind === "sucursales" && <Sucursales report={loaded.report} />}
          {loaded.kind === "tendencia" && <Tendencia report={loaded.report} />}
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
              <th>Variación</th>
              <th>Utilidad</th>
              <th>Margen</th>
              <th>Tasa de cierre</th>
              <th>Esperado</th>
              <th>Por cobrar</th>
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
                {/* HU-DAS-08: contra el período equivalente anterior. */}
                <td
                  className="num"
                  style={{
                    color:
                      row.revenueDeltaPercent === null
                        ? "var(--text-mute)"
                        : row.revenueDeltaPercent >= 0
                          ? "var(--green)"
                          : "var(--red)",
                    fontWeight: 600,
                  }}
                  title={`Período anterior: ${formatMoney(row.previousRevenue)}`}
                >
                  {row.revenueDeltaPercent === null
                    ? "—"
                    : `${row.revenueDeltaPercent > 0 ? "+" : ""}${row.revenueDeltaPercent} %`}
                </td>
                <td className="num">{formatMoney(row.utility)}</td>
                <td className="num">{percent(row.marginPercent)}</td>
                <td className="num">
                  {row.closeRate === null ? "—" : `${Math.round(row.closeRate * 100)} %`}
                </td>
                {/* HU-REP-10: lo que tiene en juego y en la calle, a hoy. */}
                <td className="num" title={`${row.expectedCount} cotizaciones vigentes`}>
                  {formatMoney(row.expectedAmount)}
                </td>
                <td
                  className="num"
                  style={
                    row.receivableOldestBucket &&
                    row.receivableOldestBucket !== "current"
                      ? { color: BUCKET_TONE[row.receivableOldestBucket], fontWeight: 600 }
                      : undefined
                  }
                  title={
                    row.receivableOldestBucket
                      ? `Mora más vieja: ${BUCKET_LABEL[row.receivableOldestBucket]}`
                      : undefined
                  }
                >
                  {formatMoney(row.receivableBalance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="card-hint" style={{ padding: "0 16px 14px" }}>
        La tasa de cierre es ventas creadas ÷ cotizaciones enviadas en el período
        (<b>DM-03</b>); un mes aislado puede pasar del 100 %. La variación compara
        lo vendido contra el período equivalente anterior. Esperado y por cobrar son a
        hoy, no del período; el color del saldo marca su mora más vieja.
      </p>
    </div>
  );
}

/* ─────────────── HU-REP-07 · dinero esperado por cotizaciones ─────────────── */

function Esperado({ report }: { report: ExpectedReport }) {
  const advisorBars: BarDatum[] = report.byAdvisor.map((row) => ({
    key: row.id,
    label: row.name,
    value: Number(row.amount),
    display: `${formatMoney(row.amount)} USD`,
    note: `${row.count} cotización${row.count === 1 ? "" : "es"} vigente${row.count === 1 ? "" : "s"}`,
  }));

  const branchBars: BarDatum[] = report.byBranch.map((row) => ({
    key: row.branchId ?? "sin-sucursal",
    label: row.name ?? "Sin sucursal",
    value: Number(row.amount),
    display: `${formatMoney(row.amount)} USD`,
    note: `${row.count} cotización${row.count === 1 ? "" : "es"}`,
  }));

  return (
    <>
      <div className="stats">
        <Stat
          label="Esperado"
          value={`$${formatMoney(report.totals.amount)}`}
          unit="USD a hoy"
        />
        <Stat
          label="Cotizaciones vigentes"
          value={String(report.totals.count)}
          unit="una por expediente (DV-12)"
        />
        <Stat
          label={`Vencen en ${report.expiringSoon.days} días`}
          value={`$${formatMoney(report.expiringSoon.amount)}`}
          unit={`${report.expiringSoon.count} cotizaciones`}
        />
      </div>

      <div className="report-grid" style={{ marginTop: 14 }}>
        <div className="card">
          <h2 className="card-title">Esperado por asesor</h2>
          <p className="card-hint">
            Cotizaciones <b>enviadas y vigentes</b>, a hoy; por expediente cuenta solo la
            más reciente (<b>DV-12</b>). Sin ponderar por tasa de cierre: un número
            auditable vale más que uno estimado.
          </p>
          <BarList data={advisorBars} emptyText="No hay cotizaciones vigentes." />
        </div>

        <div className="card">
          <h2 className="card-title">Esperado por sucursal</h2>
          <p className="card-hint">Según la sucursal de origen del expediente.</p>
          <BarList data={branchBars} emptyText="No hay cotizaciones vigentes." />
        </div>
      </div>
    </>
  );
}

/* ─────────────── HU-REP-08 · cuentas por cobrar con antigüedad ────────────── */

function Cobranza({ report }: { report: ReceivablesReport }) {
  return (
    <>
      <div className="stats">
        {report.buckets.map((bucket) => (
          <div className="stat" key={bucket.bucket}>
            <div className="label">{BUCKET_LABEL[bucket.bucket]}</div>
            <div className="val" style={{ color: BUCKET_TONE[bucket.bucket] }}>
              {formatMoney(bucket.balance)}
              <span className="u">USD</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-mute)" }}>
              {bucket.count} venta{bucket.count === 1 ? "" : "s"}
            </div>
          </div>
        ))}
      </div>

      <div className="report-grid" style={{ marginTop: 14 }}>
        <div className="card">
          <h2 className="card-title">Por asesor</h2>
          <p className="card-hint">
            El saldo de su cartera, a hoy. El color marca su mora más vieja.
          </p>
          <BarList
            data={report.byAdvisor.map((row) => ({
              key: row.id,
              label: row.name,
              value: Number(row.balance),
              display: `${formatMoney(row.balance)} USD`,
              note: row.oldestBucket ? BUCKET_LABEL[row.oldestBucket] : undefined,
            }))}
            emptyText="No hay saldos pendientes."
          />
        </div>
        <div className="card">
          <h2 className="card-title">Por sucursal</h2>
          <p className="card-hint">Según el origen del cliente.</p>
          <BarList
            data={report.byBranch.map((row) => ({
              key: row.branchId ?? "sin-sucursal",
              label: row.name ?? "Sin sucursal",
              value: Number(row.balance),
              display: `${formatMoney(row.balance)} USD`,
              note: `${row.count} venta${row.count === 1 ? "" : "s"}`,
            }))}
            emptyText="No hay saldos pendientes."
          />
        </div>
      </div>

      <div className="card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="t">
            <thead>
              <tr>
                <th>Venta</th>
                <th>Cliente</th>
                <th>Fecha límite</th>
                <th>Tramo</th>
                <th>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.saleId}>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {row.code}
                  </td>
                  <td>{row.clientName ?? "—"}</td>
                  <td>{row.dueDate ? previewDate(row.dueDate) : "Sin fecha"}</td>
                  <td>
                    <span style={{ color: BUCKET_TONE[row.bucket], fontWeight: 600, fontSize: 12 }}>
                      {BUCKET_LABEL[row.bucket]}
                    </span>
                  </td>
                  <td className="num">{formatMoney(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="card-hint" style={{ padding: "0 16px 14px" }}>
          De la más vencida a la más nueva, hasta 200. La antigüedad se cuenta desde la
          <b> fecha límite de pago</b> (<b>DV-13</b>): contarla desde la venta castigaría
          planes de cuotas pactados largos.
        </p>
      </div>
    </>
  );
}

/* ─────────────────── HU-REP-09 · ventas por sucursal ──────────────────────── */

function Sucursales({ report }: { report: BranchSalesReport }) {
  const bars: BarDatum[] = report.rows.map((row) => ({
    key: row.branchId ?? "sin-sucursal",
    label: row.branchName ?? "Sin sucursal",
    value: Number(row.totalAmount),
    display: `${formatMoney(row.totalAmount)} USD`,
    note: `${row.count} venta${row.count === 1 ? "" : "s"} · cobrado ${formatMoney(
      row.collectedAmount,
    )} · utilidad ${formatMoney(row.utility)}`,
  }));

  return (
    <>
      <div className="card">
        <h2 className="card-title">Ventas por sucursal</h2>
        <p className="card-hint">
          Según la sucursal de <b>origen</b> del cliente, la misma que exige el alta de
          prospecto. &ldquo;Sin sucursal&rdquo; son expedientes anteriores al campo: se
          muestran para que la tabla cuadre con el total del período.
        </p>
        <BarList data={bars} emptyText="No hubo ventas en el período." />
      </div>

      <div className="card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="t">
            <thead>
              <tr>
                <th>Sucursal</th>
                <th>Ventas</th>
                <th>Monto</th>
                <th>Cobrado</th>
                <th>Utilidad</th>
                <th>Margen</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.branchId ?? "sin-sucursal"}>
                  <td style={{ fontWeight: 600 }}>{row.branchName ?? "Sin sucursal"}</td>
                  <td className="num">{row.count}</td>
                  <td className="num">{formatMoney(row.totalAmount)}</td>
                  <td className="num">{formatMoney(row.collectedAmount)}</td>
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

/* ─────────────────── HU-REP-12 · tendencia de 12 meses ────────────────────── */

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

function Tendencia({ report }: { report: TrendReport }) {
  const bars: BarDatum[] = report.months.map((month) => {
    const [year, mm] = month.month.split("-");
    return {
      key: month.month,
      label: `${MONTH_NAMES[Number(mm) - 1] ?? mm} ${year}`,
      value: Number(month.revenue),
      display: `${formatMoney(month.revenue)} USD`,
      note: `${month.salesCount} venta${month.salesCount === 1 ? "" : "s"} · utilidad ${formatMoney(
        month.utility,
      )}${month.closeRate === null ? "" : ` · cierre ${Math.round(month.closeRate * 100)} %`}`,
    };
  });

  return (
    <div className="card">
      <h2 className="card-title">Tendencia de 12 meses</h2>
      <p className="card-hint">
        Ventas, utilidad y tasa de cierre mes a mes, hasta hoy. Mismas definiciones que
        los KPI del período. {report.caveat}
      </p>
      <BarList data={bars} emptyText="Todavía no hay ventas registradas." />
    </div>
  );
}

/** Fecha corta, en la zona del usuario, para el detalle de cobranza. */
function previewDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-SV", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
