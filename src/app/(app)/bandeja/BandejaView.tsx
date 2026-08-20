"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import {
  CHANNEL_LABEL,
  CONVERSATION_STATUS_LABEL,
  WHATSAPP_WINDOW_HOURS,
  type Channel,
  type ConversationStatus,
} from "@/lib/domain/enums";

type Msg = {
  direction: "inbound" | "outbound";
  text: string;
  time: string;
  deliveryStatus?: "sent" | "delivered" | "read" | "failed";
};

type Conv = {
  id: string;
  clientSlug: string;
  name: string;
  initials: string;
  channel: Channel;
  status: ConversationStatus;
  advisor?: string | null;
  preview: string;
  time: string;
  /** Minutos restantes de la ventana de 24 h. null = fuera de ventana. */
  windowMinutesLeft: number | null;
  stageLabel: string;
  quick: { destination: string; passengers: string; budget: string };
  messages: Msg[];
};

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

const CONVERSATIONS: Conv[] = [
  {
    id: "v1",
    clientSlug: "maria-lopez",
    name: "María López",
    initials: "ML",
    channel: "whatsapp",
    status: "in_attention",
    advisor: "A. Ramírez",
    preview: "Gracias, deseo confirmar el viaje.",
    time: "2 h",
    windowMinutesLeft: 21 * 60 + 48,
    stageLabel: "Cotización enviada",
    quick: { destination: "Cancún · dic", passengers: "2 adultos", budget: "~$1,800" },
    messages: [
      { direction: "inbound", text: "Buenas, ya revisé la cotización.", time: "09:40" },
      {
        direction: "outbound",
        text: "¡Perfecto! ¿Confirmamos las fechas del 5 al 10 de diciembre?",
        time: "09:44",
        deliveryStatus: "read",
      },
      { direction: "inbound", text: "Gracias, deseo confirmar el viaje.", time: "09:52" },
    ],
  },
  {
    id: "v2",
    clientSlug: "jose-cruz",
    name: "José Cruz",
    initials: "JC",
    channel: "whatsapp",
    status: "new",
    advisor: null,
    preview: "¿Tienen algo para París en dic?",
    time: "5 m",
    windowMinutesLeft: 23 * 60 + 48,
    stageLabel: "Prospecto nuevo",
    quick: { destination: "París · diciembre", passengers: "2 adultos", budget: "~$3,000" },
    messages: [
      { direction: "inbound", text: "Hola, ¿tienen algo para París en diciembre?", time: "10:02" },
      {
        direction: "outbound",
        text: "¡Claro! ¿Para cuántas personas y qué fechas?",
        time: "10:05",
        deliveryStatus: "delivered",
      },
      { direction: "inbound", text: "2 adultos, del 5 al 12. Presupuesto ~$3,000.", time: "10:07" },
    ],
  },
  {
    id: "v3",
    clientSlug: "viajera-sv",
    name: "@viajera_sv",
    initials: "VS",
    channel: "instagram",
    status: "new",
    advisor: null,
    preview: "Info de paquetes",
    time: "20 m",
    windowMinutesLeft: null,
    stageLabel: "Prospecto nuevo",
    quick: { destination: "Sin definir", passengers: "—", budget: "—" },
    messages: [
      { direction: "inbound", text: "Hola! Me pasan info de paquetes?", time: "09:31" },
    ],
  },
  {
    id: "v4",
    clientSlug: "p-alfaro",
    name: "Pedro A.",
    initials: "PA",
    channel: "messenger",
    status: "resolved",
    advisor: "M. Díaz",
    preview: "¡Gracias!",
    time: "1 d",
    windowMinutesLeft: null,
    stageLabel: "Post-venta",
    quick: { destination: "Perú", passengers: "2 adultos", budget: "$3,400" },
    messages: [
      { direction: "inbound", text: "Todo salió excelente, muchas gracias.", time: "17:20" },
      { direction: "outbound", text: "¡Gracias a usted! Quedamos atentos.", time: "17:26", deliveryStatus: "read" },
    ],
  },
];

type Filter = "unassigned" | "mine" | "all";

const FILTER_LABEL: Record<Filter, string> = {
  unassigned: "Sin asignar",
  mine: "Míos",
  all: "Todos",
};

const CURRENT_ADVISOR = "A. Ramírez";

export function BandejaView() {
  const [filter, setFilter] = useState<Filter>("unassigned");
  const [selectedId, setSelectedId] = useState<string>("v2");

  const list = CONVERSATIONS.filter((c) => {
    if (filter === "unassigned") return !c.advisor;
    if (filter === "mine") return c.advisor === CURRENT_ADVISOR;
    return true;
  });

  const selected =
    CONVERSATIONS.find((c) => c.id === selectedId) ?? list[0] ?? CONVERSATIONS[0];

  const unassignedCount = CONVERSATIONS.filter((c) => !c.advisor).length;

  return (
    <div className="inbox">
      {/* Columna izquierda · lista de conversaciones */}
      <div className="inbox-panel list-panel">
        <div className="inbox-tabs">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABEL[f]}
              {f === "unassigned" ? ` · ${unassignedCount}` : ""}
            </button>
          ))}
        </div>

        <div className="inbox-list">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              className="inbox-item"
              aria-selected={selected?.id === c.id}
              onClick={() => setSelectedId(c.id)}
            >
              <span className="av">
                {c.initials}
                <span className="dot" style={{ background: CHANNEL_DOT[c.channel] }} />
              </span>
              <span className="body">
                <span className="top">
                  <span className="nm">{c.name}</span>
                  <span className="tm">{c.time}</span>
                </span>
                <span className="prev">{c.preview}</span>
                {!c.advisor && (
                  <span className="chip amber" style={{ marginTop: 6, fontSize: 10 }}>
                    Sin asignar
                  </span>
                )}
                {c.status === "resolved" && (
                  <span className="chip green" style={{ marginTop: 6, fontSize: 10 }}>
                    Resuelta
                  </span>
                )}
              </span>
            </button>
          ))}

          {list.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-mute)", fontSize: 13 }}>
              No hay conversaciones en este filtro.
            </div>
          )}
        </div>
      </div>

      {/* Columna central · hilo */}
      <div className="inbox-panel thread-panel">
        <div className="thread-head">
          <span className="avatar o1">{selected.initials}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <b style={{ fontSize: 14 }}>{selected.name}</b>
              <span className={`chip ${CHANNEL_CLASS[selected.channel]}`}>
                {CHANNEL_LABEL[selected.channel]}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-mute)" }}>
              {CONVERSATION_STATUS_LABEL[selected.status]}
              {selected.advisor ? ` · ${selected.advisor}` : " · Sin asignar"}
            </div>
          </div>
          <span style={{ flex: 1 }} />
          {selected.advisor ? (
            <button type="button" className="btn ghost">
              <Icon name="arrow-right" />
              Transferir
            </button>
          ) : (
            <button type="button" className="btn primary">
              <Icon name="check" />
              Tomar conversación
            </button>
          )}
        </div>

        <div className="thread-body">
          <span className="thread-daysep">Hoy</span>
          {selected.messages.map((m, i) => (
            <div key={i} className={`bubble ${m.direction === "inbound" ? "in" : "out"}`}>
              {m.text}
              <span className="meta">
                {m.time}
                {m.deliveryStatus === "read" && " ✓✓"}
                {m.deliveryStatus === "delivered" && " ✓✓"}
                {m.deliveryStatus === "sent" && " ✓"}
              </span>
            </div>
          ))}
        </div>

        <Composer conv={selected} />
      </div>

      {/* Columna derecha · contexto del cliente */}
      <div className="inbox-panel ctx-panel">
        <div className="ctx">
          <div className="who">
            <div className="av">{selected.initials}</div>
            <b>{selected.name}</b>
            <span>
              {selected.stageLabel}
              {selected.advisor ? "" : " · sin asignar"}
            </span>
          </div>

          <div className="sect">DATOS RÁPIDOS</div>
          <div className="kv">
            <Icon name="pin" />
            {selected.quick.destination}
          </div>
          <div className="kv">
            <Icon name="users" />
            {selected.quick.passengers}
          </div>
          <div className="kv">
            <Icon name="tag" />
            {selected.quick.budget}
          </div>

          <div className="sect">ACCIONES</div>
          <Link href="/cotizaciones/nueva" className="btn primary">
            <Icon name="doc" />
            Crear cotización
          </Link>
          <Link href={`/clientes/${selected.clientSlug}`} className="btn ghost">
            <Icon name="folder" />
            Abrir expediente
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Cuadro de respuesta. Dentro de la ventana de 24 h de WhatsApp se permite
 * respuesta libre; fuera de ella solo plantilla HSM aprobada (HU-MSG-12).
 * Messenger e Instagram no aplican la ventana.
 */
function Composer({ conv }: { conv: Conv }) {
  const isWhatsApp = conv.channel === "whatsapp";
  const windowOpen = !isWhatsApp || conv.windowMinutesLeft !== null;

  const remaining =
    conv.windowMinutesLeft === null
      ? null
      : `${Math.floor(conv.windowMinutesLeft / 60)} h ${conv.windowMinutesLeft % 60} m`;

  return (
    <div className="composer">
      <div className="window">
        {isWhatsApp ? (
          windowOpen ? (
            <>
              <span className="ok">● Ventana de {WHATSAPP_WINDOW_HOURS} h abierta</span>
              <span style={{ color: "var(--text-mute)", fontWeight: 500 }}>
                Respuesta libre permitida · expira en {remaining}
              </span>
            </>
          ) : (
            <>
              <span className="closed">● Ventana de {WHATSAPP_WINDOW_HOURS} h cerrada</span>
              <span style={{ color: "var(--text-mute)", fontWeight: 500 }}>
                Solo se puede enviar una plantilla HSM aprobada
              </span>
            </>
          )
        ) : (
          <span style={{ color: "var(--text-mute)", fontWeight: 500 }}>
            {CHANNEL_LABEL[conv.channel]} · respuesta directa
          </span>
        )}
      </div>

      <div className="row">
        {windowOpen ? (
          <>
            <button type="button" className="iconbtn" aria-label="Adjuntar">
              <Icon name="paperclip" />
            </button>
            <input placeholder="Escribe un mensaje…" />
            <button type="button" className="send" aria-label="Enviar">
              <Icon name="arrow-right" />
            </button>
          </>
        ) : (
          <>
            <input placeholder="Fuera de la ventana de 24 h" disabled />
            <button type="button" className="btn dark">
              <Icon name="mail" />
              Usar plantilla HSM
            </button>
          </>
        )}
      </div>
    </div>
  );
}
