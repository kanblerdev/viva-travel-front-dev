/**
 * Catálogos y enumeraciones del CRM Viva Travel.
 *
 * Fuente: "Diseño del Modelo de Datos v1.0" · sección 9 (Catálogos y enumeraciones)
 * y "Levantamiento Funcional Detallado v1.0" · sección 8.1 (Estados y transiciones).
 *
 * Regla del documento: código técnico en inglés, etiqueta en español para UI.
 * NO renombrar los códigos técnicos — son el contrato con el backend y MongoDB.
 */

/* ─────────────────────────── 9.1 Roles de usuario ─────────────────────────── */

export const USER_ROLES = ["admin", "manager", "advisor"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  admin: "Administrador",
  manager: "Gerente",
  advisor: "Asesor",
};

export const USER_STATUSES = ["active", "inactive"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/* ────────────────────────── 9.2 Etapas del Kanban ─────────────────────────── */

export const PIPELINE_STAGES = [
  "prospect_new",
  "contacted",
  "quote_sent",
  "negotiation",
  "reservation_deposit",
  "sale_closed",
  "post_sale",
  "lost_discarded",
] as const;
export type PipelineStageCode = (typeof PIPELINE_STAGES)[number];

/**
 * Nombre de fábrica de cada etapa.
 *
 * Es el RESPALDO, no la fuente: el nombre que se muestra sale del catálogo
 * (`pipeline_stages.name`), que un Administrador puede renombrar desde el
 * backoffice (HU-CFG-01). Esta constante se usa cuando solo se tiene el código
 * y no el documento — por ejemplo al leer un evento de `audit_events`, que
 * guarda el código técnico y no el nombre vigente.
 *
 * Para pintar una etapa que sí viene del catálogo, usar `stageLabel()`.
 */
export const PIPELINE_STAGE_LABEL: Record<PipelineStageCode, string> = {
  prospect_new: "Prospecto nuevo",
  contacted: "Contactado",
  quote_sent: "Cotización enviada",
  negotiation: "En negociación",
  reservation_deposit: "Reserva / anticipo",
  sale_closed: "Venta cerrada",
  post_sale: "Post-venta",
  lost_discarded: "Perdido / Descartado",
};

/**
 * Nombre visible de una etapa del catálogo.
 *
 * El catálogo manda: si un Administrador renombró la etapa desde el backoffice,
 * el CRM tiene que mostrar ese nombre. El respaldo solo cubre el caso de un
 * catálogo incompleto, que además rompería el tablero por otros lados.
 */
export function stageLabel(stage: { code: PipelineStageCode; name?: string | null }): string {
  return stage.name?.trim() || PIPELINE_STAGE_LABEL[stage.code] || stage.code;
}

/**
 * Color de cada etapa · una sola definición para las dos vistas.
 *
 * Antes vivía duplicado en el tablero y en la lista, y no coincidían: la misma
 * etapa salía azul en un lado y naranja en el otro, con lo cual el color dejaba
 * de ser información. `chip` es la clase de la píldora; `swatch`, la variable CSS
 * del cuadrito del encabezado de columna.
 *
 * El orden sigue el avance del embudo —frío, tibio, en juego, comprometido,
 * cerrado— para que el tablero se lea de un vistazo.
 */
export const PIPELINE_STAGE_COLOR: Record<
  PipelineStageCode,
  { chip: string; swatch: string }
> = {
  prospect_new: { chip: "blue", swatch: "var(--blue)" },
  contacted: { chip: "amber", swatch: "var(--amber)" },
  quote_sent: { chip: "orange", swatch: "var(--orange)" },
  negotiation: { chip: "purple", swatch: "var(--purple)" },
  reservation_deposit: { chip: "navy", swatch: "var(--navy-soft)" },
  sale_closed: { chip: "green", swatch: "var(--green)" },
  post_sale: { chip: "green", swatch: "var(--green)" },
  lost_discarded: { chip: "red", swatch: "var(--red)" },
};

/** Etapas terminales: salen del flujo activo del tablero. */
export const TERMINAL_STAGES: PipelineStageCode[] = ["lost_discarded"];

/**
 * Etapas que cuentan como "oportunidad abierta" (HU-DAS-01).
 * Excluye Venta cerrada, Post-venta y Perdido/Descartado.
 */
export const OPEN_OPPORTUNITY_STAGES: PipelineStageCode[] = [
  "prospect_new",
  "contacted",
  "quote_sent",
  "negotiation",
  "reservation_deposit",
];

/* ───────────────────────── 9.3 Estados de cotización ──────────────────────── */

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "negotiation",
  "accepted",
  "rejected",
  "expired",
  "archived",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Borrador",
  sent: "Enviada",
  negotiation: "En negociación",
  accepted: "Aceptada",
  rejected: "Rechazada",
  expired: "Vencida",
  archived: "Descartada",
};

/**
 * Un solo mapa de color de estado, compartido por listado, expediente y detalle.
 *
 * Estaba copiado en tres archivos y agregar un estado dejaba dos de ellos sin
 * color. Misma decisión que el Sprint 5B tomó con las etapas del Kanban (C6).
 */
export const QUOTE_STATUS_CHIP: Record<QuoteStatus, string> = {
  draft: "",
  sent: "blue",
  negotiation: "purple",
  accepted: "green",
  rejected: "red",
  expired: "amber",
  archived: "",
};

/** Máquina de estados de cotización (Levantamiento Funcional · 8.1). */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["sent", "archived"],
  sent: ["negotiation", "accepted", "rejected", "expired"],
  negotiation: ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: [],
  expired: ["draft"],
  archived: ["draft"],
};

/** Estados en los que se puede editar el contenido y emitir versión nueva. */
export const QUOTE_EDITABLE_STATUSES: QuoteStatus[] = [
  "draft",
  "sent",
  "negotiation",
  "expired",
];

/** Motivo obligatorio: son las dos salidas que alimentan el análisis de pérdida. */
export const QUOTE_STATUSES_NEEDING_REASON: QuoteStatus[] = ["rejected", "archived"];

/**
 * A qué se aplica un motivo de pérdida.
 *
 * Un solo catálogo, dos listas: se pierde un expediente por razones que no son
 * las de una cotización rechazada.
 */
export const LOSS_REASON_SCOPES = ["client", "quote"] as const;
export type LossReasonScope = (typeof LOSS_REASON_SCOPES)[number];

export const LOSS_REASON_SCOPE_LABEL: Record<LossReasonScope, string> = {
  client: "Expediente",
  quote: "Cotización",
};

export const QUOTE_TYPES = ["own_package", "supplier_package"] as const;
export type QuoteType = (typeof QUOTE_TYPES)[number];

export const QUOTE_TYPE_LABEL: Record<QuoteType, string> = {
  own_package: "Paquete propio",
  supplier_package: "Paquete de agencia",
};

/* ──────────────────────── 9.4 Estados de venta y pago ─────────────────────── */

export const SALE_STATUSES = [
  "reserved",
  "paid",
  "in_progress",
  "completed",
  "canceled",
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  reserved: "Reservada",
  paid: "Pagada",
  in_progress: "En curso",
  completed: "Completada",
  canceled: "Cancelada",
};

/** Máquina de estados de venta (Levantamiento Funcional · 8.1). */
export const SALE_TRANSITIONS: Record<SaleStatus, SaleStatus[]> = {
  reserved: ["paid", "canceled"],
  // Cancelar sigue disponible con la venta cobrada o el viaje en marcha (DM-16).
  paid: ["in_progress", "canceled"],
  in_progress: ["completed", "canceled"],
  completed: [],
  canceled: [],
};

/**
 * Transiciones que la interfaz ofrece desde un estado · hallazgo `H1`.
 *
 * Gemela de `manualTransitionsFrom` en `backend/src/modules/sales/sale-rules.ts`.
 * `SALE_TRANSITIONS` estaba acá sin que nadie la importara, y la pantalla del
 * detalle llevaba una tercera copia escrita a mano que ya no coincidía. Ahora la
 * tabla es el único origen y la pantalla la deriva.
 *
 * "Pagada" no se ofrece nunca: la alcanza el saldo en cero, no un botón
 * (HU-VEN-04).
 */
export function manualSaleTransitions(from: SaleStatus): SaleStatus[] {
  return SALE_TRANSITIONS[from].filter((to) => to !== "paid");
}

export const PAYMENT_STATUSES = ["pending", "deposit_paid", "paid_full"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "Pago pendiente",
  deposit_paid: "Anticipo pagado",
  paid_full: "Pagado completo",
};

export const PAYMENT_KINDS = ["deposit", "partial", "final"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/* ────────────────────── 9.5 Estados de conversación ───────────────────────── */

export const CONVERSATION_STATUSES = ["new", "in_attention", "resolved"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_STATUS_LABEL: Record<ConversationStatus, string> = {
  new: "Nueva",
  in_attention: "En atención",
  resolved: "Resuelta",
};

/* ───────────────────────── 9.6 Estados de plantilla HSM ───────────────────── */

export const HSM_STATUSES = ["draft", "in_review", "approved", "rejected"] as const;
export type HsmStatus = (typeof HSM_STATUSES)[number];

export const HSM_STATUS_LABEL: Record<HsmStatus, string> = {
  draft: "Borrador",
  in_review: "En revisión",
  approved: "Aprobada",
  rejected: "Rechazada",
};

/* ──────────────────────────── Canales de Meta ─────────────────────────────── */

export const CHANNELS = ["whatsapp", "messenger", "instagram"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  instagram: "Instagram",
};

/** Canal de origen del cliente: los tres de Meta más "other" (HU-REP-04). */
export const SOURCE_CHANNELS = [...CHANNELS, "other"] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

export const SOURCE_CHANNEL_LABEL: Record<SourceChannel, string> = {
  ...CHANNEL_LABEL,
  other: "Otro",
};

export const INTEGRATION_STATUSES = ["connected", "pending", "error"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const INTEGRATION_STATUS_LABEL: Record<IntegrationStatus, string> = {
  connected: "Conectado",
  pending: "Pendiente",
  error: "Error",
};

/* ──────────────────────────────── Mensajes ────────────────────────────────── */

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_TYPES = ["text", "media", "document", "template", "system"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const DELIVERY_STATUSES = [
  "received",
  "queued",
  "sent",
  "delivered",
  "failed",
  "read",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  received: "Recibido",
  queued: "En cola",
  sent: "Enviado",
  delivered: "Entregado",
  failed: "Error",
  read: "Leído",
};

/** Ventana de respuesta libre de WhatsApp, en horas (regla transversal · 8.2). */
export const WHATSAPP_WINDOW_HOURS = 24;

/* ──────────────────────────────── Clientes ────────────────────────────────── */

export const CLIENT_STATUSES = ["active", "lost", "merged", "archived"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  active: "Activo",
  lost: "Perdido",
  merged: "Fusionado",
  archived: "Archivado",
};

/* ─────────────────────────────── Proveedores ──────────────────────────────── */

export const SUPPLIER_TYPES = ["agency", "tourism_service"] as const;
export type SupplierType = (typeof SUPPLIER_TYPES)[number];

export const SUPPLIER_TYPE_LABEL: Record<SupplierType, string> = {
  agency: "Agencia proveedora",
  tourism_service: "Servicio turístico",
};

export const SERVICE_TYPES = [
  "flight",
  "hotel",
  "tour",
  "transfer",
  "insurance",
  "other",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  flight: "Vuelo",
  hotel: "Hotel",
  tour: "Tour",
  transfer: "Traslado",
  insurance: "Seguro",
  other: "Otro",
};

/* ─────────────────────────────── Comisiones ───────────────────────────────── */

export const COMMISSION_MODES = ["fixed", "percentage"] as const;
export type CommissionMode = (typeof COMMISSION_MODES)[number];

export const COMMISSION_MODE_LABEL: Record<CommissionMode, string> = {
  fixed: "Monto fijo",
  percentage: "Porcentaje",
};

/* ─────────────────────────────── Archivos ─────────────────────────────────── */

export const FILE_TYPES = [
  "passport",
  "payment_receipt",
  "quote_pdf",
  "invoice_pdf",
  "other",
] as const;
export type FileType = (typeof FILE_TYPES)[number];

export const FILE_TYPE_LABEL: Record<FileType, string> = {
  passport: "Pasaporte",
  payment_receipt: "Comprobante de pago",
  quote_pdf: "PDF de cotización",
  invoice_pdf: "Factura",
  other: "Otro",
};

/* ────────────────────────────── Correos ──────────────────────────────────── */

export const EMAIL_EVENT_TYPES = [
  "quote_sent",
  "sale_confirmed",
  "internal_notification",
] as const;
export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];

export const EMAIL_STATUSES = ["queued", "sent", "failed"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/* ──────────────────────────────── Auditoría ───────────────────────────────── */

export const AUDIT_ENTITY_TYPES = [
  "client",
  "quote",
  "sale",
  "conversation",
  "supplier",
  "user",
  "hsm_template",
  "meta_integration",
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const AUDIT_ACTIONS = [
  "created",
  "updated",
  "stage_changed",
  "contact_logged",
  "assigned",
  "transferred",
  "merged",
  "status_changed",
  "payment_registered",
  "payment_voided",
  "deleted",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
