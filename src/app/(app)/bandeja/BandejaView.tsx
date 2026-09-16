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
  type TeamMember,
} from "@/lib/api/crm";
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

  return (
    <div
      className="inbox"
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

        <Composer conversation={detail} />
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
};

function MessageBubble({ message }: { message: InboxMessage }) {
  if (message.messageType === "system") {
    return <span className="thread-system">{message.text}</span>;
  }

  const time = new Date(message.occurredAt).toLocaleTimeString("es-SV", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`bubble ${message.direction === "inbound" ? "in" : "out"}`}>
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
}

/* ────────────────────────────── Respuesta ─────────────────────────────────── */

/**
 * Cuadro de respuesta · HU-MSG-10 y HU-MSG-12.
 *
 * La ventana de 24 h ya se calcula con el dato real. El envío se habilita en el
 * Sprint 7; hasta entonces el cuadro lo dice en vez de aparentar que funciona.
 */
function Composer({ conversation }: { conversation: ConversationDetail }) {
  const replyWindow = useMemo(() => windowState(conversation), [conversation]);

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
                Para escribirle hará falta una plantilla HSM aprobada
              </span>
            </>
          )
        ) : (
          <span style={{ color: "var(--text-mute)", fontWeight: 500 }}>
            {CHANNEL_LABEL[conversation.channel]} · lo que se responda desde Meta Business Suite aparece en este hilo
          </span>
        )}
      </div>

      <div className="row">
        <input placeholder="El envío desde el CRM todavía no está habilitado" disabled aria-label="Mensaje" />
        <button type="button" className="send" aria-label="Enviar" disabled>
          <Icon name="arrow-right" />
        </button>
      </div>
    </div>
  );
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
