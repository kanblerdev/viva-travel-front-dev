/**
 * Tipos de las 15 colecciones del CRM Viva Travel.
 *
 * Fuente: "Diseño del Modelo de Datos v1.0" · secciones 6 (colecciones principales)
 * y 7 (colecciones de soporte).
 *
 * Los montos viajan como string en JSON porque en MongoDB son Decimal128
 * (convención global · sección 4: "Usar Decimal128 y moneda USD para evitar
 * errores de punto flotante"). No usar `number` para dinero.
 */

import type {
  AuditAction,
  AuditEntityType,
  Channel,
  ClientStatus,
  CommissionMode,
  ConversationStatus,
  DeliveryStatus,
  EmailEventType,
  EmailStatus,
  FileType,
  HsmStatus,
  IntegrationStatus,
  MessageDirection,
  MessageType,
  PaymentKind,
  PaymentStatus,
  PipelineStageCode,
  QuoteStatus,
  QuoteType,
  SaleStatus,
  ServiceType,
  SourceChannel,
  SupplierType,
  UserRole,
  UserStatus,
} from "./enums";

/** Identificador de MongoDB serializado como string en la API. */
export type Id = string;

/** Fecha ISO 8601 en UTC. Se presenta en la zona horaria de El Salvador. */
export type IsoDate = string;

/** Monto Decimal128 serializado como string. Moneda siempre USD. */
export type Money = string;

/** Campos de auditoría básica presentes en registros editables (sección 4). */
export interface Auditable {
  createdAt: IsoDate;
  updatedAt: IsoDate;
  createdBy?: Id | null;
  updatedBy?: Id | null;
}

/* ───────────────────────────── 6.1 users ──────────────────────────────────── */

export interface User extends Auditable {
  _id: Id;
  /** Identificador de Firebase Auth. Único. */
  firebaseUid: string;
  fullName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt?: IsoDate | null;
}

/* ───────────────────────────── 6.2 clients ────────────────────────────────── */

/** Identidad del contacto en un canal de Meta. */
export interface ClientIdentity {
  channel: Channel;
  externalId: string;
  username?: string | null;
  phone?: string | null;
  displayName?: string | null;
  isPrimary: boolean;
}

export interface TravelPreferences {
  destinations?: string[];
  interests?: string[];
  notes?: string | null;
}

export interface Client extends Auditable {
  _id: Id;
  fullName: string;
  /** Lowercase, sin tildes. Búsqueda y sugerencia de duplicados. */
  normalizedName: string;
  primaryPhone?: string | null;
  primaryEmail?: string | null;
  identities: ClientIdentity[];
  /** Claves normalizadas `whatsapp:+503…`, `instagram:123…`. Unique multikey. */
  identityKeys: string[];
  sourceChannel: SourceChannel;
  pipelineStageId: Id;
  status: ClientStatus;
  /** Obligatorio cuando status = lost (HU-CLI-05). */
  lostReason?: string | null;
  /** Obligatorio cuando status = merged. */
  mergedIntoClientId?: Id | null;
  tagIds: Id[];
  /** Vacío para prospectos captados desde Meta y aún sin tomar. */
  assignedAdvisorId?: Id | null;
  travelPreferences?: TravelPreferences | null;
  /** Notas internas. Nunca se exponen al cliente. */
  internalNotes?: string | null;
  estimatedValue?: Money | null;
  lastContactAt?: IsoDate | null;
}

/* ───────────────────────────── 6.3 quotes ─────────────────────────────────── */

export interface Quote extends Auditable {
  _id: Id;
  /** Código visible. Formato pendiente de validación (DM-01). */
  code: string;
  clientId: Id;
  advisorId: Id;
  quoteType: QuoteType;
  /** Obligatorio para supplier_package. */
  supplierAgencyId?: Id | null;
  status: QuoteStatus;
  currentVersionId: Id;
  versionCount: number;
  /** Vigencia de la versión vigente, copiada para consulta rápida. */
  currentValidUntil?: IsoDate | null;
  sentAt?: IsoDate | null;
  acceptedAt?: IsoDate | null;
  rejectedAt?: IsoDate | null;
  /** Venta originada por la cotización aceptada. */
  saleId?: Id | null;
}

/* ────────────────────────── 6.4 quote_versions ────────────────────────────── */

/** Snapshot histórico del cliente al momento de generar la versión. No se actualiza. */
export interface ClientSnapshot {
  fullName: string;
  email?: string | null;
  phone?: string | null;
}

export interface TripInfo {
  destination: string;
  startDate: IsoDate;
  endDate: IsoDate;
  passengers: { adults: number; children: number };
}

/** Línea de servicio de un paquete propio. */
export interface ServiceLine {
  serviceType: ServiceType;
  supplierId?: Id | null;
  description: string;
  startDate?: IsoDate | null;
  endDate?: IsoDate | null;
}

/** Propuesta de una agencia proveedora (paquete de agencia). */
export interface SupplierProposal {
  description: string;
  includes: string[];
  excludes: string[];
}

export interface Pricing {
  finalPrice: Money;
  currency: "USD";
}

export interface CommissionEntry {
  mode: CommissionMode;
  /** Monto fijo o porcentaje, según `mode`. */
  value: Money;
  /** Monto resuelto en USD. */
  amount: Money;
}

/**
 * Zona interna. Nunca aparece en PDF ni correo del cliente
 * (regla transversal "Comisiones internas" · 8.2).
 */
export interface Commissions {
  management: CommissionEntry;
  /** Solo aplica a supplier_package. */
  agency?: CommissionEntry | null;
  totalUtility: Money;
}

/** Documento inmutable: al editar una cotización enviada se crea otra versión. */
export interface QuoteVersion {
  _id: Id;
  quoteId: Id;
  versionNumber: number;
  clientSnapshot: ClientSnapshot;
  trip: TripInfo;
  /** Obligatorio para own_package. */
  serviceLines?: ServiceLine[];
  /** Obligatorio para supplier_package. */
  supplierProposal?: SupplierProposal | null;
  pricing: Pricing;
  commissions: Commissions;
  conditions?: string | null;
  /** Notas visibles al cliente. */
  clientNotes?: string | null;
  /** Notas internas de la versión. No se exportan. */
  internalNotes?: string | null;
  issuedAt: IsoDate;
  validUntil: IsoDate;
  pdfFileId?: Id | null;
  createdAt: IsoDate;
  createdBy: Id;
}

/* ───────────────────────────── 6.5 sales ──────────────────────────────────── */

export interface Payment {
  amount: Money;
  paidAt: IsoDate;
  kind: PaymentKind;
  /** Correlativo `REC-NNNN` del comprobante que emite el CRM. */
  receiptCode: string;
  /** Comprobante que APORTA el cliente: transferencia, depósito (HU-VEN-06). */
  receiptFileId?: Id | null;
  /** Comprobante que EMITE el CRM, con el estado de cuenta al momento del abono. */
  receiptPdfFileId?: Id | null;
  notes?: string | null;
  createdBy: Id;
}

/** Copia histórica de comisiones: los cambios posteriores no alteran la venta. */
export interface SaleCommissions {
  managementAmount: Money;
  agencyAmount: Money;
  totalUtility: Money;
}

export interface Sale extends Auditable {
  _id: Id;
  /** Código interno visible `VTA-NNNN`. Correlativo global (DM-02 adoptada). */
  code: string;
  clientId: Id;
  advisorId: Id;
  /** Vacío en venta directa (HU-VEN-03). */
  quoteId?: Id | null;
  quoteVersionId?: Id | null;
  quoteType: QuoteType;
  supplierAgencyId?: Id | null;
  destination: string;
  tripStart?: IsoDate | null;
  tripEnd?: IsoDate | null;
  finalPrice: Money;
  commissions: SaleCommissions;
  saleStatus: SaleStatus;
  paymentStatus: PaymentStatus;
  payments: Payment[];
  /** Suma de pagos registrados. Calculado en backend. */
  paidAmount: Money;
  /** finalPrice - paidAmount. Calculado en backend. */
  balanceAmount: Money;
  paymentDueDate?: IsoDate | null;
  /**
   * Factura INTERNA · DV-11 resuelta.
   *
   * Documento de control con correlativo propio y PDF en `files`; no es un DTE
   * ni pasa por el Ministerio de Hacienda. Se emite una sola vez por venta.
   */
  invoiceCode?: string | null;
  invoiceFileId?: Id | null;
  invoiceIssuedAt?: IsoDate | null;
  /** Motivo obligatorio al cancelar, igual que el descarte de un expediente. */
  cancelReason?: string | null;
  canceledAt?: IsoDate | null;
}

/* ─────────────────────────── 6.6 suppliers ────────────────────────────────── */

export interface SupplierContacts {
  phones: string[];
  emails: string[];
  whatsapp?: string | null;
  website?: string | null;
  other?: string | null;
}

export interface Supplier extends Auditable {
  _id: Id;
  name: string;
  normalizedName: string;
  type: SupplierType;
  /** Aplica a tourism_service. */
  serviceTypes?: ServiceType[];
  contacts: SupplierContacts;
  /** Referencia para nuevas cotizaciones; no modifica históricos (HU-PRO-03). */
  defaultCommission?: { mode: CommissionMode; value: Money } | null;
  internalNotes?: string | null;
  status: "active" | "inactive";
}

/* ──────────────────────── 6.7 conversations ───────────────────────────────── */

export interface Conversation {
  _id: Id;
  clientId: Id;
  channel: Channel;
  integrationId: Id;
  /** Thread o identidad de conversación en Meta. */
  externalConversationId: string;
  /** Identidad del contacto en el canal. Debe existir en client.identityKeys. */
  externalContactId: string;
  /** Vacío = Sin asignar. */
  assignedAdvisorId?: Id | null;
  status: ConversationStatus;
  lastMessagePreview?: string | null;
  lastMessageAt: IsoDate;
  lastInboundAt?: IsoDate | null;
  lastOutboundAt?: IsoDate | null;
  /** Fin calculado de la ventana de 24 h. Solo WhatsApp. */
  whatsAppWindowExpiresAt?: IsoDate | null;
  unreadCount?: number;
  /** Obligatorio si status = resolved. */
  resolvedAt?: IsoDate | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

/* ───────────────────────────── 6.8 messages ───────────────────────────────── */

export interface MessageContent {
  text?: string | null;
  mediaFileId?: Id | null;
  templateId?: Id | null;
  variables?: Record<string, string>;
}

export interface Message {
  _id: Id;
  conversationId: Id;
  /** Denormalizado para consulta y auditoría. */
  clientId: Id;
  channel: Channel;
  /** ID de Meta. Unique parcial para idempotencia. */
  externalMessageId?: string | null;
  direction: MessageDirection;
  messageType: MessageType;
  content: MessageContent;
  deliveryStatus: DeliveryStatus;
  /** Solo cuando deliveryStatus = failed. */
  failureReason?: string | null;
  /** Fecha del evento en el canal. Ordena el hilo. */
  occurredAt: IsoDate;
  /** Obligatorio para outbound humano. */
  sentByUserId?: Id | null;
  providerMetadata?: Record<string, unknown> | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

/* ────────────────────────── 7.1 pipeline_stages ───────────────────────────── */

export interface PipelineStage {
  _id: Id;
  code: PipelineStageCode;
  name: string;
  order: number;
  isTerminal: boolean;
  status: "active" | "inactive";
}

/* ─────────────────────────────── 7.2 tags ─────────────────────────────────── */

export interface Tag {
  _id: Id;
  name: string;
  description?: string | null;
  status: "active" | "inactive";
}

/* ─────────────────────────────── 7.3 files ────────────────────────────────── */

export interface StoredFile {
  _id: Id;
  clientId: Id;
  relatedEntity?: {
    entityType: "quoteVersion" | "sale" | "other";
    entityId: Id;
  } | null;
  fileType: FileType;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  /** Ruta interna en Firebase Storage. Nunca pública sin autorización. */
  storagePath: string;
  uploadedBy: Id;
  createdAt: IsoDate;
}

/* ────────────────────────── 7.4 hsm_templates ─────────────────────────────── */

export interface HsmTemplate {
  _id: Id;
  name: string;
  language: string;
  category: string;
  content: { body: string; variables: string[] };
  status: HsmStatus;
  /** ID asignado por Meta. */
  providerTemplateId?: string | null;
  /** Solo cuando status = rejected. */
  rejectionReason?: string | null;
  integrationId: Id;
}

/* ───────────────────────── 7.5 meta_integrations ──────────────────────────── */

export interface MetaIntegration {
  _id: Id;
  channel: Channel;
  /** Número, página o cuenta externa. */
  accountId: string;
  displayName: string;
  status: IntegrationStatus;
  /** Referencia a secreto en infraestructura. NUNCA el token real. */
  secretReference: string;
  webhookConfig?: Record<string, unknown> | null;
}

/* ─────────────────────────── 7.6 email_events ─────────────────────────────── */

export interface EmailEvent {
  _id: Id;
  eventType: EmailEventType;
  clientId?: Id | null;
  quoteId?: Id | null;
  saleId?: Id | null;
  recipients: string[];
  subject: string;
  status: EmailStatus;
  providerMessageId?: string | null;
  failureReason?: string | null;
  sentAt?: IsoDate | null;
}

/* ─────────────────────────── 7.7 audit_events ─────────────────────────────── */

/** Colección append-only. Nunca se modifica ni elimina. */
export interface AuditEvent {
  _id: Id;
  actorUserId: Id;
  entityType: AuditEntityType;
  entityId: Id;
  action: AuditAction;
  /** Antes/después de campos relevantes. Sin secretos. */
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  occurredAt: IsoDate;
}
