"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icon";
import { EmptyState, ErrorCard, LoadingCard } from "@/components/StateCards";
import { TabPanel, Tabs, type TabOption } from "@/components/Tabs";
import { ApiError } from "@/lib/api/client";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import {
  crmApi,
  formatAmount,
  formatMoney,
  paidPercentage,
  type SaleFilters,
  type SaleSummary,
  type SalesSummary,
  type TeamMember,
} from "@/lib/api/crm";
import {
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUSES,
  SALE_STATUS_LABEL,
  SALE_STATUSES,
  type PaymentStatus,
  type SaleStatus,
} from "@/lib/domain/enums";
import { NuevaVentaModal } from "./modals";
import { AgendaCobro } from "./AgendaCobro";

export const SALE_STATUS_CHIP: Record<SaleStatus, string> = {
  reserved: "amber",
  paid: "blue",
  in_progress: "purple",
  completed: "green",
  canceled: "red",
};

const PAGE_SIZE = 50;

type SaleSortField = NonNullable<SaleFilters["sortBy"]>;
const SORTABLE: SaleSortField[] = ["code", "price", "balance", "tripStart", "created"];

/** Lo que puede viajar en la URL. La página no: se reinicia al filtrar. */
type UrlFilters = Omit<SaleFilters, "page" | "pageSize">;

/**
 * Dos lentes sobre el mismo dato · agenda de cobro.
 *
 * El listado responde "cuánto falta cobrar"; la agenda, "a quién llamo hoy".
 * Van en la misma pantalla y no en rutas distintas por lo mismo que el Kanban
 * vive dentro de Clientes: son la misma cartera vista de dos maneras, y separarlas
 * duplicaría los filtros.
 */
type View = "listado" | "agenda";

/** Las dos vistas de Ventas: el listado y la agenda de cobro. */
const VIEW_TABS: readonly TabOption<View>[] = [
  { id: "listado", label: "Listado", icon: "doc" },
  { id: "agenda", label: "Agenda de cobro", icon: "phone" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-SV", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Los filtros se leen de la URL · hallazgos `A2` y `H2`.
 *
 * La URL es la fuente de verdad del listado. Antes el estado arrancaba siempre
 * vacío, así que el acceso del Dashboard a `/ventas?saleStatus=in_progress`
 * aterrizaba en la lista completa y "Cobros atrasados" ni siquiera tenía a dónde
 * apuntar. Es el mismo patrón que el 5C dejó en Cotizaciones.
 */
function readFilters(params: URLSearchParams): UrlFilters {
  const filters: UrlFilters = {};
  const saleStatus = params.get("saleStatus");
  const paymentStatus = params.get("paymentStatus");

  if (params.get("search")) filters.search = params.get("search") ?? undefined;
  if (saleStatus && (SALE_STATUSES as readonly string[]).includes(saleStatus)) {
    filters.saleStatus = saleStatus as SaleStatus;
  }
  if (paymentStatus && (PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)) {
    filters.paymentStatus = paymentStatus as PaymentStatus;
  }
  if (params.get("advisorId")) filters.advisorId = params.get("advisorId") ?? undefined;
  if (params.get("clientId")) filters.clientId = params.get("clientId") ?? undefined;
  if (params.get("from")) filters.from = params.get("from") ?? undefined;
  if (params.get("to")) filters.to = params.get("to") ?? undefined;
  if (params.get("overdue") === "true") filters.overdue = true;
  if (params.get("hasBalance") === "true") filters.hasBalance = true;

  const sortBy = params.get("sortBy") as SaleSortField | null;
  if (sortBy && SORTABLE.includes(sortBy)) {
    filters.sortBy = sortBy;
    filters.sortDir = params.get("sortDir") === "asc" ? "asc" : "desc";
  }

  return filters;
}

function toSearchParams(filters: UrlFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

/**
 * Listado de ventas con seguimiento de cobros · wireframe 09.
 *
 * La columna de cobro es el centro de la pantalla: lo que el equipo revisa acá
 * no es cuánto se vendió, sino cuánto falta cobrar y a quién hay que llamar.
 */
export function VentasView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlKey = params.toString();
  const filters = useMemo(() => readFilters(new URLSearchParams(urlKey)), [urlKey]);

  // La búsqueda vive aparte de los selectores: se escribe letra por letra y
  // necesita retraso, mientras que elegir una opción es una decisión terminada.
  const [search, setSearch] = useState(filters.search ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);

  const [sales, setSales] = useState<SaleSummary[] | null>(null);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const view: View = params.get("vista") === "agenda" ? "agenda" : "listado";
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Testigo de la petición en curso · hallazgo `D1`.
   *
   * Sin esto gana la respuesta que llega última, que no es la de la consulta más
   * nueva: una respuesta lenta de "can" pisaba los resultados de "cancún" y la
   * tabla dejaba de corresponder con lo escrito.
   */
  const requestId = useRef(0);

  /** El término escrito manda sobre el de la URL mientras se está escribiendo. */
  const query = useMemo<SaleFilters>(() => {
    const next: SaleFilters = { ...filters, page, pageSize: PAGE_SIZE };
    const term = debouncedSearch.trim();
    if (term) next.search = term;
    else delete next.search;

    // La agenda es una lista para llamar: solo lo que se puede cobrar, y en el
    // orden en que vence. No es un filtro que el usuario puso, así que no vive
    // en la URL — se impone mientras la vista esté activa.
    if (view === "agenda") {
      next.hasBalance = true;
      next.sortBy = "dueDate";
      next.sortDir = "asc";
      next.pageSize = 200;
    }
    return next;
  }, [filters, debouncedSearch, page, view]);

  const queryKey = JSON.stringify(query);

  const load = useCallback(async () => {
    const parsed = JSON.parse(queryKey) as SaleFilters;
    const ticket = ++requestId.current;

    setLoading(true);
    setError(null);

    try {
      // El resumen usa los mismos filtros: el encabezado y las filas no pueden
      // contar universos distintos. La página sí se descarta, porque el KPI
      // habla de toda la selección y no de la tanda que se está viendo.
      const { page: _page, pageSize: _pageSize, ...forSummary } = parsed;
      const [result, kpis] = await Promise.all([
        crmApi.listSales(parsed),
        crmApi.salesSummary(forSummary),
      ]);

      if (ticket !== requestId.current) return;
      setSales(result.items);
      setTotal(result.total);
      setSummary(kpis);
    } catch (caught) {
      if (ticket !== requestId.current) return;
      setError(
        caught instanceof ApiError ? caught.message : "No se pudieron cargar las ventas.",
      );
      setSales([]);
    } finally {
      if (ticket === requestId.current) setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    crmApi.team().then(setTeam).catch(() => undefined);
  }, []);

  // Cambiar cualquier filtro devuelve a la primera tanda: quedarse en la página
  // 4 de un universo que ahora tiene 2 muestra una tabla vacía sin motivo.
  useEffect(() => {
    setPage(1);
  }, [urlKey, debouncedSearch]);

  /**
   * Escribe el filtro en la URL; el estado se deriva de ahí.
   *
   * `vista` se conserva aparte: NO es un filtro —no viaja al backend— pero sí
   * tiene que sobrevivir a cualquier cambio de filtro. Sin esto, elegir un
   * asesor con la agenda abierta te devolvía al listado.
   */
  const applyFilters = useCallback(
    (next: UrlFilters, nextView: View = view) => {
      const qs = toSearchParams(next);
      const params = new URLSearchParams(qs);
      if (nextView === "agenda") params.set("vista", "agenda");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, view],
  );

  function setFilter<K extends keyof UrlFilters>(key: K, value: UrlFilters[K]) {
    const next = { ...filters };
    if (value === "" || value === undefined || value === false) delete next[key];
    else next[key] = value;
    applyFilters(next);
  }

  /** Ascendente → descendente → sin orden, como en Cotizaciones. */
  function toggleSort(field: SaleSortField) {
    const next = { ...filters };
    if (filters.sortBy !== field) {
      next.sortBy = field;
      next.sortDir = "asc";
    } else if (filters.sortDir === "asc") {
      next.sortDir = "desc";
    } else {
      delete next.sortBy;
      delete next.sortDir;
    }
    applyFilters(next);
  }

  function clearFilters() {
    setSearch("");
    applyFilters({}, view);
  }

  const hasFilters = Object.keys(filters).length > 0 || search.trim() !== "";
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  // `A3` · el resumen deja fuera las canceladas y el listado no. Decir "15
  // ventas" arriba y "14 operaciones" al lado obligaba a adivinar cuál era cuál.
  const canceled = summary?.byStatus.canceled ?? 0;

  return (
    <>
      <div className="stats five" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="label">
            Vendido
            <div className="ico orange">
              <Icon name="cart" width={14} height={14} />
            </div>
          </div>
          <div className="val">
            {summary ? formatMoney(summary.totalAmount) : "—"}
            <span className="u">USD</span>
          </div>
          <div style={subtleStyle}>
            {summary
              ? canceled > 0
                ? `${summary.count} vigentes · ${canceled} ${
                    canceled === 1 ? "cancelada" : "canceladas"
                  }`
                : `${summary.count} operaciones`
              : "Cargando…"}
          </div>
        </div>

        <div className="stat">
          <div className="label">
            Cobrado
            <div className="ico green">
              <Icon name="check" width={14} height={14} />
            </div>
          </div>
          <div className="val">
            {summary ? formatMoney(summary.paidAmount) : "—"}
            <span className="u">USD</span>
          </div>
          <div style={subtleStyle}>Abonos vigentes</div>
        </div>

        {/* Las dos tarjetas de cobro filtran al pulsarlas: un número que no
            lleva a la lista que lo produce obliga a rearmar el filtro a mano. */}
        <button
          type="button"
          className="stat as-filter"
          aria-pressed={Boolean(filters.hasBalance)}
          onClick={() => setFilter("hasBalance", !filters.hasBalance)}
        >
          <div className="label">
            Por cobrar
            <div className="ico blue">
              <Icon name="tag" width={14} height={14} />
            </div>
          </div>
          <div className="val" style={{ color: "var(--orange-deep)" }}>
            {summary ? formatMoney(summary.balanceAmount) : "—"}
            <span className="u">USD</span>
          </div>
          <div style={subtleStyle}>
            {filters.hasBalance ? "Filtrando · quitar" : "Saldo pendiente"}
          </div>
        </button>

        <button
          type="button"
          className="stat as-filter"
          aria-pressed={Boolean(filters.overdue)}
          onClick={() => setFilter("overdue", !filters.overdue)}
        >
          <div className="label">
            Atrasadas
            <div className="ico red">
              <Icon name="target" width={14} height={14} />
            </div>
          </div>
          <div className="val" style={{ color: "var(--red)" }}>
            {summary ? summary.overdueCount : "—"}
            <span className="u">con plazo vencido</span>
          </div>
          <div style={subtleStyle}>
            {filters.overdue ? "Filtrando · quitar" : "A quién llamar hoy"}
          </div>
        </button>

        <div className="stat">
          <div className="label">
            Ticket promedio
            <div className="ico purple">
              <Icon name="users" width={14} height={14} />
            </div>
          </div>
          <div className="val">
            {summary ? formatMoney(summary.averageTicket) : "—"}
            <span className="u">USD</span>
          </div>
          <div style={subtleStyle}>Sin contar canceladas</div>
        </div>
      </div>

      {notice && (
        <div className="auth-alert info" style={{ marginBottom: 14 }} role="status">
          <Icon name="check" />
          <div>{notice}</div>
        </div>
      )}

      <div className="filterbar">
        <Tabs
          options={VIEW_TABS}
          value={view}
          onChange={(next) => applyFilters(filters, next)}
          label="Vista de ventas"
          idPrefix="ventas"
          style={{ marginRight: 4 }}
        />

        <input
          className="selectfilter"
          style={{ minWidth: 230 }}
          placeholder="Código, cliente, destino, factura o recibo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar venta"
        />

        <select
          className="selectfilter"
          value={filters.saleStatus ?? ""}
          onChange={(e) => setFilter("saleStatus", (e.target.value || undefined) as SaleStatus)}
          aria-label="Filtrar por estado"
        >
          <option value="">Estado</option>
          {SALE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {SALE_STATUS_LABEL[status]}
            </option>
          ))}
        </select>

        <select
          className="selectfilter"
          value={filters.paymentStatus ?? ""}
          onChange={(e) =>
            setFilter("paymentStatus", (e.target.value || undefined) as PaymentStatus)
          }
          aria-label="Filtrar por cobro"
        >
          <option value="">Cobro</option>
          {PAYMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PAYMENT_STATUS_LABEL[status]}
            </option>
          ))}
        </select>

        <select
          className="selectfilter"
          value={filters.advisorId ?? ""}
          onChange={(e) => setFilter("advisorId", e.target.value || undefined)}
          aria-label="Filtrar por asesor"
        >
          <option value="">Asesor</option>
          {team.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </select>

        <input
          type="date"
          className="selectfilter"
          value={filters.from ?? ""}
          onChange={(e) => setFilter("from", e.target.value || undefined)}
          aria-label="Registradas desde"
          title="Registradas desde"
        />
        <input
          type="date"
          className="selectfilter"
          value={filters.to ?? ""}
          onChange={(e) => setFilter("to", e.target.value || undefined)}
          aria-label="Registradas hasta"
          title="Registradas hasta"
        />

        {hasFilters && (
          <button type="button" className="selectfilter" onClick={clearFilters}>
            Limpiar filtros
            <Icon name="x" />
          </button>
        )}

        <span className="count">
          {loading && sales === null ? "Cargando…" : `${total} ventas`}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" />
          Registrar venta
        </button>
      </div>

      {error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : sales === null ? (
        <LoadingCard>Cargando ventas…</LoadingCard>
      ) : sales.length === 0 ? (
        <EmptyState
          icon="cart"
          title={hasFilters ? "Sin coincidencias" : "Todavía no hay ventas"}
          hint={
            hasFilters
              ? "Ajustá o limpiá los filtros para ver todas."
              : "Una venta nace al aceptar una cotización, o se registra directo desde acá."
          }
          action={
            hasFilters ? (
              <button type="button" className="btn ghost" onClick={clearFilters}>
                Limpiar filtros
              </button>
            ) : (
              <Link href="/cotizaciones" className="btn ghost">
                <Icon name="doc" />
                Ver cotizaciones
              </Link>
            )
          }
        />
      ) : view === "agenda" ? (
        <TabPanel id="agenda" idPrefix="ventas">
          <AgendaCobro sales={sales} onLogged={() => void load()} />
        </TabPanel>
      ) : (
        <TabPanel id="listado" idPrefix="ventas" className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="t cards">
              <thead>
                <tr>
                  <SortableTh field="code" label="Código" sort={filters} onToggle={toggleSort} />
                  <th>Cliente</th>
                  <th>Destino</th>
                  <SortableTh field="price" label="Total" sort={filters} onToggle={toggleSort} />
                  <SortableTh
                    field="balance"
                    label="Cobro"
                    sort={filters}
                    onToggle={toggleSort}
                  />
                  <th>Asesor</th>
                  <th>Estado</th>
                  <SortableTh
                    field="created"
                    label="Fecha"
                    sort={filters}
                    onToggle={toggleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td data-label="Código">
                      <Link
                        href={`/ventas/${sale.id}`}
                        className="mono"
                        style={{ fontSize: 12, color: "var(--navy)", fontWeight: 600 }}
                      >
                        {sale.code}
                      </Link>
                    </td>
                    <td data-label="Cliente">
                      {sale.client ? (
                        <Link
                          href={`/clientes/${sale.client.id}`}
                          style={{ color: "inherit", textDecoration: "none", fontWeight: 600 }}
                        >
                          {sale.client.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label="Destino">{sale.destination}</td>
                    <td data-label="Total">
                      <b className="num">{formatMoney(sale.finalPrice)}</b>
                    </td>
                    <td data-label="Cobro" style={{ minWidth: 170 }}>
                      <PaymentProgress sale={sale} />
                    </td>
                    <td data-label="Asesor">{sale.advisor?.name ?? "—"}</td>
                    <td data-label="Estado">
                      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span className={`chip ${SALE_STATUS_CHIP[sale.saleStatus]}`}>
                          {SALE_STATUS_LABEL[sale.saleStatus]}
                        </span>
                        {sale.isPaymentOverdue && (
                          <span className="chip red" title="La fecha límite de pago ya pasó">
                            Cobro atrasado
                          </span>
                        )}
                      </span>
                    </td>
                    <td data-label="Fecha">
                      <span className="num" style={{ fontSize: 12, color: "var(--text-mute)" }}>
                        {formatDate(sale.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabPanel>
      )}

      {/* Paginación real · hallazgo `A1`: antes se pedían 200 de una sola vez y
          la fila 201 no existía para nadie, aunque el contador la anunciara. */}
      {view === "listado" && sales !== null && sales.length > 0 && pageCount > 1 && (
        <div className="pager">
          <span className="pager-range">
            {firstRow}–{lastRow} de <b>{total}</b>
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="btn ghost tiny"
            disabled={loading || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Anterior
          </button>
          <span className="pager-page">
            Página {page} de {pageCount}
          </span>
          <button
            type="button"
            className="btn ghost tiny"
            disabled={loading || page >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          >
            Siguiente
          </button>
        </div>
      )}

      {creating && (
        <NuevaVentaModal
          team={team}
          onClose={() => setCreating(false)}
          onCreated={(sale, confirmation) => {
            setCreating(false);
            setNotice(
              confirmation.sent
                ? `Venta ${sale.code} registrada. ${
                    confirmation.simulated
                      ? "La confirmación quedó simulada: el CRM está en modo de prueba de correo."
                      : `Confirmación enviada a ${confirmation.recipients.join(", ")}.`
                  }`
                : `Venta ${sale.code} registrada. No se envió la confirmación: ${confirmation.error ?? "revisá el correo del expediente."}`,
            );
            void load();
          }}
        />
      )}
    </>
  );
}

/**
 * Encabezado ordenable · hallazgo `G2`.
 *
 * El orden viaja al backend junto con los filtros: ordenar solo la tanda cargada
 * mentiría en cuanto la cartera sea más grande que la página. "Las de mayor
 * saldo primero" es la pregunta para la que existe esta pantalla y no se podía
 * hacer, aunque el backend ya lo aceptara.
 */
function SortableTh({
  field,
  label,
  sort,
  onToggle,
}: {
  field: SaleSortField;
  label: string;
  sort: { sortBy?: SaleSortField; sortDir?: "asc" | "desc" };
  onToggle: (field: SaleSortField) => void;
}) {
  const active = sort.sortBy === field;

  return (
    <th aria-sort={active ? (sort.sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`th-sort${active ? " is-active" : ""}`}
        onClick={() => onToggle(field)}
      >
        {label}
        <Icon name={active && sort.sortDir === "asc" ? "arrow-up" : "arrow-down"} />
      </button>
    </th>
  );
}

/**
 * Barra de cobro: total, abonado y saldo en una sola lectura.
 *
 * Tres colores y no dos: sin saldo, al día y atrasada. Antes el naranja
 * significaba las dos últimas y lo urgente quedaba a cargo de un distintivo en
 * otra columna, que es donde nadie lo busca.
 */
export function PaymentProgress({ sale }: { sale: SaleSummary }) {
  const percentage = paidPercentage(sale.paidAmount, sale.finalPrice);
  const settled = percentage >= 100;
  const tone = settled
    ? "var(--green)"
    : sale.isPaymentOverdue
      ? "var(--red)"
      : "var(--orange)";

  return (
    <div style={{ minWidth: 150 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          marginBottom: 4,
          color: "var(--text-mute)",
        }}
      >
        <span className="num">{formatAmount(sale.paidAmount)}</span>
        <span className="num" style={{ color: settled ? "var(--green)" : tone }}>
          {settled ? "sin saldo" : `falta ${formatAmount(sale.balanceAmount)}`}
        </span>
      </div>
      <div
        style={{ background: "var(--border-soft)", height: 6, borderRadius: 3, overflow: "hidden" }}
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Cobrado ${percentage} %`}
      >
        <div style={{ background: tone, height: "100%", width: `${percentage}%` }} />
      </div>
    </div>
  );
}

const subtleStyle = { fontSize: 11, color: "var(--text-mute)", marginTop: 6 } as const;
