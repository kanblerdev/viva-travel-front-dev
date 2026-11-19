"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { crmApi, type ConversationFilters, type ConversationSummary } from "@/lib/api/crm";
import { usePolling } from "@/lib/hooks/usePolling";

/** Chats por tanda: la primera pantalla y cada scroll. */
export const CONVERSATION_PAGE_SIZE = 20;

type FeedFilters = Pick<ConversationFilters, "view" | "channel" | "status" | "advisorId" | "search">;
type Cursor = { before: string; beforeId: string };

/**
 * La lista de la bandeja: por tandas y con actualización por cambios.
 *
 *  - Arranca con 20 chats. Al llegar al final de la lista se pide la tanda
 *    siguiente, por POSICIÓN (`nextCursor`) y no por "saltar N": cuando entra un
 *    mensaje, ese chat sube y los demás se corren, y con `skip` la tanda
 *    siguiente repetía uno o se salteaba otro.
 *  - Cada `pollMs` NO se vuelve a pedir la lista: se pide lo que cambió desde la
 *    última vez (`/conversations/cambios`). Antes, quien había bajado hasta 300
 *    chats pedía los 300 cada diez segundos.
 *
 * Un cambio de filtro descarta todo y vuelve a la primera tanda. Las respuestas
 * que llegan tarde, de un filtro anterior, se ignoran.
 */
export function useConversationFeed(filters: FeedFilters, enabled: boolean, pollMs: number) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = JSON.stringify(filters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  /** Cambia con cada filtro: invalida las respuestas en vuelo del anterior. */
  const generation = useRef({ key, n: 0 });
  const since = useRef<string | null>(null);
  const cursor = useRef<Cursor | null>(null);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);

  // Otro filtro: se vacía en el acto. Mostrar la lista anterior mientras llega
  // la nueva haría creer que el filtro no hizo nada.
  if (generation.current.key !== key) {
    generation.current = { key, n: generation.current.n + 1 };
    since.current = null;
    cursor.current = null;
    hasMoreRef.current = false;
    loadingMoreRef.current = false;
    if (items !== null) setItems(null);
    if (hasMore) setHasMore(false);
    if (loadingMore) setLoadingMore(false);
  }

  const loadFirst = useCallback(async () => {
    const gen = generation.current.n;
    try {
      const page = await crmApi.listConversations({
        ...filtersRef.current,
        pageSize: CONVERSATION_PAGE_SIZE,
      });
      if (gen !== generation.current.n) return;
      since.current = page.nextSince;
      cursor.current = page.nextCursor;
      hasMoreRef.current = page.hasMore;
      setItems(page.items);
      setHasMore(page.hasMore);
      setError(null);
    } catch (caught) {
      if (gen !== generation.current.n) return;
      setError(caught instanceof ApiError ? caught.message : "No se pudo cargar la bandeja.");
    }
  }, []);

  /** La tarea periódica: la primera tanda si no hay nada, o solo los cambios. */
  const refresh = useCallback(async () => {
    if (since.current === null) {
      await loadFirst();
      return;
    }
    const gen = generation.current.n;
    try {
      const changes = await crmApi.conversationChanges({
        ...filtersRef.current,
        since: since.current,
      });
      if (gen !== generation.current.n) return;
      if (changes.reset) {
        await loadFirst();
        return;
      }
      since.current = changes.nextSince;
      setItems((current) =>
        current
          ? applyChanges(current, changes.items, changes.removedIds, hasMoreRef.current)
          : current,
      );
      setError(null);
    } catch (caught) {
      if (gen !== generation.current.n) return;
      setError(caught instanceof ApiError ? caught.message : "No se pudo actualizar la bandeja.");
    }
  }, [loadFirst]);

  usePolling(refresh, pollMs, enabled, key);

  const loadMore = useCallback(async () => {
    const next = cursor.current;
    if (!next || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const gen = generation.current.n;
    try {
      const page = await crmApi.listConversations({
        ...filtersRef.current,
        pageSize: CONVERSATION_PAGE_SIZE,
        ...next,
      });
      if (gen !== generation.current.n) return;
      cursor.current = page.nextCursor;
      hasMoreRef.current = page.hasMore;
      setItems((current) => sortFeed(mergeById(current ?? [], page.items)));
      setHasMore(page.hasMore);
    } catch (caught) {
      if (gen !== generation.current.n) return;
      setError(caught instanceof ApiError ? caught.message : "No se pudieron cargar más chats.");
    } finally {
      if (gen === generation.current.n) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, []);

  /** Un chat que cambió desde el hilo (tomado, resuelto…): se ve en el acto. */
  const replace = useCallback(
    (updated: ConversationSummary) => {
      setItems((current) =>
        current ? current.map((item) => (item.id === updated.id ? updated : item)) : current,
      );
      void refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    (id: string) => {
      setItems((current) => (current ? current.filter((item) => item.id !== id) : current));
      void refresh();
    },
    [refresh],
  );

  return { items, hasMore, loadingMore, error, loadMore, refresh, replace, remove };
}

/* ─────────────────────────────── Reglas puras ─────────────────────────────── */

/** El orden de la bandeja: último mensaje primero; el id desempata. */
function compareFeed(a: ConversationSummary, b: ConversationSummary): number {
  if (a.lastMessageAt !== b.lastMessageAt) return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function sortFeed(items: ConversationSummary[]): ConversationSummary[] {
  return [...items].sort(compareFeed);
}

function mergeById(
  current: ConversationSummary[],
  incoming: ConversationSummary[],
): ConversationSummary[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

/**
 * Aplica los cambios a la lista cargada.
 *
 * Un chat cambiado que NO estaba cargado entra solo si cae dentro del tramo ya
 * visible. Si cae más abajo, todavía no se llegó hasta ahí con el scroll, y
 * meterlo dejaría un chat suelto fuera de orden: va a llegar con su tanda.
 */
export function applyChanges(
  current: ConversationSummary[],
  changed: ConversationSummary[],
  removedIds: string[],
  hasMore: boolean,
): ConversationSummary[] {
  const removed = new Set(removedIds);
  const kept = current.filter((item) => !removed.has(item.id));
  const loaded = new Set(kept.map((item) => item.id));
  const last = kept[kept.length - 1];

  const accepted = changed.filter(
    (item) => loaded.has(item.id) || !hasMore || !last || compareFeed(item, last) <= 0,
  );
  return sortFeed(mergeById(kept, accepted));
}
