"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icon";
import { EmptyState, ErrorCard, LoadingCard } from "@/components/StateCards";
import { ApiError } from "@/lib/api/client";
import {
  crmApi,
  formatMoney,
  relativeTime,
  type QuoteFilters,
  type QuoteSortField,
  type QuoteSummary,
  type QuotesSummary,
  type TeamMember,
} from "@/lib/api/crm";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import {
  QUOTE_STATUSES,
  QUOTE_STATUS_CHIP,
  QUOTE_STATUS_LABEL,
  QUOTE_TYPES,
  QUOTE_TYPE_LABEL,
  type QuoteStatus,
} from "@/lib/domain/enums";

/** Tarjetas del encabezado · HU-COT-01. */
const KPI_CARDS: { status: QuoteStatus; label: string; color: string }[] = [
  { status: "draft", label: "Borradores", color: "var(--text-faint)" },
  { status: "sent", label: "Enviadas", color: "var(--blue)" },
  { status: "negotiation", label: "En negociación", color: "var(--purple)" },
  { status: "accepted", label: "Aceptadas", color: "var(--green)" },
  { status: "rejected", label: "Rechazadas", color: "var(--red)" },
  { status: "expired", label: "Vencidas", color: "var(--amber)" },
];

/** Estados que se ofrecen en el selector; el descarte tiene su propio filtro. */
const FILTERABLE_STATUSES = QUOTE_STATUSES.filter((status) => status !== "archived");

const PAGE_SIZE = 50;

/** Columnas por las que el backend sabe ordenar; valida lo que llega en la URL. */
const SORTABLE: QuoteSortField[] = ["code", "price", "validUntil", "created"];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-SV", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Los filtros que viajan en la URL, sin la página ni el tamaño de tanda. */
type UrlFilters = Omit<QuoteFilters, "page" | "pageSize">;

/**
 * Lee los filtros de la URL.
 *
 * La URL es la fuente de verdad del listado: así los accesos directos del
 * Dashboard (`?status=expired`) aplican de verdad, volver desde el detalle
 * conserva lo que había, y una vista filtrada se puede compartir por chat. Antes
 * el estado arrancaba siempre vacío y esos enlaces caían en la lista completa.
 */
function readFilters(params: URLSearchParams): UrlFilters {
  const filters: UrlFilters = {};
  const status = params.get("status");
  const quoteType = params.get("quoteType");

  if (params.get("search")) filters.search = params.get("search") ?? undefined;
  if (status && (QUOTE_STATUSES as readonly string[]).includes(status)) {
    filters.status = status as QuoteStatus;
  }
  if (quoteType && (QUOTE_TYPES as readonly string[]).includes(quoteType)) {
    filters.quoteType = quoteType as QuoteFilters["quoteType"];
  }
  if (params.get("advisorId")) filters.advisorId = params.get("advisorId") ?? undefined;
  if (params.get("from")) filters.from = params.get("from") ?? undefined;
  if (params.get("to")) filters.to = params.get("to") ?? undefined;
  if (params.get("overdue") === "true") filters.overdue = true;
  if (params.get("noAnswer") === "true") filters.noAnswer = true;
  if (params.get("includeArchived") === "true") filters.includeArchived = true;

  const sortBy = params.get("sortBy") as QuoteSortField | null;
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

export function CotizacionesView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlKey = params.toString();
  const filters = useMemo(() => readFilters(new URLSearchParams(urlKey)), [urlKey]);

  // La búsqueda vive aparte de los selectores: se escribe letra por letra y
  // necesita retraso, mientras que elegir una opción es una decisión terminada.
  const [search, setSearch] = useState(filters.search ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);

  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [summary, setSummary] = useState<QuotesSummary | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Testigo de la petición en curso.
   *
   * Sin esto gana la respuesta que llega última, que no es la de la consulta más
   * nueva: una respuesta lenta de "can" pisaba los resultados de "cancún" y la
   * tabla dejaba de corresponder con lo escrito. Mismo patrón que
   * `useClientsData` en Clientes.
   */
  const requestId = useRef(0);

  /** El término escrito manda sobre el de la URL mientras se está escribiendo. */
  const query = useMemo<QuoteFilters>(() => {
    const next: QuoteFilters = { ...filters, page, pageSize: PAGE_SIZE };
    const term = debouncedSearch.trim();
    if (term) next.search = term;
    else delete next.search;
    return next;
  }, [filters, debouncedSearch, page]);

  const queryKey = JSON.stringify(query);

  const load = useCallback(async () => {
    const parsed = JSON.parse(queryKey) as QuoteFilters;
    const ticket = ++requestId.current;

    setLoading(true);
    setError(null);

    try {
      // El resumen usa los mismos filtros: el encabezado y las filas no pueden
      // contar universos distintos. La página sí se descarta, porque el KPI
      // habla de toda la selección y no de la tanda que se está viendo.
      const { page: _page, pageSize: _pageSize, ...forSummary } = parsed;
      const [result, kpis] = await Promise.all([
        crmApi.listQuotes(parsed),
        crmApi.quotesSummary(forSummary),
      ]);

      if (ticket !== requestId.current) return;
      setQuotes(result.items);
      setTotal(result.total);
      setSummary(kpis);
    } catch (caught) {
      if (ticket !== requestId.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "No se pudieron cargar las cotizaciones.",
      );
      setQuotes([]);
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

  /** Escribe el filtro en la URL; el estado se deriva de ahí. */
  const applyFilters = useCallback(
    (next: UrlFilters) => {
      const qs = toSearchParams(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  function setFilter<K extends keyof UrlFilters>(key: K, value: UrlFilters[K]) {
    const next = { ...filters };
    if (value === undefined || value === "" || value === false) delete next[key];
    else next[key] = value;
    applyFilters(next);
  }

  /** Ascendente → descendente → sin orden manual, como cualquier tabla conocida. */
  function toggleSort(field: QuoteSortField) {
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
    router.replace(pathname, { scroll: false });
  }

  const hasFilters =
    search.trim() !== "" ||
    Object.entries(filters).some(([, value]) => value !== undefined && value !== "");

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <div className="quote-kpis">
        {KPI_CARDS.map((card) => {
          const active = filters.status === card.status;
          return (
            <button
              key={card.status}
              type="button"
              className="card quote-kpi"
              aria-pressed={active}
              style={{ borderLeft: `3px solid ${card.color}` }}
              onClick={() => setFilter("status", active ? undefined : card.status)}
            >
              <div className="quote-kpi-label">{card.label}</div>
              <div className="quote-kpi-value">
                {summary ? summary.byStatus[card.status] : "—"}
              </div>
            </button>
          );
        })}

        {/* Los dos avisos del listado también filtran: ver el número y tener que
            buscar las filas a ojo era la mitad del trabajo. */}
        <button
          type="button"
          className="card quote-kpi"
          aria-pressed={filters.noAnswer === true}
          style={{ borderLeft: "3px solid var(--orange)" }}
          title={`Enviadas hace ${summary?.noAnswerBusinessDays ?? 5} días hábiles o más sin respuesta`}
          onClick={() => setFilter("noAnswer", filters.noAnswer ? undefined : true)}
        >
          <div className="quote-kpi-label">Sin respuesta</div>
          <div className="quote-kpi-value" style={{ color: "var(--orange-deep)" }}>
            {summary ? summary.noAnswer : "—"}
          </div>
        </button>
      </div>

      <div className="filterbar">
        <input
          className="selectfilter"
          style={{ minWidth: 230 }}
          placeholder="Buscar por código o cliente…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar cotización"
        />

        <select
          className="selectfilter"
          value={filters.status ?? ""}
          onChange={(e) =>
            setFilter("status", (e.target.value || undefined) as QuoteStatus | undefined)
          }
          aria-label="Filtrar por estado"
        >
          <option value="">Estado</option>
          {FILTERABLE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {QUOTE_STATUS_LABEL[status]}
            </option>
          ))}
        </select>

        <select
          className="selectfilter"
          value={filters.quoteType ?? ""}
          onChange={(e) =>
            setFilter(
              "quoteType",
              (e.target.value || undefined) as QuoteFilters["quoteType"],
            )
          }
          aria-label="Filtrar por tipo"
        >
          <option value="">Tipo</option>
          {QUOTE_TYPES.map((type) => (
            <option key={type} value={type}>
              {QUOTE_TYPE_LABEL[type]}
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
          aria-label="Creadas desde"
          title="Creadas desde"
        />
        <input
          type="date"
          className="selectfilter"
          value={filters.to ?? ""}
          onChange={(e) => setFilter("to", e.target.value || undefined)}
          aria-label="Creadas hasta"
          title="Creadas hasta"
        />

        <button
          type="button"
          className="selectfilter"
          aria-pressed={filters.overdue === true}
          onClick={() => setFilter("overdue", filters.overdue ? undefined : true)}
          title="Solo las que tienen la vigencia pasada"
        >
          <Icon name="calendar" />
          Vencidas
        </button>

        <button
          type="button"
          className="selectfilter"
          aria-pressed={filters.includeArchived === true}
          onClick={() =>
            setFilter("includeArchived", filters.includeArchived ? undefined : true)
          }
          title="Los borradores descartados no se eliminan: se archivan"
        >
          <Icon name="doc" />
          Ver descartadas
        </button>

        {hasFilters && (
          <button type="button" className="selectfilter" onClick={clearFilters}>
            Limpiar filtros
            <Icon name="x" />
          </button>
        )}

        <span className="count">
          {loading && quotes === null
            ? "Cargando…"
            : total === 1
              ? "1 cotización"
              : `${total} cotizaciones`}
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/cotizaciones/nueva" className="btn primary">
          <Icon name="plus" />
          Nueva cotización
        </Link>
      </div>

      {error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : quotes === null ? (
        <LoadingCard>Cargando cotizaciones…</LoadingCard>
      ) : quotes.length === 0 ? (
        <EmptyState
          icon="doc"
          title={hasFilters ? "Sin coincidencias" : "Todavía no hay cotizaciones"}
          hint={
            hasFilters
              ? "Ajustá o limpiá los filtros para ver todas."
              : "Creá la primera desde un expediente o con el botón de arriba."
          }
          action={
            hasFilters ? (
              <button type="button" className="btn ghost" onClick={clearFilters}>
                Limpiar filtros
              </button>
            ) : (
              <Link href="/cotizaciones/nueva" className="btn primary">
                <Icon name="plus" />
                Nueva cotización
              </Link>
            )
          }
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden", opacity: loading ? 0.6 : 1 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="t">
              <thead>
                <tr>
                  <SortableTh field="code" label="Código" sort={filters} onToggle={toggleSort} />
                  <th>Cliente</th>
                  <th>Destino</th>
                  <SortableTh field="price" label="Total" sort={filters} onToggle={toggleSort} />
                  <th>Ver.</th>
                  <th>Asesor</th>
                  <SortableTh
                    field="validUntil"
                    label="Vigencia"
                    sort={filters}
                    onToggle={toggleSort}
                  />
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr key={quote.id}>
                    <td>
                      <Link
                        href={`/cotizaciones/${quote.id}`}
                        className="mono"
                        style={{ fontSize: 12, color: "var(--navy)", fontWeight: 600 }}
                      >
                        {quote.code}
                      </Link>
                    </td>
                    <td>
                      {quote.client ? (
                        <Link
                          href={`/clientes/${quote.client.id}`}
                          style={{ color: "inherit", textDecoration: "none", fontWeight: 600 }}
                        >
                          {quote.client.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{quote.destination ?? "—"}</td>
                    <td>
                      <b className="num">{formatMoney(quote.finalPrice)}</b>
                    </td>
                    <td>
                      <span className="chip">v{quote.versionCount}</span>
                    </td>
                    <td>{quote.advisor?.name ?? "—"}</td>
                    <td>
                      <span
                        className="num"
                        style={{
                          fontSize: 12,
                          color: quote.isOverdue ? "var(--red)" : "var(--text-mute)",
                        }}
                      >
                        {formatDate(quote.validUntil)}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span className={`chip ${QUOTE_STATUS_CHIP[quote.status]}`}>
                          {QUOTE_STATUS_LABEL[quote.status]}
                        </span>
                        {/* Va primero: si hay una versión sin enviar, lo urgente
                            es mandarla, no esperar respuesta de la anterior. */}
                        {quote.hasUnsentChanges && (
                          <span
                            className="chip orange"
                            title={`El cliente recibió la v${quote.lastSentVersionNumber}; la vigente es la v${quote.versionCount}`}
                          >
                            Sin enviar
                          </span>
                        )}
                        {quote.isOverdue && (
                          <span className="chip red" title="La vigencia ya pasó">
                            Vencida
                          </span>
                        )}
                        {quote.noAnswer && !quote.hasUnsentChanges && (
                          <span
                            className="chip orange"
                            title={`Enviada ${relativeTime(quote.sentAt)} sin respuesta`}
                          >
                            Sin respuesta
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* Paginación real: antes se pedían 200 de una sola vez y la fila 201 no
          existía para nadie, aunque el contador la anunciara. Es el mismo
          control que la vista de lista de Clientes. */}
      {quotes !== null && quotes.length > 0 && pageCount > 1 && (
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
    </>
  );
}

/**
 * Encabezado ordenable · HU-COT-01.
 *
 * El orden viaja al backend junto con los filtros: ordenar solo la tanda cargada
 * mentiría en cuanto la cartera sea más grande que la página, igual que en el
 * listado de Clientes.
 */
function SortableTh({
  field,
  label,
  sort,
  onToggle,
}: {
  field: QuoteSortField;
  label: string;
  sort: { sortBy?: QuoteSortField; sortDir?: "asc" | "desc" };
  onToggle: (field: QuoteSortField) => void;
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
