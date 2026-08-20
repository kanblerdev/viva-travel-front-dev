"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  crmApi,
  type ClientFilters,
  type ClientSummary,
  type PipelineStage,
  type Tag,
  type TeamMember,
} from "@/lib/api/crm";
import { ApiError } from "@/lib/api/client";

/**
 * Tandas de carga.
 *
 * El tablero pide por columna: una etapa con 400 fichas no puede vaciar el
 * presupuesto de las otras siete. La lista pide por página, como cualquier tabla.
 */
export const KANBAN_PAGE_SIZE = 25;
export const LIST_PAGE_SIZE = 50;

/** Lo cargado de una columna del tablero. */
export type StageBucket = {
  items: ClientSummary[];
  /** Última tanda pedida. La siguiente es `page + 1`. */
  page: number;
  loadingMore: boolean;
};

type State = {
  stages: PipelineStage[];
  tags: Tag[];
  team: TeamMember[];
  /** Tablero: una tanda por etapa. */
  board: Record<string, StageBucket>;
  /** Lista: la página que se está viendo. */
  list: ClientSummary[];
  page: number;
  /** Conteo por etapa, del backend: refleja el total, no solo lo cargado. */
  counts: Record<string, number>;
  total: number;
  loading: boolean;
  error: string | null;
  /** Falla de catálogos. Va aparte: sin etapas el tablero no tiene columnas. */
  catalogError: string | null;
};

const EMPTY: State = {
  stages: [],
  tags: [],
  team: [],
  board: {},
  list: [],
  page: 1,
  counts: {},
  total: 0,
  loading: true,
  error: null,
  catalogError: null,
};

export type ClientsView = "kanban" | "lista";

/**
 * Carga del tablero y del listado.
 *
 * Antes se pedían 200 expedientes de una y no había paginación en ninguna vista:
 * una columna podía anunciar 45 fichas y dibujar 12, y la barra de filtros decir
 * "312 oportunidades" sobre una tabla de 200 filas. Los contadores nunca
 * estuvieron mal —salen de una agregación sobre la cartera entera—; lo que
 * faltaba era poder llegar al resto.
 */
export function useClientsData(filters: ClientFilters, view: ClientsView) {
  const [state, setState] = useState<State>(EMPTY);

  // Se serializan para comparar por valor: un objeto nuevo en cada render
  // dispararía la recarga en bucle.
  const filterKey = JSON.stringify(filters);

  /**
   * Testigo de la petición en curso.
   *
   * Sin esto gana la respuesta que llega última, que no es necesariamente la de
   * la consulta más nueva: una respuesta lenta de "mar" pisaba los resultados de
   * "maría" y la lista dejaba de corresponder con lo que el usuario tenía escrito.
   */
  const requestId = useRef(0);

  /**
   * Espejo del estado, para leerlo dentro de un callback sin meterlo en sus
   * dependencias: si `load` dependiera de `state`, cada carga lo recrearía y el
   * efecto volvería a dispararse en bucle.
   */
  const stateRef = useRef(state);
  stateRef.current = state;

  const loadCatalogs = useCallback(async () => {
    setState((prev) => ({ ...prev, catalogError: null }));

    // Se piden por separado a propósito: que falle el catálogo de etiquetas no
    // puede dejar el tablero sin columnas. Cada uno degrada solo lo suyo.
    const [stages, tags, team] = await Promise.all([
      crmApi.stages(),
      crmApi.tags().catch(() => [] as Tag[]),
      crmApi.team().catch(() => [] as TeamMember[]),
    ]);

    setState((prev) => ({ ...prev, stages, tags, team }));
  }, []);

  const reloadCatalogs = useCallback(async () => {
    try {
      await loadCatalogs();
    } catch (caught) {
      // Antes esto era un `void loadCatalogs()` sin captura: la promesa se
      // rechazaba sin manejar, `stages` quedaba vacío y el Kanban dibujaba cero
      // columnas sin error, sin reintento y sin explicación.
      setState((prev) => ({
        ...prev,
        catalogError:
          caught instanceof ApiError
            ? caught.message
            : "No se pudieron cargar las etapas del tablero.",
      }));
    }
  }, [loadCatalogs]);

  const load = useCallback(
    async (page = 1) => {
      const parsed = JSON.parse(filterKey) as ClientFilters;
      const ticket = ++requestId.current;

      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const counts = await crmApi.stageCounts(parsed);

        if (view === "kanban") {
          // El tablero necesita las etapas para saber qué pedir. Si todavía no
          // llegaron, el efecto vuelve a correr cuando lleguen.
          const stages = stateRef.current.stages;
          const buckets = await Promise.all(
            stages.map(async (stage) => {
              const result = await crmApi.listClients({
                ...parsed,
                pipelineStageId: stage.id,
                page: 1,
                pageSize: KANBAN_PAGE_SIZE,
              });
              return [stage.id, { items: result.items, page: 1, loadingMore: false }] as const;
            }),
          );

          if (ticket !== requestId.current) return;

          setState((prev) => ({
            ...prev,
            board: Object.fromEntries(buckets),
            counts,
            total: sum(counts),
            loading: false,
          }));
          return;
        }

        const result = await crmApi.listClients({
          ...parsed,
          page,
          pageSize: LIST_PAGE_SIZE,
        });

        if (ticket !== requestId.current) return;

        setState((prev) => ({
          ...prev,
          list: result.items,
          page: result.page,
          counts,
          total: result.total,
          loading: false,
        }));
      } catch (caught) {
        if (ticket !== requestId.current) return;

        setState((prev) => ({
          ...prev,
          loading: false,
          error:
            caught instanceof ApiError
              ? caught.message
              : "No se pudo cargar la cartera. Revisá tu conexión.",
        }));
      }
    },
    [filterKey, view],
  );

  useEffect(() => {
    void reloadCatalogs();
  }, [reloadCatalogs]);

  useEffect(() => {
    // En el tablero se espera a tener las etapas: sin ellas no hay qué pedir.
    if (view === "kanban" && state.stages.length === 0) return;
    void load(1);
    // `state.stages.length` entra a propósito: es el disparador de la primera
    // carga del tablero cuando los catálogos llegan después que los filtros.
  }, [load, view, state.stages.length]);

  /** Siguiente tanda de una columna · HU-CLI-08. */
  const loadMore = useCallback(
    async (stageId: string) => {
      const parsed = JSON.parse(filterKey) as ClientFilters;
      const bucket = stateRef.current.board[stageId];
      if (!bucket || bucket.loadingMore) return;

      setState((prev) => ({
        ...prev,
        board: { ...prev.board, [stageId]: { ...bucket, loadingMore: true } },
      }));

      try {
        const next = bucket.page + 1;
        const result = await crmApi.listClients({
          ...parsed,
          pipelineStageId: stageId,
          page: next,
          pageSize: KANBAN_PAGE_SIZE,
        });

        setState((prev) => {
          const current = prev.board[stageId];
          if (!current) return prev;
          // Se filtran los repetidos: si alguien movió una ficha entre tandas, el
          // desplazamiento se corre y una podría volver a llegar.
          const known = new Set(current.items.map((c) => c.id));
          return {
            ...prev,
            board: {
              ...prev.board,
              [stageId]: {
                items: [...current.items, ...result.items.filter((c) => !known.has(c.id))],
                page: next,
                loadingMore: false,
              },
            },
          };
        });
      } catch {
        setState((prev) => {
          const current = prev.board[stageId];
          if (!current) return prev;
          return {
            ...prev,
            board: { ...prev.board, [stageId]: { ...current, loadingMore: false } },
          };
        });
      }
    },
    [filterKey],
  );

  /**
   * Refresca solo los contadores · tras mover una ficha.
   *
   * Recargar el tablero entero después de cada arrastre eran nueve peticiones
   * para un dato que ya está en pantalla: la tarjeta la reemplaza `patchClient` y
   * el optimismo la dibuja donde va. Lo único que quedó desactualizado son los
   * números de las columnas.
   */
  const refreshCounts = useCallback(async () => {
    const parsed = JSON.parse(filterKey) as ClientFilters;
    try {
      const counts = await crmApi.stageCounts(parsed);
      setState((prev) => ({
        ...prev,
        counts,
        // En la lista el total lo manda la respuesta paginada, no la suma.
        total: prev.list.length > 0 ? prev.total : sum(counts),
      }));
    } catch {
      // Un contador desfasado no justifica molestar al usuario: se corrige solo
      // en la próxima carga.
    }
  }, [filterKey]);

  /** Reemplaza un expediente ya cargado tras una acción, sin recargar todo. */
  const patchClient = useCallback((updated: ClientSummary) => {
    setState((prev) => ({
      ...prev,
      list: prev.list.map((c) => (c.id === updated.id ? updated : c)),
      board: Object.fromEntries(
        Object.entries(prev.board).map(([stageId, bucket]) => [
          stageId,
          {
            ...bucket,
            items: bucket.items.map((c) => (c.id === updated.id ? updated : c)),
          },
        ]),
      ),
    }));
  }, []);

  return {
    ...state,
    reload: () => load(state.page),
    reloadCatalogs,
    refreshCounts,
    loadMore,
    goToPage: (page: number) => load(page),
    patchClient,
  };
}

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((acc, n) => acc + n, 0);
}
