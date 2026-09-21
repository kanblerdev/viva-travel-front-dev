"use client";

import { useCallback, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
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

export type ClientsView = "kanban" | "lista";

/** Los catálogos cambian poco: media hora sin volver a pedirlos. */
const CATALOG_STALE_MS = 30 * 60 * 1000;

function message(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

/**
 * Carga del tablero y del listado · piloto de `D1`.
 *
 * Antes esto era un `useState` con once campos, un `useRef` de espejo para
 * poder leerlo dentro de los callbacks sin recrearlos, y un contador de
 * peticiones para descartar la respuesta que llegaba tarde. Las tres cosas
 * existían para resolver lo que una capa de datos resuelve sola:
 *
 *  - **La carrera.** `keepPreviousData` deja en pantalla lo anterior mientras
 *    llega lo nuevo, y la librería descarta la respuesta de una clave que ya no
 *    es la vigente. El testigo de petición desaparece.
 *  - **La caché.** Volver del expediente al tablero ya no vuelve a pedir ocho
 *    columnas: dentro de la ventana de frescura se pinta lo que hay.
 *  - **El estado.** Cargando, error y datos vienen de cada consulta, en vez de
 *    convivir en un objeto que cada camino tenía que actualizar entero.
 *
 * La API pública no cambió: las pantallas siguen recibiendo lo mismo.
 */
export function useClientsData(filters: ClientFilters, view: ClientsView) {
  const queryClient = useQueryClient();

  // Se serializa para comparar por valor: un objeto nuevo en cada render sería
  // una clave nueva en cada render, y la consulta no pararía de repetirse.
  const filterKey = JSON.stringify(filters);

  const [page, setPage] = useState(1);
  /**
   * Cuántas tandas lleva cargadas cada columna · HU-CLI-08.
   *
   * Es lo único que queda como estado local, y es el estado correcto: no es un
   * dato del servidor sino hasta dónde pidió llegar esta persona. Entra en la
   * clave de la consulta, así que "cargar más" es pedir la misma columna con un
   * lote más grande —y de paso se corrige sola si alguien movió una ficha entre
   * tandas, que antes había que filtrar a mano por id repetido—.
   */
  const [pagesByStage, setPagesByStage] = useState<Record<string, number>>({});

  /* ─────────────────────────────── Catálogos ──────────────────────────────── */

  const stagesQuery = useQuery({
    queryKey: ["pipeline-stages"],
    queryFn: () => crmApi.stages(),
    staleTime: CATALOG_STALE_MS,
  });

  // Cada uno por separado a propósito: que falle el catálogo de etiquetas no
  // puede dejar el tablero sin columnas. Cada uno degrada solo lo suyo.
  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => crmApi.tags(),
    staleTime: CATALOG_STALE_MS,
  });

  const teamQuery = useQuery({
    queryKey: ["team"],
    queryFn: () => crmApi.team(),
    staleTime: CATALOG_STALE_MS,
  });

  const stages = useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);
  const stageIds = stages.map((stage) => stage.id).join(",");

  /* ──────────────────────────────── Contadores ────────────────────────────── */

  /*
   * Del backend, no de lo cargado: una columna con 400 fichas anuncia 400
   * aunque en pantalla haya 25. Va en su propia consulta porque se invalida
   * sola después de mover una ficha, sin tocar el tablero.
   */
  const countsQuery = useQuery({
    queryKey: ["client-counts", filterKey],
    queryFn: () => crmApi.stageCounts(JSON.parse(filterKey) as ClientFilters),
    placeholderData: keepPreviousData,
  });

  const counts = useMemo(() => countsQuery.data ?? {}, [countsQuery.data]);

  /* ────────────────────────────────── Tablero ─────────────────────────────── */

  const boardQuery = useQuery({
    queryKey: ["client-board", filterKey, stageIds, pagesByStage],
    enabled: view === "kanban" && stages.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const parsed = JSON.parse(filterKey) as ClientFilters;
      const buckets = await Promise.all(
        stages.map(async (stage) => {
          const pages = pagesByStage[stage.id] ?? 1;
          const result = await crmApi.listClients({
            ...parsed,
            pipelineStageId: stage.id,
            page: 1,
            // Se vuelve a pedir desde la primera: una tanda más grande en vez de
            // ir pegando páginas. Cuesta una petición por columna al pulsar
            // "cargar más" y a cambio la columna siempre es coherente.
            pageSize: KANBAN_PAGE_SIZE * pages,
          });
          return [stage.id, { items: result.items, page: pages, loadingMore: false }] as const;
        }),
      );
      return Object.fromEntries(buckets) as Record<string, StageBucket>;
    },
  });

  /* ─────────────────────────────────── Lista ──────────────────────────────── */

  const listQuery = useQuery({
    queryKey: ["client-list", filterKey, page],
    enabled: view === "lista",
    placeholderData: keepPreviousData,
    queryFn: () =>
      crmApi.listClients({
        ...(JSON.parse(filterKey) as ClientFilters),
        page,
        pageSize: LIST_PAGE_SIZE,
      }),
  });

  /* ─────────────────────────────── Acciones ───────────────────────────────── */

  /** Siguiente tanda de una columna · HU-CLI-08. */
  const loadMore = useCallback((stageId: string) => {
    setPagesByStage((prev) => ({ ...prev, [stageId]: (prev[stageId] ?? 1) + 1 }));
  }, []);

  /**
   * Refresca solo los contadores · tras mover una ficha.
   *
   * Recargar el tablero entero después de cada arrastre eran nueve peticiones
   * para un dato que ya está en pantalla: la tarjeta la reemplaza `patchClient`
   * y el optimismo la dibuja donde va. Lo único que quedó desactualizado son
   * los números de las columnas.
   */
  const refreshCounts = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["client-counts"] });
  }, [queryClient]);

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["client-board"] });
    void queryClient.invalidateQueries({ queryKey: ["client-list"] });
    void queryClient.invalidateQueries({ queryKey: ["client-counts"] });
  }, [queryClient]);

  const reloadCatalogs = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["pipeline-stages"] });
    void queryClient.invalidateQueries({ queryKey: ["tags"] });
    void queryClient.invalidateQueries({ queryKey: ["team"] });
  }, [queryClient]);

  /**
   * Reemplaza un expediente ya cargado tras una acción, sin recargar todo.
   *
   * Se escribe en la caché en vez de en un estado propio: así la ficha corregida
   * sobrevive a cambiar de vista y volver, que antes la perdía.
   */
  const patchClient = useCallback(
    (updated: ClientSummary) => {
      queryClient.setQueriesData<Record<string, StageBucket>>(
        { queryKey: ["client-board"] },
        (board) =>
          board &&
          Object.fromEntries(
            Object.entries(board).map(([stageId, bucket]) => [
              stageId,
              {
                ...bucket,
                items: bucket.items.map((c) => (c.id === updated.id ? updated : c)),
              },
            ]),
          ),
      );

      queryClient.setQueriesData<{ items: ClientSummary[]; total: number; page: number }>(
        { queryKey: ["client-list"] },
        (result) =>
          result && {
            ...result,
            items: result.items.map((c) => (c.id === updated.id ? updated : c)),
          },
      );
    },
    [queryClient],
  );

  const goToPage = useCallback((next: number) => setPage(next), []);

  /* ─────────────────────────────── Resultado ──────────────────────────────── */

  const active = view === "kanban" ? boardQuery : listQuery;

  return {
    stages,
    tags: tagsQuery.data ?? [],
    team: teamQuery.data ?? [],
    board: boardQuery.data ?? {},
    list: listQuery.data?.items ?? [],
    page: listQuery.data?.page ?? page,
    counts,
    total: view === "lista" ? (listQuery.data?.total ?? 0) : sum(counts),
    /*
     * "Cargando" es la PRIMERA carga, no cualquier refresco: con
     * `keepPreviousData` la pantalla sigue mostrando lo anterior mientras llega
     * lo nuevo, y anunciar "Cargando…" encima de una tabla con datos solo la
     * haría parpadear.
     */
    loading: active.isPending || countsQuery.isPending,
    error: active.error ? message(active.error, "No se pudo cargar la cartera. Revisá tu conexión.") : null,
    /** Falla de catálogos. Va aparte: sin etapas el tablero no tiene columnas. */
    catalogError: stagesQuery.error
      ? message(stagesQuery.error, "No se pudieron cargar las etapas del tablero.")
      : null,
    reload,
    reloadCatalogs,
    refreshCounts,
    loadMore,
    goToPage,
    patchClient,
  };
}

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((acc, n) => acc + n, 0);
}
