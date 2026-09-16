"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { EmailLinks, PhoneLinks } from "@/components/ContactLinks";
import { useSession } from "@/lib/auth/AuthProvider";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { ApiError } from "@/lib/api/client";
import {
  crmApi,
  formatMoney,
  relativeTime,
  type ClientFilters,
  type ClientSort,
  type ClientSortField,
  type ClientSummary,
  type PipelineStage,
} from "@/lib/api/crm";
import {
  PIPELINE_STAGE_COLOR,
  SOURCE_CHANNELS,
  SOURCE_CHANNEL_LABEL,
  stageLabel,
  type SourceChannel,
} from "@/lib/domain/enums";
import { KanbanBoard } from "./KanbanBoard";
import { MarkLostModal, NewProspectModal } from "./modals";
import { LIST_PAGE_SIZE, useClientsData } from "./useClientsData";

type View = "kanban" | "lista";

const CHANNEL_CLASS: Record<SourceChannel, string> = {
  whatsapp: "wa",
  messenger: "ms",
  instagram: "ig",
  other: "",
};

export function ClientesView() {
  const { user } = useSession();
  const [view, setView] = useState<View>("kanban");
  const [filters, setFilters] = useState<ClientFilters>({});
  // La búsqueda vive aparte de los selectores: se escribe letra por letra y
  // necesita retraso, mientras que elegir una opción es una decisión terminada.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  /**
   * Término que llega desde el buscador de la barra superior.
   *
   * Se sincroniza en un sentido —de la URL al campo— porque es la única entrada
   * externa que existe hoy. Llevar filtros, vista y orden a la URL es otra cosa
   * y tiene su propia tarea (C4).
   */
  const params = useSearchParams();
  const urlSearch = params.get("search") ?? "";
  useEffect(() => {
    if (urlSearch) setSearch(urlSearch);
  }, [urlSearch]);
  const [sort, setSort] = useState<ClientSort | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [lostTarget, setLostTarget] = useState<ClientSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // El orden viaja al backend junto con los filtros: ordenar solo lo que cabe en
  // la página mentiría cuando la cartera es más grande que el lote cargado.
  const query = useMemo<ClientFilters>(() => {
    const next: ClientFilters = { ...filters };
    const term = debouncedSearch.trim();
    if (term) next.search = term;
    if (sort) {
      next.sortBy = sort.by;
      next.sortDir = sort.dir;
    }
    return next;
  }, [filters, debouncedSearch, sort]);

  const data = useClientsData(query, view);

  const hasFilters =
    search.trim() !== "" ||
    Object.values(filters).some((v) => v !== undefined && v !== "");

  function clearFilters() {
    setFilters({});
    setSearch("");
  }

  function setFilter(key: keyof ClientFilters, value: string) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === "") delete next[key];
      else next[key] = value as never;
      return next;
    });
  }

  /** Ascendente → descendente → sin orden manual, como cualquier tabla conocida. */
  function toggleSort(field: ClientSortField) {
    setSort((prev) => {
      if (prev?.by !== field) return { by: field, dir: "asc" };
      return prev.dir === "asc" ? { by: field, dir: "desc" } : null;
    });
  }

  /** Devuelve false si el backend rechazó el movimiento, para revertir la tarjeta. */
  async function handleMove(clientId: string, stageId: string): Promise<boolean> {
    setActionError(null);
    try {
      data.patchClient(await crmApi.moveStage(clientId, stageId));
      // Solo los contadores: la tarjeta ya la reemplazó `patchClient` y el
      // tablero la está dibujando en su etapa nueva.
      void data.refreshCounts();
      return true;
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : "No se pudo mover la tarjeta.",
      );
      return false;
    }
  }

  const stageById = useMemo(
    () => new Map(data.stages.map((s) => [s.id, s])),
    [data.stages],
  );

  return (
    <>
      <div className="filterbar">
        <div className="viewtabs">
          <button
            type="button"
            aria-pressed={view === "kanban"}
            onClick={() => setView("kanban")}
          >
            <Icon name="kanban" />
            Kanban
          </button>
          <button
            type="button"
            aria-pressed={view === "lista"}
            onClick={() => setView("lista")}
          >
            <Icon name="doc" />
            Lista
          </button>
        </div>

        <input
          className="selectfilter"
          style={{ minWidth: 210 }}
          placeholder="Buscar nombre, teléfono o correo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar"
        />

        <select
          className="selectfilter"
          value={filters.advisorId ?? ""}
          onChange={(e) => setFilter("advisorId", e.target.value)}
          aria-label="Filtrar por asesor"
        >
          <option value="">Asesor</option>
          <option value="unassigned">Sin asignar</option>
          {data.team.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </select>

        <select
          className="selectfilter"
          value={filters.channel ?? ""}
          onChange={(e) => setFilter("channel", e.target.value)}
          aria-label="Filtrar por canal"
        >
          <option value="">Canal</option>
          {SOURCE_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {SOURCE_CHANNEL_LABEL[c]}
            </option>
          ))}
        </select>

        <select
          className="selectfilter"
          value={filters.tagId ?? ""}
          onChange={(e) => setFilter("tagId", e.target.value)}
          aria-label="Filtrar por etiqueta"
        >
          <option value="">Etiqueta</option>
          {data.tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button type="button" className="selectfilter" onClick={clearFilters}>
            Limpiar filtros
            <Icon name="x" />
          </button>
        )}

        <span className="count">
          {data.loading ? "Cargando…" : `${data.total} oportunidades`}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn primary" onClick={() => setShowNew(true)}>
          <Icon name="plus" />
          Nuevo prospecto
        </button>
      </div>

      {actionError && (
        <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
          <Icon name="target" />
          <div>{actionError}</div>
        </div>
      )}

      {data.catalogError && (
        <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
          <Icon name="target" />
          <div style={{ flex: 1 }}>
            {data.catalogError} Sin las etapas, el tablero no puede dibujar sus columnas.
          </div>
          <button
            type="button"
            className="btn ghost tiny"
            onClick={() => void data.reloadCatalogs()}
          >
            Reintentar
          </button>
        </div>
      )}

      {data.error ? (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <div style={{ color: "var(--red)", fontWeight: 600, marginBottom: 10 }}>
            {data.error}
          </div>
          <button className="btn ghost" onClick={() => void data.reload()}>
            Reintentar
          </button>
        </div>
      ) : data.loading && data.total === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-mute)" }}>
          Cargando cartera…
        </div>
      ) : data.total === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {hasFilters ? "Sin coincidencias" : "Todavía no hay prospectos"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-mute)", marginBottom: 18 }}>
            {hasFilters
              ? "Ajustá o limpiá los filtros para ver la cartera completa."
              : "Creá el primero para empezar a trabajar el pipeline."}
          </div>
          {hasFilters ? (
            <button className="btn ghost" onClick={clearFilters}>
              Limpiar filtros
            </button>
          ) : (
            <button className="btn primary" onClick={() => setShowNew(true)}>
              <Icon name="plus" />
              Nuevo prospecto
            </button>
          )}
        </div>
      ) : view === "kanban" ? (
        <KanbanBoard
          stages={data.stages}
          board={data.board}
          counts={data.counts}
          onMove={handleMove}
          onLoadMore={(stageId) => void data.loadMore(stageId)}
          onRequestLost={setLostTarget}
        />
      ) : (
        <>
          <ClientTable
            clients={data.list}
            stageById={stageById}
            sort={sort}
            onSort={toggleSort}
            onRequestLost={setLostTarget}
          />
          <Paginacion
            page={data.page}
            total={data.total}
            shown={data.list.length}
            busy={data.loading}
            onGo={(next) => void data.goToPage(next)}
          />
        </>
      )}

      {showNew && (
        <NewProspectModal
          team={data.team}
          tags={data.tags}
          defaultAdvisorId={user?.id ?? null}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void data.reload();
          }}
        />
      )}

      {lostTarget && (
        <MarkLostModal
          client={lostTarget}
          onClose={() => setLostTarget(null)}
          onDone={(updated) => {
            data.patchClient(updated);
            setLostTarget(null);
            void data.refreshCounts();
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────── Paginación · HU-CLI-08 ───────────────────────── */

/**
 * Navegación de la vista de lista.
 *
 * Dice siempre cuántos se están viendo de cuántos hay. Antes la barra de filtros
 * anunciaba el total de la cartera sobre una tabla que solo dibujaba las primeras
 * 200 filas, sin nada que avisara que faltaba el resto.
 */
function Paginacion({
  page,
  total,
  shown,
  busy,
  onGo,
}: {
  page: number;
  total: number;
  shown: number;
  busy: boolean;
  onGo: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  if (total === 0) return null;

  const from = (page - 1) * LIST_PAGE_SIZE + 1;
  const to = from + shown - 1;

  return (
    <div className="pager">
      <span className="pager-range">
        {from}–{to} de <b>{total}</b>
      </span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className="btn ghost tiny"
        disabled={busy || page <= 1}
        onClick={() => onGo(page - 1)}
      >
        Anterior
      </button>
      <span className="pager-page">
        Página {page} de {pages}
      </span>
      <button
        type="button"
        className="btn ghost tiny"
        disabled={busy || page >= pages}
        onClick={() => onGo(page + 1)}
      >
        Siguiente
      </button>
    </div>
  );
}

/* ──────────────────────────── Vista de lista ──────────────────────────────── */

/**
 * Encabezado ordenable · HU-CLI-08.
 *
 * `aria-sort` va en el `th` y no en el botón: es lo que anuncian los lectores de
 * pantalla al recorrer la tabla.
 */
function SortableTh({
  field,
  label,
  sort,
  onSort,
}: {
  field: ClientSortField;
  label: string;
  sort: ClientSort | null;
  onSort: (field: ClientSortField) => void;
}) {
  const active = sort?.by === field;
  const ascending = active && sort.dir === "asc";

  return (
    <th aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`th-sort${active ? " is-active" : ""}`}
        onClick={() => onSort(field)}
        title={`Ordenar por ${label.toLowerCase()}`}
      >
        {label}
        <Icon name={!active ? "sort" : ascending ? "arrow-up" : "arrow-down"} />
      </button>
    </th>
  );
}

function ClientTable({
  clients,
  stageById,
  sort,
  onSort,
  onRequestLost,
}: {
  clients: ClientSummary[];
  stageById: Map<string, PipelineStage>;
  sort: ClientSort | null;
  onSort: (field: ClientSortField) => void;
  onRequestLost: (client: ClientSummary) => void;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead>
            <tr>
              <SortableTh field="name" label="Nombre" sort={sort} onSort={onSort} />
              <SortableTh field="channel" label="Canal" sort={sort} onSort={onSort} />
              <th>Responsable</th>
              <th>Etapa</th>
              <th>Destino</th>
              <SortableTh field="value" label="Valor" sort={sort} onSort={onSort} />
              <SortableTh field="contact" label="Contacto" sort={sort} onSort={onSort} />
              <th style={{ width: 110, textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => {
              const stage = stageById.get(client.pipelineStageId);
              return (
                <tr key={client.id}>
                  <td>
                    <span className="cell-name">
                      <span className="avatar o1">{client.initials}</span>
                      <div>
                        <Link
                          href={`/clientes/${client.id}`}
                          style={{ color: "inherit", textDecoration: "none", fontWeight: 600 }}
                        >
                          {client.fullName}
                        </Link>
                        {client.duplicateCount ? (
                          <span
                            className="chip amber duplicate-chip"
                            title="Otro expediente coincide por teléfono, correo o nombre"
                          >
                            Posible duplicado
                          </span>
                        ) : null}
                        <div style={{ fontSize: 11, color: "var(--text-mute)" }}>
                          {client.primaryPhone ? (
                            <PhoneLinks phone={client.primaryPhone} />
                          ) : (
                            <EmailLinks email={client.primaryEmail} />
                          )}
                        </div>
                      </div>
                    </span>
                  </td>
                  <td>
                    {client.sourceChannel === "other" ? (
                      <span style={{ color: "var(--text-faint)" }}>—</span>
                    ) : (
                      <span className={`chip ${CHANNEL_CLASS[client.sourceChannel]}`}>
                        {SOURCE_CHANNEL_LABEL[client.sourceChannel]}
                      </span>
                    )}
                  </td>
                  <td>
                    {client.advisor?.fullName ?? (
                      <span className="chip amber">Sin asignar</span>
                    )}
                  </td>
                  <td>
                    {stage && (
                      <span className={`chip ${PIPELINE_STAGE_COLOR[stage.code]?.chip ?? ""}`}>
                        {stageLabel(stage)}
                      </span>
                    )}
                  </td>
                  <td>{client.destinations.join(", ") || "—"}</td>
                  <td>
                    <span className="num">{formatMoney(client.estimatedValue)}</span>
                  </td>
                  <td>
                    <span style={{ color: "var(--text-mute)", fontSize: 12 }}>
                      {relativeTime(client.lastContactAt)}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {client.status !== "lost" && (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => onRequestLost(client)}
                      >
                        Descartar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
