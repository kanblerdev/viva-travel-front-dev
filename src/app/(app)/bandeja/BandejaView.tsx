"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useSession, type SessionUser } from "@/lib/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import {
  crmApi,
  DUPLICATE_REASON_LABEL,
  formatMoney,
  relativeTime,
  type ConversationCounts,
  type ConversationDetail,
  type ConversationSummary,
  type ConversationView,
  type InboxMessage,
  type MessagingConnection,
  type SendableTemplate,
  type TeamMember,
} from "@/lib/api/crm";
import { BACKOFFICE_URL } from "@/lib/session";
import {
  CHANNEL_LABEL,
  CHANNELS,
  CONVERSATION_STATUS_LABEL,
  QUOTE_STATUS_LABEL,
  SALE_STATUS_LABEL,
  WHATSAPP_WINDOW_HOURS,
  type Channel,
} from "@/lib/domain/enums";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { usePolling } from "@/lib/hooks/usePolling";
import { AssignConversationModal, TransferConversationModal } from "./modals";

const CHANNEL_CLASS: Record<Channel, string> = {
  whatsapp: "wa",
  messenger: "ms",
  instagram: "ig",
};

const CHANNEL_DOT: Record<Channel, string> = {
  whatsapp: "var(--green)",
  messenger: "var(--blue)",
  instagram: "var(--purple)",
};

const VIEW_LABEL: Record<ConversationView, string> = {
  unassigned: "Sin asignar",
  mine: "Míos",
  all: "Todas",
};

const VIEWS = Object.keys(VIEW_LABEL) as ConversationView[];

const STATUS_FILTERS = ["open", "resolved"] as const;

/**
 * Cada cuánto se refrescan la lista y el hilo abierto.
 *
 * Diez segundos es "casi en tiempo real" para una conversación de ventas, y a
 * la vez es poco tráfico: una consulta de lista y una de hilo por pestaña visible.
 */
const POLL_MS = 10_000;
const PAGE_SIZE = 50;
/** La conexión con Meta cambia muy de vez en cuando: basta con mirarla cada minuto. */
const CONNECTION_POLL_MS = 60_000;

/**
 * Bandeja de mensajería unificada · wireframe 06 · HU-MSG-02 a HU-MSG-13.
 *
 * Los filtros y la conversación abierta viven en la URL, como en Cotizaciones y
 * Ventas: el expediente enlaza directo a una conversación (HU-EXP-05), volver
 * atrás conserva la vista y un enlace se puede compartir con un compañero.
 */
export function BandejaView() {
  const { user } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const view = (VIEWS.find((v) => v === params.get("vista")) ?? "unassigned") as ConversationView;
  const channel = CHANNELS.find((c) => c === params.get("canal"));
  const selectedId = params.get("conversacion");
  // Estado y asesor solo aplican a "Todas": las otras dos pestañas ya los fijan.
  const status = view === "all" ? STATUS_FILTERS.find((f) => f === params.get("estado")) : undefined;
  const advisorId = view === "all" ? (params.get("asesor") ?? undefined) : undefined;

  const [search, setSearch] = useState(params.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [list, setList] = useState<{ items: ConversationSummary[]; total: number } | null>(null);
  const [counts, setCounts] = useState<ConversationCounts | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [connection, setConnection] = useState<MessagingConnection | null>(null);

  // Si falla, no se muestra ningún aviso: el aviso ayuda a leer la bandeja, y
  // una bandeja que funciona no puede taparse por no poder explicarse.
  usePolling(
    async () => {
      const next = await crmApi.messagingConnection().catch(() => null);
      if (next) setConnection(next);
    },
    CONNECTION_POLL_MS,
    Boolean(user),
  );

  useEffect(() => {
    // Solo alimenta el filtro por asesor: si falla, el filtro no aparece.
    crmApi.team().then(setTeam).catch(() => undefined);
  }, []);

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // La búsqueda viaja a la URL recién cuando deja de escribirse.
  useEffect(() => {
    if ((params.get("q") ?? "") !== debouncedSearch) setParams({ q: debouncedSearch || null });
  }, [debouncedSearch, params, setParams]);

  // Otra pestaña o filtro: la lista vuelve a la primera tanda.
  useEffect(() => setLimit(PAGE_SIZE), [view, channel, status, advisorId, debouncedSearch]);

  const loadList = useCallback(async () => {
    try {
      const [page, nextCounts] = await Promise.all([
        crmApi.listConversations({
          view,
          channel,
          status,
          advisorId,
          search: debouncedSearch || undefined,
          pageSize: limit,
        }),
        crmApi.conversationCounts(),
      ]);
      setList({ items: page.items, total: page.total });
      setCounts(nextCounts);
      setListError(null);
    } catch (caught) {
      setListError(
        caught instanceof ApiError ? caught.message : "No se pudo cargar la bandeja.",
      );
    }
  }, [view, channel, status, advisorId, debouncedSearch, limit]);

  // Cambiar un filtro vacía la lista en el acto: mostrar la anterior mientras
  // llega la nueva haría creer que el filtro no hizo nada.
  useEffect(() => setList(null), [view, channel, status, advisorId, debouncedSearch]);

  usePolling(loadList, POLL_MS, Boolean(user), loadList);

  const select = (id: string | null) => {
    setShowContext(false);
    setParams({ conversacion: id });
  };

  // Estable a propósito: el hilo lo usa dentro de efectos, y una función nueva en
  // cada refresco de la lista los volvería a disparar.
  const handleChanged = useCallback(
    (updated: ConversationSummary) => {
      setList((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      );
      void loadList();
    },
    [loadList],
  );

  const disconnected = Boolean(connection && connection.status !== "connected");

  return (
    <>
      {connection && disconnected && (
        <ConnectionNotice connection={connection} isAdmin={user?.role === "admin"} />
      )}
      <div
        className={`inbox${disconnected ? " with-notice" : ""}`}
        data-pane={selectedId ? "thread" : "list"}
        data-ctx={showContext ? "open" : "closed"}
      >
        {/* Columna izquierda · lista de conversaciones */}
        <div className="inbox-panel list-panel">
          <div className="inbox-tabs" role="group" aria-label="Vista de la bandeja">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setParams({ vista: v === "unassigned" ? null : v })}
              >
                {VIEW_LABEL[v]}
                {counts ? ` · ${v === "unassigned" ? counts.unassigned : v === "mine" ? counts.mine : counts.all}` : ""}
              </button>
            ))}
          </div>

          <div className="inbox-filters">
            <label className="sr-only" htmlFor="inboxSearch">
              Buscar contacto
            </label>
            <input
              id="inboxSearch"
              className="input"
              type="search"
              placeholder="Nombre, teléfono o usuario…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <label className="sr-only" htmlFor="inboxChannel">
              Canal
            </label>
            <select
              id="inboxChannel"
              className="input"
              value={channel ?? ""}
              onChange={(event) => setParams({ canal: event.target.value || null })}
            >
              <option value="">Todos los canales</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
            {view === "all" && (
              <>
                <label className="sr-only" htmlFor="inboxStatus">
                  Estado
                </label>
                <select
                  id="inboxStatus"
                  className="input"
                  value={status ?? ""}
                  onChange={(event) => setParams({ estado: event.target.value || null })}
                >
                  <option value="">Abiertas y resueltas</option>
                  <option value="open">Solo abiertas</option>
                  <option value="resolved">Solo resueltas</option>
                </select>
                <label className="sr-only" htmlFor="inboxAdvisor">
                  Asesor
                </label>
                <select
                  id="inboxAdvisor"
                  className="input"
                  value={advisorId ?? ""}
                  onChange={(event) => setParams({ asesor: event.target.value || null })}
                >
                  <option value="">Cualquier asesor</option>
                  {team.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.fullName}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          <div className="inbox-list">
            {listError && (
              <div className="inbox-empty" role="alert">
                <span style={{ color: "var(--red)" }}>{listError}</span>
                <button type="button" className="btn ghost tiny" onClick={() => void loadList()}>
                  Reintentar
                </button>
              </div>
            )}

            {!list && !listError && <div className="inbox-empty">Cargando conversaciones…</div>}

            {list?.items.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                selected={conversation.id === selectedId}
                user={user}
                onSelect={() => select(conversation.id)}
              />
            ))}

            {list && list.items.length === 0 && (
              <div className="inbox-empty">
                {emptyMessage(view, Boolean(debouncedSearch || channel || status || advisorId))}
              </div>
            )}

            {list && list.items.length < list.total && (
              <div style={{ padding: 12, textAlign: "center" }}>
                <button
                  type="button"
                  className="btn ghost tiny"
                  onClick={() => setLimit((current) => current + PAGE_SIZE)}
                >
                  Cargar más · quedan {list.total - list.items.length}
                </button>
              </div>
            )}
          </div>
        </div>

        {selectedId ? (
          <ConversationPanes
            key={selectedId}
            conversationId={selectedId}
            user={user}
            showContext={showContext}
            onToggleContext={() => setShowContext((open) => !open)}
            onBack={() => select(null)}
            onChanged={handleChanged}
          />
        ) : (
          <div className="inbox-panel thread-panel">
            <div className="inbox-empty" style={{ margin: "auto" }}>
              <Icon name="mail" width={28} height={28} style={{ color: "var(--text-faint)" }} />
              Elegí una conversación de la lista para ver el hilo.
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const CONNECTION_COPY: Record<
  Exclude<MessagingConnection["status"], "connected">,
  { title: string; body: string; tone: "info" | "error" }
> = {
  not_configured: {
    title: "La mensajería todavía no está conectada con Meta.",
    body: "Cuando se registren las cuentas de WhatsApp, Messenger e Instagram, las conversaciones van a llegar acá solas. Mientras tanto la bandeja queda vacía.",
    tone: "info",
  },
  pending: {
    title: "Las cuentas de Meta están registradas pero todavía no llegó ningún mensaje.",
    body: "Falta verificar la conexión o suscribir el webhook en la consola de Meta.",
    tone: "info",
  },
  error: {
    title: "La conexión con Meta está fallando.",
    body: "La última verificación de las cuentas dio error, así que los mensajes nuevos podrían no estar llegando.",
    tone: "error",
  },
};

/**
 * Por qué la bandeja está vacía · decisión del 16 sep 2026.
 *
 * La bandeja se publica aunque Meta no esté conectada. Sin este aviso, un equipo
 * que la abre en su primera semana ve una pantalla vacía y concluye que el CRM no
 * funciona. El Administrador recibe además el camino para arreglarlo.
 */
function ConnectionNotice({
  connection,
  isAdmin,
}: {
  connection: MessagingConnection;
  isAdmin: boolean;
}) {
  if (connection.status === "connected") return null;
  const copy = CONNECTION_COPY[connection.status];

  return (
    <div className={`auth-alert ${copy.tone} inbox-notice`} role="status">
      <Icon name={copy.tone === "error" ? "target" : "globe"} />
      <div>
        <b>{copy.title}</b> {copy.body}{" "}
        {isAdmin ? (
          <a href={`${BACKOFFICE_URL}/integraciones`} target="_blank" rel="noreferrer">
            Ir a Integraciones
          </a>
        ) : (
          "Si tenés dudas, consultalo con el Administrador."
        )}
      </div>
    </div>
  );
}

function emptyMessage(view: ConversationView, filtered: boolean): string {
  if (filtered) return "Ninguna conversación coincide con los filtros elegidos.";
  if (view === "unassigned") {
    return "No hay conversaciones esperando. Cuando un cliente escriba por WhatsApp, Messenger o Instagram, aparece acá hasta que alguien la tome.";
  }
  if (view === "mine") return "No tenés conversaciones abiertas a tu cargo.";
  return "Todavía no llegó ninguna conversación.";
}

/* ──────────────────────────────── Fila ────────────────────────────────────── */

function ConversationRow({
  conversation,
  selected,
  user,
  onSelect,
}: {
  conversation: ConversationSummary;
  selected: boolean;
  user: SessionUser | null;
  onSelect: () => void;
}) {
  const name = conversation.client?.fullName ?? "Contacto sin expediente";
  const mine = conversation.advisor?.id === user?.id;

  return (
    <button
      type="button"
      className="inbox-item"
      // `aria-current` y no `aria-selected`: un botón no admite el segundo.
      aria-current={selected ? "true" : undefined}
      aria-label={`${name}, ${CHANNEL_LABEL[conversation.channel]}${conversation.unreadCount ? `, ${conversation.unreadCount} sin leer` : ""}`}
      onClick={onSelect}
    >
      <span className="av">
        {conversation.client?.initials ?? "··"}
        <span className="dot" style={{ background: CHANNEL_DOT[conversation.channel] }} />
      </span>
      <span className="body">
        <span className="top">
          <span className="nm">{name}</span>
          <time className="tm" dateTime={conversation.lastMessageAt} title={absolute(conversation.lastMessageAt)}>
            {relativeTime(conversation.lastMessageAt)}
          </time>
        </span>
        <span className="prev">{conversation.lastMessagePreview ?? "—"}</span>
        <span className="inbox-item-tags">
          {!conversation.advisor && conversation.status !== "resolved" && (
            <span className="chip amber">Sin asignar</span>
          )}
          {conversation.advisor && !mine && conversation.status !== "resolved" && (
            <span className="chip navy">{conversation.advisor.fullName}</span>
          )}
          {conversation.status === "resolved" && <span className="chip green">Resuelta</span>}
          {/* El contador solo significa algo para quien la atiende: es lo que
              esa persona no leyó. */}
          {conversation.unreadCount > 0 && (mine || !conversation.advisor) && (
            <span className="inbox-unread">{conversation.unreadCount}</span>
          )}
        </span>
      </span>
    </button>
  );
}

/* ─────────────────────────── Hilo y contexto ──────────────────────────────── */

function ConversationPanes({
  conversationId,
  user,
  showContext,
  onToggleContext,
  onBack,
  onChanged,
}: {
  conversationId: string;
  user: SessionUser | null;
  showContext: boolean;
  onToggleContext: () => void;
  onBack: () => void;
  onChanged: (updated: ConversationSummary) => void;
}) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [assigning, setAssigning] = useState(false);
  // Una vez que la persona pidió mensajes anteriores, "hay más" lo decide esa
  // paginación y no el refresco de la página más reciente.
  const loadedOlder = useRef(false);

  /**
   * Refresco periódico: el detalle y la página más reciente de mensajes.
   *
   * Los mensajes se MEZCLAN por id con los ya cargados en vez de reemplazarlos:
   * si la persona subió a leer mensajes viejos, el refresco no se los puede
   * sacar de la pantalla.
   */
  const refresh = useCallback(async () => {
    try {
      const [nextDetail, latest] = await Promise.all([
        crmApi.getConversation(conversationId),
        crmApi.conversationMessages(conversationId),
      ]);
      setDetail(nextDetail);
      setMessages((current) => mergeMessages(current, latest.items));
      if (!loadedOlder.current) setHasMore(latest.hasMore);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 404
          ? "Esta conversación ya no existe."
          : "No se pudo cargar la conversación.",
      );
    }
  }, [conversationId]);

  usePolling(refresh, POLL_MS);

  // Quien la atiende la abre: se apaga su contador. Otro que mira, no.
  useEffect(() => {
    if (!detail || !user || detail.unreadCount === 0 || detail.advisor?.id !== user.id) return;
    crmApi
      .markConversationRead(detail.id)
      .then((updated) => {
        setDetail((current) => (current ? { ...current, unreadCount: updated.unreadCount } : current));
        onChanged(updated);
      })
      .catch(() => undefined);
  }, [detail, user, onChanged]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const page = await crmApi.conversationMessages(conversationId, {
        before: oldest.occurredAt,
        beforeId: oldest.id,
      });
      loadedOlder.current = true;
      setMessages((current) => mergeMessages(page.items, current));
      setHasMore(page.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function run(action: () => Promise<ConversationSummary>) {
    setBusy(true);
    setActionError(null);
    try {
      onChanged(await action());
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "No se pudo completar la acción.");
      // Un 409 dice que el estado cambió: se muestra el real.
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="inbox-panel thread-panel">
        <div className="inbox-empty" style={{ margin: "auto" }}>
          <span style={{ color: "var(--red)" }}>{error}</span>
          <button type="button" className="btn ghost tiny" onClick={onBack}>
            Volver a la lista
          </button>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="inbox-panel thread-panel">
        <div className="inbox-empty" style={{ margin: "auto" }}>
          Cargando conversación…
        </div>
      </div>
    );
  }

  const isManager = user?.role === "admin" || user?.role === "manager";
  const attendsIt = Boolean(user && detail.advisor?.id === user.id);
  // Espejo de la matriz 4.2; el backend lo vuelve a comprobar en cada acción.
  const canHandle = isManager || attendsIt;
  const name = detail.client?.fullName ?? "Contacto sin expediente";

  return (
    <>
      <div className="inbox-panel thread-panel">
        <div className="thread-head">
          <button type="button" className="iconbtn inbox-back" aria-label="Volver a la lista" onClick={onBack}>
            <Icon name="arrow-right" style={{ transform: "rotate(180deg)" }} />
          </button>
          <span className="avatar o1">{detail.client?.initials ?? "··"}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="thread-title">
              <b>{name}</b>
              <span className={`chip ${CHANNEL_CLASS[detail.channel]}`}>{CHANNEL_LABEL[detail.channel]}</span>
            </div>
            <div className="thread-sub">
              {CONVERSATION_STATUS_LABEL[detail.status]}
              {" · "}
              {detail.advisor ? `Atiende ${attendsIt ? "vos" : detail.advisor.fullName}` : "Sin asignar"}
            </div>
          </div>

          <div className="thread-actions">
            {!detail.advisor && (
              <button
                type="button"
                className="btn primary tiny"
                disabled={busy}
                onClick={() => void run(() => crmApi.takeConversation(detail.id))}
              >
                <Icon name="check" />
                Tomar
              </button>
            )}
            {canHandle && detail.advisor && (
              <button type="button" className="btn ghost tiny" disabled={busy} onClick={() => setTransferring(true)}>
                <Icon name="arrow-right" />
                Transferir
              </button>
            )}
            {isManager && (
              <button type="button" className="btn ghost tiny" disabled={busy} onClick={() => setAssigning(true)}>
                <Icon name="users" />
                Reasignar
              </button>
            )}
            {canHandle && detail.advisor && detail.status !== "resolved" && (
              <button
                type="button"
                className="btn ghost tiny"
                disabled={busy}
                onClick={() => void run(() => crmApi.resolveConversation(detail.id))}
              >
                <Icon name="check" />
                Resolver
              </button>
            )}
            <button type="button" className="btn ghost tiny inbox-ctx-toggle" onClick={onToggleContext}>
              <Icon name="folder" />
              {showContext ? "Ver hilo" : "Cliente"}
            </button>
          </div>
        </div>

        {actionError && (
          <div className="auth-alert error dismissable thread-alert" role="alert">
            <Icon name="target" />
            <div>{actionError}</div>
            <button type="button" className="iconbtn" aria-label="Cerrar aviso" onClick={() => setActionError(null)}>
              <Icon name="x" />
            </button>
          </div>
        )}

        <div className="thread-body" aria-live="polite">
          {hasMore && (
            <button
              type="button"
              className="btn ghost tiny"
              style={{ alignSelf: "center" }}
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? "Cargando…" : "Ver mensajes anteriores"}
            </button>
          )}
          {messages.length === 0 && <span className="thread-daysep">Sin mensajes todavía</span>}
          {withDaySeparators(messages).map((entry) =>
            entry.kind === "day" ? (
              <span key={entry.key} className="thread-daysep">
                {entry.label}
              </span>
            ) : (
              <MessageBubble key={entry.message.id} message={entry.message} />
            ),
          )}
        </div>

        <Composer
          conversation={detail}
          onSent={(message) => setMessages((current) => mergeMessages(current, [message]))}
        />
      </div>

      <div className="inbox-panel ctx-panel">
        <ContextPanel detail={detail} onClose={onToggleContext} />
      </div>

      {transferring && (
        <TransferConversationModal
          conversation={detail}
          onClose={() => setTransferring(false)}
          onDone={(updated) => {
            setTransferring(false);
            onChanged(updated);
            void refresh();
          }}
        />
      )}

      {assigning && (
        <AssignConversationModal
          conversation={detail}
          onClose={() => setAssigning(false)}
          onDone={(updated) => {
            setAssigning(false);
            onChanged(updated);
            void refresh();
          }}
        />
      )}
    </>
  );
}

/** Une dos tandas de mensajes sin repetir y en orden cronológico. */
function mergeMessages(first: InboxMessage[], second: InboxMessage[]): InboxMessage[] {
  const byId = new Map<string, InboxMessage>();
  for (const message of [...first, ...second]) byId.set(message.id, message);
  return [...byId.values()].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
  );
}

type ThreadEntry =
  | { kind: "day"; key: string; label: string }
  | { kind: "message"; message: InboxMessage };

function withDaySeparators(messages: InboxMessage[]): ThreadEntry[] {
  const entries: ThreadEntry[] = [];
  let lastDay = "";
  for (const message of messages) {
    const date = new Date(message.occurredAt);
    const day = date.toDateString();
    if (day !== lastDay) {
      entries.push({ kind: "day", key: `day-${day}`, label: dayLabel(date) });
      lastDay = day;
    }
    entries.push({ kind: "message", message });
  }
  return entries;
}

function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Hoy";
  if (date.toDateString() === yesterday.toDateString()) return "Ayer";
  return date.toLocaleDateString("es-SV", { weekday: "long", day: "numeric", month: "long" });
}

function absolute(iso: string): string {
  return new Date(iso).toLocaleString("es-SV", { dateStyle: "medium", timeStyle: "short" });
}

const MEDIA_LABEL: Record<NonNullable<InboxMessage["media"]>["kind"], string> = {
  image: "Imagen",
  video: "Video",
  audio: "Audio",
  sticker: "Sticker",
  document: "Documento",
};

const DELIVERY_MARK: Partial<Record<InboxMessage["deliveryStatus"], string>> = {
  sent: " ✓",
  delivered: " ✓✓",
  read: " ✓✓",
  queued: " · enviando…",
};

/**
 * El motivo del fallo, dicho para quien atiende.
 *
 * Los errores de configuración llegan del servidor con el nombre de la variable
 * que falta: preciso para quien despliega, inútil para un asesor que solo
 * quiere saber si puede hacer algo. Se traducen a una acción concreta y el
 * texto técnico queda en el `title`, al alcance de quien lo necesite.
 */
function failureNote(reason: string | null): string {
  if (!reason) return "No se envió";
  if (/no está definida en el servidor|META_[A-Z_]+/.test(reason)) {
    return "No se envió · falta conectar WhatsApp, avisale al administrador";
  }
  if (/no respondió|tiempo/i.test(reason)) return "No se envió · Meta no respondió a tiempo";
  if (/límite|rate/i.test(reason)) return "No se envió · demasiados envíos seguidos, probá en un momento";
  return `No se envió · ${reason}`;
}

function MessageBubble({ message }: { message: InboxMessage }) {
  if (message.messageType === "system") {
    return <span className="thread-system">{message.text}</span>;
  }

  const time = new Date(message.occurredAt).toLocaleTimeString("es-SV", {
    hour: "2-digit",
    minute: "2-digit",
  });

  /*
   * Un saliente que NO salió se marca en la burbuja, no solo en el aviso del
   * cuadro de respuesta: ese aviso se va con la siguiente pulsación y el
   * mensaje se queda en el hilo idéntico a uno entregado. El asesor creería
   * que el cliente lo recibió, que es justo lo que no puede pasar en un hilo
   * de atención.
   */
  const failed = message.direction === "outbound" && message.deliveryStatus === "failed";

  const bubble = (
    <div
      className={`bubble ${message.direction === "inbound" ? "in" : "out"}${failed ? " failed" : ""}`}
    >
      {message.media && (
        <div className="bubble-media">
          <Icon name={message.media.kind === "document" ? "paperclip" : "image"} />
          <span>
            {MEDIA_LABEL[message.media.kind]}
            {message.media.filename ? `: ${message.media.filename}` : ""}
          </span>
          {message.media.temporaryUrl ? (
            <a href={message.media.temporaryUrl} target="_blank" rel="noreferrer">
              Abrir
            </a>
          ) : (
            // Los adjuntos de WhatsApp se descargan con el token de Meta: la
            // descarga llega con el envío (DM-10).
            <span className="bubble-media-note">vista previa no disponible todavía</span>
          )}
        </div>
      )}
      {message.text && <span style={{ whiteSpace: "pre-wrap" }}>{message.text}</span>}
      <time className="meta" dateTime={message.occurredAt} title={absolute(message.occurredAt)}>
        {time}
        {message.direction === "outbound" && (DELIVERY_MARK[message.deliveryStatus] ?? "")}
        {message.sentOutsideCrm && " · enviado fuera del CRM"}
        {message.sentBy && ` · ${message.sentBy.fullName}`}
      </time>
    </div>
  );

  // La nota del fallo va FUERA de la burbuja: dentro, su largo decidía el ancho
  // del mensaje y un error de dos líneas hacía la burbuja más grande que
  // cualquier respuesta enviada con éxito.
  if (!failed) return bubble;

  return (
    <div className="bubble-failed-wrap">
      {bubble}
      <span className="bubble-failed" title={message.failureReason ?? undefined}>
        <Icon name="target" width={10} height={10} />
        <span>{failureNote(message.failureReason)}</span>
      </span>
    </div>
  );
}

/* ────────────────────────────── Respuesta ─────────────────────────────────── */

/**
 * Cuadro de respuesta · HU-MSG-10 y HU-MSG-12.
 *
 * El envío NO es optimista a propósito. El mensaje aparece en el hilo cuando el
 * backend confirma que lo guardó, porque el resultado que importa —enviado,
 * entregado o fallido— solo lo sabe él. Pintarlo antes obligaría a despintarlo
 * ante un rechazo de Meta, y un mensaje que se borra solo es peor que uno que
 * tarda medio segundo en aparecer.
 *
 * Un 201 con `failed` NO es un error de la petición: el mensaje entra al hilo
 * con su motivo a la vista. Solo la ventana cerrada (409) se muestra como aviso.
 */
function Composer({
  conversation,
  onSent,
}: {
  conversation: ConversationDetail;
  onSent: (message: InboxMessage) => void;
}) {
  const replyWindow = useMemo(() => windowState(conversation), [conversation]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingTemplate, setUsingTemplate] = useState(false);

  const canSend = replyWindow.open && text.trim().length > 0 && !sending;

  /*
   * Con la ventana cerrada, WhatsApp solo acepta una plantilla aprobada. Es el
   * único camino que queda, así que el cuadro se convierte en el selector en vez
   * de dejar un campo deshabilitado que no explica qué hacer.
   */
  const windowClosed = conversation.channel === "whatsapp" && !replyWindow.open;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const message = await crmApi.sendConversationMessage(conversation.id, text.trim());
      setText("");
      onSent(message);
      if (message.deliveryStatus === "failed") {
        setError(message.failureReason ?? "Meta rechazó el envío.");
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "No se pudo enviar. Revisá la conexión y probá de nuevo.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="composer">
      <div className="window">
        {conversation.channel === "whatsapp" ? (
          replyWindow.open ? (
            <>
              <span className="ok">● Ventana de {WHATSAPP_WINDOW_HOURS} h abierta</span>
              <span style={{ color: "var(--text-mute)", fontWeight: 500 }}>
                Respuesta libre permitida · cierra en {replyWindow.remaining}
              </span>
            </>
          ) : (
            <>
              <span className="closed">● Ventana de {WHATSAPP_WINDOW_HOURS} h cerrada</span>
              <span style={{ color: "var(--text-mute)", fontWeight: 500 }}>
                Solo se puede escribir con una plantilla aprobada
              </span>
            </>
          )
        ) : (
          <span style={{ color: "var(--text-mute)", fontWeight: 500 }}>
            {CHANNEL_LABEL[conversation.channel]} · lo que se responda desde Meta Business Suite aparece en este hilo
          </span>
        )}
      </div>

      {error && (
        <div className="composer-error" role="alert">
          <Icon name="target" width={12} height={12} />
          <span>{error}</span>
        </div>
      )}

      {windowClosed && usingTemplate ? (
        <TemplatePicker
          conversationId={conversation.id}
          onCancel={() => setUsingTemplate(false)}
          onSent={(message) => {
            setUsingTemplate(false);
            onSent(message);
            if (message.deliveryStatus === "failed") {
              setError(message.failureReason ?? "Meta rechazó el envío.");
            }
          }}
        />
      ) : windowClosed ? (
        <button
          type="button"
          className="composer-template-cta"
          onClick={() => {
            setError(null);
            setUsingTemplate(true);
          }}
        >
          <Icon name="doc" width={14} height={14} />
          Escribir con una plantilla aprobada
        </button>
      ) : (
        <div className="row">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter manda; Shift+Enter se reserva para cuando el campo crezca.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            disabled={!replyWindow.open || sending}
            maxLength={4096}
            placeholder="Escribí tu respuesta…"
            aria-label="Mensaje"
          />
          <button
            type="button"
            className={sending ? "send is-sending" : "send"}
            aria-label={sending ? "Enviando" : "Enviar"}
            onClick={() => void send()}
            disabled={!canSend}
          >
            <Icon name="arrow-right" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Plantilla con la ventana cerrada ─────────────────── */

/**
 * Selector de plantilla HSM · HU-HSM-04.
 *
 * Solo aparece con la ventana de 24 h cerrada, porque es el único momento en que
 * hace falta: dentro de la ventana el texto libre es más rápido y no consume una
 * plantilla.
 *
 * La vista previa se arma con los valores que se van escribiendo. Un mensaje
 * fuera de ventana reabre una conversación fría y cuesta dinero; que el asesor
 * lea exactamente lo que va a salir antes de pulsar enviar evita el mensaje con
 * el nombre de otro cliente.
 */
function TemplatePicker({
  conversationId,
  onCancel,
  onSent,
}: {
  conversationId: string;
  onCancel: () => void;
  onSent: (message: InboxMessage) => void;
}) {
  const [templates, setTemplates] = useState<SendableTemplate[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    crmApi
      .conversationTemplates(conversationId)
      .then((response) => {
        if (!alive) return;
        setTemplates(response.items);
        const first = response.items[0];
        if (first) {
          setSelectedId(first.id);
          setValues(first.variables.map(() => ""));
        }
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setTemplates([]);
        setError(
          caught instanceof ApiError
            ? caught.message
            : "No se pudieron cargar las plantillas.",
        );
      });
    return () => {
      alive = false;
    };
  }, [conversationId]);

  const selected = templates?.find((template) => template.id === selectedId) ?? null;
  const complete = Boolean(selected) && values.every((value) => value.trim().length > 0);

  async function send() {
    if (!selected || !complete || sending) return;
    setSending(true);
    setError(null);
    try {
      onSent(
        await crmApi.sendConversationTemplate(
          conversationId,
          selected.id,
          values.map((value) => value.trim()),
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "No se pudo enviar. Revisá la conexión y probá de nuevo.",
      );
      setSending(false);
    }
  }

  if (templates === null) {
    return <div className="composer-template">Buscando plantillas aprobadas…</div>;
  }

  if (templates.length === 0) {
    return (
      <div className="composer-template">
        <p>
          <b>No hay ninguna plantilla aprobada</b> para esta cuenta de WhatsApp, así que
          esta conversación no se puede reabrir desde el CRM. Un Gerente o Administrador
          las redacta en <b>Backoffice → Plantillas HSM</b>; la aprobación de Meta tarda.
        </p>
        {error && <div className="composer-error" role="alert">{error}</div>}
        <button type="button" className="btn ghost tiny" onClick={onCancel}>
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className="composer-template">
      {error && (
        <div className="composer-error" role="alert">
          <Icon name="target" width={12} height={12} />
          <span>{error}</span>
        </div>
      )}

      <label className="composer-template-label" htmlFor="template-choice">
        Plantilla
      </label>
      <select
        id="template-choice"
        value={selectedId}
        onChange={(event) => {
          const next = templates.find((template) => template.id === event.target.value);
          setSelectedId(event.target.value);
          setValues(next ? next.variables.map(() => "") : []);
          setError(null);
        }}
        disabled={sending}
      >
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name} · {template.language}
          </option>
        ))}
      </select>

      {selected && selected.variables.length > 0 && (
        <div className="composer-template-vars">
          {selected.variables.map((variable, index) => (
            <div key={`${selected.id}-${index}`}>
              <label
                className="composer-template-label"
                htmlFor={`template-value-${index}`}
              >
                {variable}
              </label>
              <input
                id={`template-value-${index}`}
                value={values[index] ?? ""}
                onChange={(event) =>
                  setValues((prev) =>
                    prev.map((item, position) =>
                      position === index ? event.target.value : item,
                    ),
                  )
                }
                maxLength={400}
                disabled={sending}
                autoComplete="off"
              />
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="composer-template-preview">
          <span>Se enviará</span>
          <p>{fillTemplate(selected.body, values)}</p>
        </div>
      )}

      <div className="composer-template-actions">
        <button
          type="button"
          className="btn primary tiny"
          onClick={() => void send()}
          disabled={!complete || sending}
        >
          {sending ? "Enviando…" : "Enviar plantilla"}
        </button>
        <button type="button" className="btn ghost tiny" onClick={onCancel} disabled={sending}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * La vista previa, con los huecos todavía sin llenar a la vista.
 *
 * Un valor vacío deja `{{n}}` en vez de un blanco: así se ve que falta algo,
 * que es justamente lo que el botón deshabilitado está esperando.
 */
function fillTemplate(body: string, values: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, index: string) => {
    const value = values[Number(index) - 1]?.trim();
    return value ? value : match;
  });
}

function windowState(conversation: ConversationSummary): { open: boolean; remaining: string } {
  const expires = conversation.whatsAppWindowExpiresAt
    ? new Date(conversation.whatsAppWindowExpiresAt).getTime()
    : 0;
  const minutes = Math.floor((expires - Date.now()) / 60_000);
  if (minutes <= 0) return { open: false, remaining: "" };
  return { open: true, remaining: `${Math.floor(minutes / 60)} h ${minutes % 60} m` };
}

/* ───────────────────────── Contexto del cliente ───────────────────────────── */

/**
 * Panel de contexto · HU-MSG-13.
 *
 * Lo necesario para contestar sin salir de la bandeja. El aviso de duplicado va
 * arriba de todo: es en la bandeja donde primero se ve que el prospecto que
 * acaba de escribir ya estaba cargado (HU-CLI-10).
 */
function ContextPanel({ detail, onClose }: { detail: ConversationDetail; onClose: () => void }) {
  const client = detail.client;
  const { context } = detail;

  if (!client) {
    return <div className="ctx inbox-empty">El expediente de este contacto ya no existe.</div>;
  }

  return (
    <div className="ctx">
      <button type="button" className="btn ghost tiny inbox-ctx-close" onClick={onClose}>
        Volver al hilo
      </button>

      <div className="who">
        <div className="av">{client.initials}</div>
        <b>{client.fullName}</b>
        <span>
          {client.stage?.name ?? "Sin etapa"}
          {context.clientAdvisor ? ` · ${context.clientAdvisor.fullName}` : " · expediente sin responsable"}
        </span>
      </div>

      {context.duplicates.length > 0 && (
        <div className="ctx-duplicates" role="note">
          <b>
            <Icon name="users" /> Posible duplicado
          </b>
          {context.duplicates.map((match) => (
            <Link key={match.client.id} href={`/clientes/${match.client.id}`}>
              {match.client.fullName}
              <span>{match.reasons.map((reason) => DUPLICATE_REASON_LABEL[reason]).join(", ")}</span>
            </Link>
          ))}
          <p>Si son la misma persona, un Gerente los fusiona desde el expediente.</p>
        </div>
      )}

      <div className="sect">CONTACTO</div>
      {client.primaryPhone && (
        <div className="kv">
          <Icon name="phone" />
          {client.primaryPhone}
        </div>
      )}
      {context.primaryEmail && (
        <div className="kv">
          <Icon name="mail" />
          {context.primaryEmail}
        </div>
      )}
      <div className="kv">
        <Icon name="pin" />
        {context.destinations.length > 0 ? context.destinations.join(", ") : "Sin destinos cargados"}
      </div>
      {context.estimatedValue && (
        <div className="kv">
          <Icon name="tag" />
          Valor estimado {formatMoney(context.estimatedValue)}
        </div>
      )}

      <div className="sect">COMERCIAL</div>
      {context.latestQuote ? (
        <Link href={`/cotizaciones/${context.latestQuote.id}`} className="kv ctx-link">
          <Icon name="doc" />
          {context.latestQuote.code} · {QUOTE_STATUS_LABEL[context.latestQuote.status]}
          {context.latestQuote.currentPrice ? ` · ${formatMoney(context.latestQuote.currentPrice)}` : ""}
        </Link>
      ) : (
        <div className="kv">
          <Icon name="doc" />
          Sin cotizaciones
        </div>
      )}
      {context.latestSale && (
        <Link href={`/ventas/${context.latestSale.id}`} className="kv ctx-link">
          <Icon name="cart" />
          {context.latestSale.code} · {SALE_STATUS_LABEL[context.latestSale.saleStatus]} · saldo{" "}
          {formatMoney(context.latestSale.balanceAmount)}
        </Link>
      )}

      <div className="sect">ACCIONES</div>
      <Link href={`/cotizaciones/nueva?clientId=${client.id}`} className="btn primary">
        <Icon name="doc" />
        Crear cotización
      </Link>
      <Link href={`/clientes/${client.id}`} className="btn ghost">
        <Icon name="folder" />
        Abrir expediente
      </Link>
    </div>
  );
}
