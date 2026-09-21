"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { RelativeTime } from "@/components/RelativeTime";
import { TabPanel, Tabs, type TabOption } from "@/components/Tabs";
import { EmailLinks, PhoneLinks } from "@/components/ContactLinks";
import { useSession } from "@/lib/auth/AuthProvider";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { ApiError } from "@/lib/api/client";
import {
  CLIENT_SORT_FIELDS,
  crmApi,
  formatMoney,
  type ClientFilters,
  type ClientSort,
  type ClientSortField,
  type ClientSummary,
  type PipelineStage,
  type Tag,
  type TeamMember,
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

/** Las dos vistas de la cartera · wireframes 03 y 07. */
const VIEW_TABS: readonly TabOption<View>[] = [
  { id: "kanban", label: "Kanban", icon: "kanban" },
  { id: "lista", label: "Lista", icon: "doc" },
];

/**
 * "Sin contacto hace…" · `C3`, HU-CLI-06.
 *
 * Tres cortes y no un campo libre: la pregunta real del equipo es "¿a quién
 * tengo abandonado?", y se responde con una semana, dos o un mes. Pedir un
 * número exacto obligaría a pensar cuál.
 */
const STALE_OPTIONS = [7, 15, 30] as const;

/** Lo que viaja en la URL. El orden va aparte, en `sortBy`/`sortDir`. */
type UrlFilters = Omit<ClientFilters, "page" | "pageSize">;

/**
 * Filtros, vista y orden leídos de la URL · `C4`.
 *
 * Que vivan en la URL es lo que permite compartir "los de Cancún sin contacto
 * hace 30 días" pegando un enlace, volver con el botón de atrás sin perder el
 * tablero armado, y que el Dashboard apunte a una selección concreta. Con el
 * estado en `useState` cada recarga devolvía a la cartera completa.
 */
function readFilters(params: URLSearchParams): UrlFilters {
  const filters: UrlFilters = {};
  const channel = params.get("channel");
  const stale = Number(params.get("staleDays"));

  if (params.get("search")) filters.search = params.get("search") ?? undefined;
  if (params.get("advisorId")) filters.advisorId = params.get("advisorId") ?? undefined;
  if (channel && (SOURCE_CHANNELS as readonly string[]).includes(channel)) {
    filters.channel = channel as SourceChannel;
  }
  if (params.get("tagId")) filters.tagId = params.get("tagId") ?? undefined;
  if (params.get("destination")) filters.destination = params.get("destination") ?? undefined;
  if (params.get("pipelineStageId")) {
    filters.pipelineStageId = params.get("pipelineStageId") ?? undefined;
  }
  if ((STALE_OPTIONS as readonly number[]).includes(stale)) filters.staleDays = stale;

  const sortBy = params.get("sortBy") as ClientSortField | null;
  if (sortBy && (CLIENT_SORT_FIELDS as readonly string[]).includes(sortBy)) {
    filters.sortBy = sortBy;
    filters.sortDir = params.get("sortDir") === "desc" ? "desc" : "asc";
  }

  return filters;
}

function toSearchParams(filters: UrlFilters, view: View): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  // El Kanban es la vista por defecto: no ensucia la URL.
  if (view === "lista") params.set("vista", "lista");
  return params.toString();
}

const CHANNEL_CLASS: Record<SourceChannel, string> = {
  whatsapp: "wa",
  messenger: "ms",
  instagram: "ig",
  other: "",
};

export function ClientesView() {
  const { user } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /*
   * Todo el estado de la pantalla se deriva de la URL · `C4`.
   *
   * `urlKey` es la cadena y no el objeto de Next: `useSearchParams` devuelve una
   * instancia nueva en cada render y usarla de dependencia relanzaría la
   * consulta sin que nada hubiera cambiado.
   */
  const urlKey = params.toString();
  const filters = useMemo(() => readFilters(new URLSearchParams(urlKey)), [urlKey]);
  const view: View = params.get("vista") === "lista" ? "lista" : "kanban";
  const sort: ClientSort | null = filters.sortBy
    ? { by: filters.sortBy, dir: filters.sortDir ?? "asc" }
    : null;

  // La búsqueda vive aparte de los selectores: se escribe letra por letra y
  // necesita retraso, mientras que elegir una opción es una decisión terminada.
  const [search, setSearch] = useState(filters.search ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);

  const [showNew, setShowNew] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  /** Expedientes marcados en la lista · `F3`. Se vacía al cambiar de filtro. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lostTarget, setLostTarget] = useState<ClientSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** El buscador de la barra superior escribe en la URL: el campo lo sigue. */
  const urlSearch = filters.search ?? "";
  useEffect(() => {
    setSearch(urlSearch);
  }, [urlSearch]);

  // El orden viaja al backend junto con los filtros: ordenar solo lo que cabe en
  // la página mentiría cuando la cartera es más grande que el lote cargado.
  const query = useMemo<ClientFilters>(() => filters, [filters]);

  const data = useClientsData(query, view);

  const hasFilters =
    search.trim() !== "" ||
    Object.entries(filters).some(
      ([key, value]) =>
        key !== "sortBy" && key !== "sortDir" && value !== undefined && value !== "",
    );

  /**
   * Escribe en la URL; el estado sale de ahí.
   *
   * `replace` y no `push`: cada tecla del buscador dejaría una entrada en el
   * historial y el botón de atrás tendría que pulsarse una vez por letra.
   */
  const apply = useCallback(
    (next: UrlFilters, nextView: View = view) => {
      const qs = toSearchParams(next, nextView);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, view],
  );

  /*
   * Lo escrito llega a la URL cuando deja de escribirse · `C4`.
   *
   * Va contra el término YA reposado y no contra cada tecla: escribir "Cancún"
   * dejaría seis entradas de historial. Y no hay ciclo con el efecto de arriba,
   * porque al volver de la URL el valor ya es el mismo y `setSearch` no cambia
   * nada.
   */
  useEffect(() => {
    const term = debouncedSearch.trim();
    if (term === (filters.search ?? "")) return;
    apply({ ...filters, search: term || undefined }, view);
  }, [debouncedSearch, filters, apply, view]);

  const setView = useCallback((next: View) => apply(filters, next), [apply, filters]);

  /*
   * Al cambiar el filtro se vacía la selección · `F3`.
   *
   * Sin esto quedarían marcados expedientes que ya no están en pantalla, y la
   * acción en lote se aplicaría sobre gente que quien la lanzó no está viendo.
   */
  useEffect(() => {
    setSelected(new Set());
  }, [urlKey]);

  /**
   * Exporta la cartera filtrada · `F6`, HU-REP-06.
   *
   * Manda los MISMOS filtros que la pantalla, así que el archivo y la tabla
   * dicen lo mismo. El backend vuelve a aplicar los permisos: exportar no puede
   * ver más de lo que se ve.
   */
  async function exportarCartera() {
    setExporting(true);
    setActionError(null);
    try {
      const blob = await crmApi.downloadClients(query);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "cartera.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : "No se pudo generar el archivo.",
      );
    } finally {
      setExporting(false);
    }
  }

  function clearFilters() {
    setSearch("");
    apply({});
  }

  function setFilter(key: keyof UrlFilters, value: string) {
    apply(nextFilters(filters, key, value), view);
  }

    function nextFilters(prev: UrlFilters, key: keyof UrlFilters, value: string): UrlFilters {
    const next = { ...prev };
    if (value === "") delete next[key];
    else next[key] = value as never;
    return next;
  }

  /** Ascendente → descendente → sin orden manual, como cualquier tabla conocida. */
  function toggleSort(field: ClientSortField) {
    const next = { ...filters };
    if (sort?.by !== field) {
      next.sortBy = field;
      next.sortDir = "asc";
    } else if (sort.dir === "asc") {
      next.sortBy = field;
      next.sortDir = "desc";
    } else {
      delete next.sortBy;
      delete next.sortDir;
    }
    apply(next, view);
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

  /** La ficha trae `tagIds`; el nombre sale del catálogo (`C9`). */
  const tagById = useMemo(() => new Map(data.tags.map((t) => [t.id, t])), [data.tags]);

  return (
    <>
      <div className="filterbar">
        <Tabs
          options={VIEW_TABS}
          value={view}
          onChange={setView}
          label="Vista de la cartera"
          idPrefix="clientes"
        />

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

        {/* C3 · los tres filtros que HU-CLI-06 pide y faltaban. */}
        <select
          className="selectfilter"
          value={filters.pipelineStageId ?? ""}
          onChange={(e) => setFilter("pipelineStageId", e.target.value)}
          aria-label="Filtrar por etapa"
        >
          <option value="">Etapa</option>
          {data.stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stageLabel(stage)}
            </option>
          ))}
        </select>

        <input
          className="selectfilter"
          style={{ minWidth: 130 }}
          placeholder="Destino"
          defaultValue={filters.destination ?? ""}
          // Al salir del campo y no en cada tecla: el destino se escribe entero
          // —"Punta Cana"— y filtrar por "Pun" no le sirve a nadie.
          onBlur={(e) => setFilter("destination", e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          aria-label="Filtrar por destino"
        />

        <select
          className="selectfilter"
          value={filters.staleDays ?? ""}
          onChange={(e) => setFilter("staleDays", e.target.value)}
          aria-label="Filtrar por tiempo sin contacto"
        >
          <option value="">Sin contacto</option>
          {STALE_OPTIONS.map((days) => (
            <option key={days} value={days}>
              Hace {days} días o más
            </option>
          ))}
        </select>

        {hasFilters && (
          <button type="button" className="selectfilter" onClick={clearFilters}>
            Limpiar filtros
            <Icon name="x" />
          </button>
        )}

        {/* F6 · lo que se exporta es EXACTAMENTE lo que está filtrado. */}
        <button
          type="button"
          className="selectfilter"
          onClick={() => void exportarCartera()}
          disabled={exporting}
          title="Exportar la cartera filtrada a Excel"
        >
          <Icon name="download" />
          {exporting ? "Generando…" : "Exportar"}
        </button>

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
      ) : (
        <TabPanel id={view} idPrefix="clientes">
          {/*
            La barra aparece solo con algo marcado · `F3`.
            Fija arriba del listado, no flotando sobre el contenido: la acción
            se decide mirando la tabla, y un panel que la tape obliga a cerrarlo
            para comprobar qué se seleccionó.
          */}
          {bulkNotice && (
            <div className="auth-alert success" style={{ marginBottom: 12 }} role="status">
              <Icon name="check" />
              <div>{bulkNotice}</div>
              <button
                type="button"
                className="btn ghost tiny"
                style={{ marginLeft: "auto" }}
                onClick={() => setBulkNotice(null)}
              >
                Cerrar
              </button>
            </div>
          )}

          {view === "lista" && selected.size > 0 && (
            <BulkBar
              count={selected.size}
              team={data.team}
              tags={data.tags}
              canReassign={user?.role !== "advisor"}
              onCancel={() => setSelected(new Set())}
              onApply={async (input) => {
                const result = await crmApi.bulkUpdateClients({
                  clientIds: [...selected],
                  ...input,
                });
                /*
                 * El aviso lo muestra el PADRE, no la barra: limpiar la
                 * selección desmonta la barra, y con ella se iba el mensaje que
                 * decía cuántos se habían actualizado.
                 */
                setBulkNotice(
                  result.skipped > 0
                    ? `${result.applied} de ${result.total} expedientes actualizados · ${result.skipped} sin cambios o de otro asesor`
                    : `${result.applied} expediente${result.applied === 1 ? "" : "s"} actualizado${
                        result.applied === 1 ? "" : "s"
                      }`,
                );
                setSelected(new Set());
                data.reload();
              }}
            />
          )}

          {view === "kanban" ? (
            <KanbanBoard
              stages={data.stages}
              tags={data.tags}
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
                tagById={tagById}
                sort={sort}
                onSort={toggleSort}
                onRequestLost={setLostTarget}
                selected={selected}
                onToggleOne={(id) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onToggleAll={() =>
                  setSelected((prev) =>
                    data.list.every((c) => prev.has(c.id))
                      ? new Set()
                      : new Set(data.list.map((c) => c.id)),
                  )
                }
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
        </TabPanel>
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
  tagById,
  sort,
  onSort,
  onRequestLost,
  selected,
  onToggleOne,
  onToggleAll,
}: {
  clients: ClientSummary[];
  stageById: Map<string, PipelineStage>;
  tagById: Map<string, Tag>;
  sort: ClientSort | null;
  onSort: (field: ClientSortField) => void;
  onRequestLost: (client: ClientSummary) => void;
  selected: Set<string>;
  onToggleOne: (id: string) => void;
  onToggleAll: () => void;
}) {
  const allChecked = clients.length > 0 && clients.every((c) => selected.has(c.id));
  const someChecked = clients.some((c) => selected.has(c.id));

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  aria-label="Seleccionar todo lo que se ve"
                  checked={allChecked}
                  ref={(node) => {
                    // Indeterminado cuando hay algunos: decir "ninguno" con una
                    // casilla vacía cuando hay tres marcados sería mentir.
                    if (node) node.indeterminate = someChecked && !allChecked;
                  }}
                  onChange={onToggleAll}
                />
              </th>
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
                <tr key={client.id} className={selected.has(client.id) ? "is-selected" : undefined}>
                  <td data-label="">
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${client.fullName}`}
                      checked={selected.has(client.id)}
                      onChange={() => onToggleOne(client.id)}
                    />
                  </td>
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
                        {/* Etiquetas en la fila · `C9`, igual que en la tarjeta. */}
                        {client.tagIds.length > 0 && (
                          <div className="row-tags">
                            {client.tagIds.slice(0, 3).map((id) => {
                              const tag = tagById.get(id);
                              return tag ? (
                                <span key={id} className="chip tag-chip">
                                  {tag.name}
                                </span>
                              ) : null;
                            })}
                            {client.tagIds.length > 3 && (
                              <span
                                className="chip tag-chip is-more"
                                title="Abrí el expediente para verlas todas"
                              >
                                +{client.tagIds.length - 3}
                              </span>
                            )}
                          </div>
                        )}
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
                      <RelativeTime iso={client.lastContactAt} />
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

/* ───────────────────── Acciones en lote · F3, HU-CLI-04 ───────────────────── */

/**
 * Reasignar o etiquetar lo marcado.
 *
 * Las dos acciones que el gerente hace de verdad en tanda: repartir la cartera
 * de alguien que se fue y clasificar a los que preguntaron por lo mismo. Una por
 * una son doce confirmaciones y doce recargas.
 *
 * Reasignar solo se ofrece a Gerente y Administrador (matriz 4.2); el backend lo
 * vuelve a comprobar. Las etiquetas se AGREGAN: un lote que las reemplazara
 * borraría en silencio la clasificación de otro.
 */
function BulkBar({
  count,
  team,
  tags,
  canReassign,
  onCancel,
  onApply,
}: {
  count: number;
  team: TeamMember[];
  tags: Tag[];
  canReassign: boolean;
  onCancel: () => void;
  onApply: (input: { advisorId?: string | null; addTagIds?: string[] }) => Promise<void>;
}) {
  const [advisorId, setAdvisorId] = useState("");
  const [tagId, setTagId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nothingChosen = advisorId === "" && tagId === "";

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await onApply({
        ...(advisorId ? { advisorId: advisorId === "unassigned" ? null : advisorId } : {}),
        ...(tagId ? { addTagIds: [tagId] } : {}),
      });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo aplicar el cambio.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bulkbar" role="group" aria-label="Acciones sobre lo seleccionado">
      <b>
        {count} seleccionado{count === 1 ? "" : "s"}
      </b>

      {canReassign && (
        <select
          className="selectfilter"
          value={advisorId}
          onChange={(event) => setAdvisorId(event.target.value)}
          disabled={busy}
          aria-label="Reasignar a"
        >
          <option value="">Reasignar a…</option>
          <option value="unassigned">Dejar sin asignar</option>
          {team.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </select>
      )}

      <select
        className="selectfilter"
        value={tagId}
        onChange={(event) => setTagId(event.target.value)}
        disabled={busy}
        aria-label="Agregar etiqueta"
      >
        <option value="">Agregar etiqueta…</option>
        {tags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="btn primary tiny"
        onClick={() => void apply()}
        disabled={busy || nothingChosen}
      >
        {busy ? "Aplicando…" : "Aplicar"}
      </button>
      <button type="button" className="btn ghost tiny" onClick={onCancel} disabled={busy}>
        Cancelar
      </button>

      {error && (
        <span className="bulkbar-note err" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
