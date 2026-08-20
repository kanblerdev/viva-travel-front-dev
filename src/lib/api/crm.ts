"use client";

import { getIdToken } from "@/lib/firebase/client";
import { apiDownload, apiRequest, apiUpload, type Paginated } from "./client";
import type {
  ClientStatus,
  CommissionMode,
  FileType,
  PaymentKind,
  PaymentStatus,
  PipelineStageCode,
  QuoteStatus,
  QuoteType,
  SaleStatus,
  LossReasonScope,
  ServiceType,
  SourceChannel,
  SupplierType,
  UserRole,
} from "@/lib/domain/enums";

/* ──────────────────────────────── Tipos ───────────────────────────────────── */

export type PipelineStage = {
  id: string;
  code: PipelineStageCode;
  name: string;
  order: number;
  isTerminal: boolean;
};

export type Tag = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  usageCount: number;
};

/**
 * Motivo de pérdida del catálogo · HU-CLI-05.
 *
 * `code` es inmutable y es lo que agrupan los reportes; `name` es la etiqueta
 * visible, que un Administrador puede renombrar desde el backoffice.
 */
export type LossReason = {
  id: string;
  code: string;
  name: string;
  /** A qué se aplica: descarte de expediente o cierre de cotización. */
  scope: LossReasonScope;
  order: number;
  status: "active" | "inactive";
  usageCount: number;
};

export type TeamMember = {
  id: string;
  fullName: string;
  initials: string;
  role: UserRole;
};

export type ClientSummary = {
  id: string;
  fullName: string;
  initials: string;
  sourceChannel: SourceChannel;
  pipelineStageId: string;
  status: ClientStatus;
  primaryPhone: string | null;
  primaryEmail: string | null;
  destinations: string[];
  /** Decimal128 serializado. Nunca operar con él como número. */
  estimatedValue: string | null;
  tagIds: string[];
  advisor: { id: string; fullName: string; initials: string } | null;
  /** Referencia al catálogo. Ya no es texto concatenado con la nota. */
  lostReason: { id: string; code: string | null; name: string | null } | null;
  /** Detalle libre de ese descarte en particular. */
  lostReasonNote: string | null;
  /** Cuándo volvió al flujo activo. Reactivar ya no borra el motivo. */
  reactivatedAt: string | null;
  /** Última vez que alguien habló con el cliente. No la mueve editar la ficha. */
  lastContactAt: string | null;
  /** Próxima acción comprometida por el asesor. No dispara recordatorios. */
  nextFollowUpAt: string | null;
  updatedAt: string;
};

export type ClientIdentity = {
  channel: "whatsapp" | "messenger" | "instagram";
  externalId: string;
  username: string | null;
  displayName: string | null;
  isPrimary: boolean;
};

export type ClientDetail = ClientSummary & {
  normalizedName: string;
  identities: ClientIdentity[];
  travelPreferences: {
    destinations: string[];
    interests: string[];
    notes: string | null;
  };
  internalNotes: string | null;
  mergedIntoClientId: string | null;
  createdAt: string;
};

export type ActivityEvent = {
  id: string;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  occurredAt: string;
  actor: string;
};

/**
 * Columnas ordenables de la vista de lista · HU-CLI-08.
 *
 * Son las que el backend acepta y esta tabla dibuja. Responsable y Etapa no
 * están: se resuelven mejor con el filtro de asesor y con el Kanban.
 */
export const CLIENT_SORT_FIELDS = ["name", "channel", "value", "contact"] as const;
export type ClientSortField = (typeof CLIENT_SORT_FIELDS)[number];
export type ClientSort = { by: ClientSortField; dir: "asc" | "desc" };

export type ClientFilters = {
  search?: string;
  advisorId?: string;
  channel?: SourceChannel;
  tagId?: string;
  destination?: string;
  pipelineStageId?: string;
  /** Seguimientos comprometidos hasta esta fecha, inclusive. Fecha ISO. */
  followUpUntil?: string;
  sortBy?: ClientSortField;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type CreateClientInput = {
  fullName: string;
  primaryPhone?: string;
  primaryEmail?: string;
  sourceChannel: SourceChannel;
  assignedAdvisorId?: string;
  tagIds?: string[];
  travelPreferences?: { destinations?: string[]; interests?: string[]; notes?: string };
  internalNotes?: string;
  estimatedValue?: string;
};

/**
 * Edición del expediente · HU-EXP-02.
 *
 * Vaciar un campo se pide con `null`, no con `""`: la cadena vacía no pasa la
 * validación de correo del backend. Lo que no se manda, no se toca — el canal de
 * origen, la etapa y el responsable ni siquiera están acá porque tienen sus
 * propias reglas y endpoints.
 */
export type UpdateClientInput = {
  fullName?: string;
  primaryPhone?: string | null;
  primaryEmail?: string | null;
  tagIds?: string[];
  travelPreferences?: {
    destinations?: string[];
    interests?: string[];
    notes?: string | null;
  };
  internalNotes?: string | null;
  estimatedValue?: string | null;
};

/* ────────────────────────────── Proveedores ───────────────────────────────── */

export type SupplierContacts = {
  phones: string[];
  emails: string[];
  whatsapp: string | null;
  website: string | null;
  other: string | null;
};

export type Supplier = {
  id: string;
  name: string;
  type: SupplierType;
  serviceTypes: ServiceType[];
  contacts: SupplierContacts;
  /** Referencia para precargar cotizaciones; no altera las ya emitidas. */
  defaultCommission: { mode: CommissionMode; value: string } | null;
  internalNotes: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

/** Dónde se usa un proveedor · HU-PRO-04. */
export type SupplierUsage = {
  supplierId: string;
  asAgency: number;
  inServiceLines: number;
  totalQuotes: number;
  quotes: {
    id: string;
    code: string;
    status: string;
    clientName: string | null;
    createdAt: string;
    role: "agency" | "service_line";
  }[];
};

export type SupplierFilters = {
  search?: string;
  type?: SupplierType;
  serviceType?: ServiceType;
  status?: "active" | "inactive";
  sortBy?: "name" | "type" | "created";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type SupplierInput = {
  name: string;
  type: SupplierType;
  serviceTypes?: ServiceType[];
  contacts: {
    phones?: string[];
    emails?: string[];
    whatsapp?: string;
    website?: string;
    other?: string;
  };
  defaultCommission?: { mode: CommissionMode; value: string } | null;
  internalNotes?: string;
};

/* ────────────────────────────── Cotizaciones ──────────────────────────────── */

export type QuoteRef = { id: string; name: string } | null;

export type QuoteSummary = {
  id: string;
  code: string;
  status: QuoteStatus;
  quoteType: QuoteType;
  client: QuoteRef;
  advisor: QuoteRef;
  supplierAgency: QuoteRef;
  destination: string | null;
  finalPrice: string;
  currency: string;
  versionCount: number;
  /** Última versión que salió por correo. `null` en las anteriores al campo. */
  lastSentVersionNumber: number | null;
  validUntil: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Vigencia pasada y todavía sin procesar por el job de vencimiento. */
  isOverdue: boolean;
  /** DV-07: 5 días hábiles desde el envío sin respuesta. */
  noAnswer: boolean;
  /**
   * Hay una versión emitida que el cliente todavía no recibió.
   *
   * Lo resuelve el backend, como los otros dos avisos: la regla es una sola y no
   * puede vivir escrita en dos lenguajes.
   */
  hasUnsentChanges: boolean;
};

export type QuoteServiceLine = {
  serviceType: ServiceType;
  supplierId: string | null;
  description: string;
  startDate: string | null;
  endDate: string | null;
};

export type QuoteCommission = {
  mode: CommissionMode;
  value: string;
  /** Monto resuelto en USD, calculado en el backend. */
  amount: string;
};

export type QuoteVersionData = {
  id: string;
  versionNumber: number;
  clientSnapshot: { fullName: string; email: string | null; phone: string | null };
  trip: {
    destination: string;
    startDate: string;
    endDate: string;
    passengers: { adults: number; children: number };
  };
  serviceLines: QuoteServiceLine[];
  supplierProposal: {
    description: string;
    includes: string[];
    excludes: string[];
  } | null;
  pricing: { finalPrice: string; currency: string };
  /** Zona INTERNA: nunca sale en el PDF ni en el correo al cliente. */
  commissions: {
    management: QuoteCommission;
    agency: QuoteCommission | null;
    totalUtility: string;
  };
  conditions: string | null;
  clientNotes: string | null;
  internalNotes: string | null;
  issuedAt: string;
  validUntil: string;
  pdfFileId: string | null;
  createdBy: QuoteRef;
};

export type QuoteDetail = QuoteSummary & {
  currentVersion: QuoteVersionData | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  archivedAt: string | null;
  /** Motivo catalogado del cierre. Es lo que agrupa el análisis de pérdida. */
  closeReason: QuoteRef;
  /** Detalle libre de ese cierre concreto. */
  closeReasonNote: string | null;
  saleId: string | null;
};

export type QuoteStatusCounts = Record<QuoteStatus, number>;

export type QuotesSummary = {
  total: number;
  byStatus: QuoteStatusCounts;
  noAnswer: number;
  noAnswerBusinessDays: number;
};

export type QuoteSortField = "code" | "created" | "price" | "validUntil";

export type QuoteFilters = {
  search?: string;
  clientId?: string;
  advisorId?: string;
  status?: QuoteStatus;
  quoteType?: QuoteType;
  supplierAgencyId?: string;
  /** Creadas desde / hasta (ISO). El backend ya los aceptaba. */
  from?: string;
  to?: string;
  /** Los dos avisos del listado, ahora también como filtro. */
  overdue?: boolean;
  noAnswer?: boolean;
  /** Las descartadas salen del listado salvo que se pidan. */
  includeArchived?: boolean;
  sortBy?: QuoteSortField;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type QuoteInput = {
  clientId: string;
  /**
   * Asesor responsable. Vacío = quien cotiza.
   *
   * Solo Gerente y Administrador pueden indicar a otro; el backend rechaza que
   * un Asesor cotice a nombre ajeno. Sin este campo, toda cotización creada por
   * un gerente quedaba a su propio nombre y descuadraba el reporte por asesor.
   */
  advisorId?: string;
  quoteType: QuoteType;
  supplierAgencyId?: string;
  trip: {
    destination: string;
    startDate: string;
    endDate: string;
    passengers: { adults: number; children?: number };
  };
  serviceLines?: {
    serviceType: ServiceType;
    supplierId?: string;
    description: string;
  }[];
  supplierProposal?: { description: string; includes?: string[]; excludes?: string[] };
  finalPrice: string;
  managementCommission: { mode: CommissionMode; value: string };
  agencyCommission?: { mode: CommissionMode; value: string } | null;
  conditions?: string;
  clientNotes?: string;
  internalNotes?: string;
  validUntil?: string;
};

/**
 * Cuerpo del PATCH de una cotización · HU-COT-11.
 *
 * Los campos que se pueden vaciar admiten `null` explícito, que es lo que los
 * distingue de omitirlos: omitir conserva, `null` borra.
 */
export type QuoteUpdateInput = Partial<
  Omit<QuoteInput, "clientId" | "quoteType" | "conditions" | "clientNotes" | "internalNotes">
> & {
  conditions?: string | null;
  clientNotes?: string | null;
  internalNotes?: string | null;
};

export type StoredFileRef = {
  id: string;
  clientId: string;
  fileType: FileType;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  relatedEntity: { entityType: string; entityId: string } | null;
  uploadedAt: string;
};

/* ───────────────────────────────── Ventas ─────────────────────────────────── */

export type SaleSummary = {
  id: string;
  code: string;
  saleStatus: SaleStatus;
  paymentStatus: PaymentStatus;
  quoteType: QuoteType;
  client: QuoteRef;
  advisor: QuoteRef;
  supplierAgency: QuoteRef;
  destination: string;
  tripStart: string | null;
  tripEnd: string | null;
  /** Decimal128 serializado. Nunca operar con él como número. */
  finalPrice: string;
  paidAmount: string;
  balanceAmount: string;
  paymentDueDate: string | null;
  paymentsCount: number;
  /** Contacto del cliente, para poder llamarlo desde la agenda de cobro. */
  clientContact: { phone: string | null; email: string | null } | null;
  /** Última gestión de cobro registrada · agenda de cobro. */
  lastCollectionContactAt: string | null;
  lastCollectionNote: string | null;
  invoiceCode: string | null;
  /** Fecha límite pasada con saldo pendiente. */
  isPaymentOverdue: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SalePayment = {
  id: string;
  receiptCode: string;
  amount: string;
  kind: PaymentKind;
  /** Forma de pago · DM-18. `null` en los abonos anteriores al catálogo. */
  method: QuoteRef;
  paidAt: string;
  notes: string | null;
  /** Comprobante que aportó el cliente. */
  receiptFileId: string | null;
  /** Comprobante REC-NNNN que emitió el CRM. */
  receiptPdfFileId: string | null;
  createdBy: QuoteRef;
  /**
   * Anulación · DM-15. El asiento se conserva con su código y deja de sumar al
   * cobro; nunca se borra ni se edita.
   */
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: QuoteRef;
};

export type SaleDetail = SaleSummary & {
  quote: QuoteRef;
  quoteVersionId: string | null;
  /**
   * Zona INTERNA: nunca sale en la factura, el comprobante ni el correo.
   *
   * `null` cuando quien mira no puede verla (DM-19): un Asesor solo ve la
   * utilidad de SUS ventas. Es `null` y no cero a propósito — un cero diría que
   * la venta no dejó nada.
   */
  commissions: {
    managementAmount: string;
    agencyAmount: string;
    totalUtility: string;
  } | null;
  payments: SalePayment[];
  documents: {
    quotePdfFileId: string | null;
    invoiceCode: string | null;
    invoiceFileId: string | null;
    invoiceIssuedAt: string | null;
    /** Anulada · DM-20. El correlativo se conserva y no se reemite. */
    invoiceVoidedAt: string | null;
    invoiceVoidReason: string | null;
  };
  cancelReason: string | null;
  canceledAt: string | null;
};

/** Entrada del historial · `G5`. Viene de `audit_events`, que es append-only. */
export type SaleActivity = {
  id: string;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  occurredAt: string;
  /** "Sistema" cuando no hubo una persona detrás. */
  actor: string;
};

export type SalesSummary = {
  count: number;
  /** Vigentes con saldo y plazo vencido · alimenta la tarjeta "Atrasadas". */
  overdueCount: number;
  byStatus: Record<SaleStatus, number>;
  totalAmount: string;
  paidAmount: string;
  balanceAmount: string;
  averageTicket: string;
};

export type SaleFilters = {
  search?: string;
  clientId?: string;
  advisorId?: string;
  saleStatus?: SaleStatus;
  paymentStatus?: PaymentStatus;
  from?: string;
  to?: string;
  /** Solo las que pasaron su fecha límite con saldo pendiente. */
  overdue?: boolean;
  /** Solo las que tienen algo por cobrar. */
  hasBalance?: boolean;
  tripFrom?: string;
  tripTo?: string;
  sortBy?: "code" | "created" | "price" | "balance" | "tripStart" | "dueDate";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type CreateSaleInput = {
  clientId: string;
  advisorId?: string;
  quoteType: QuoteType;
  supplierAgencyId?: string;
  destination: string;
  tripStart?: string;
  tripEnd?: string;
  finalPrice: string;
  managementCommission: { mode: CommissionMode; value: string };
  agencyCommission?: { mode: CommissionMode; value: string };
  paymentDueDate?: string;
};

export type PaymentMethodOption = {
  id: string;
  code: string;
  name: string;
  order: number;
  status: "active" | "inactive";
};

export type RegisterPaymentInput = {
  amount: string;
  kind: PaymentKind;
  /** Forma de pago · DM-18. */
  methodId?: string;
  paidAt?: string;
  receiptFileId?: string;
  notes?: string;
};

/** Resultado del correo al cliente; el backend nunca falla la venta por esto. */
export type ConfirmationResult = {
  sent: boolean;
  simulated: boolean;
  recipients: string[];
  error?: string;
};

export type SaleWithConfirmation = {
  sale: SaleDetail;
  confirmation: ConfirmationResult;
};

/* ─────────────────────────────── Dashboard ────────────────────────────────── */

export type DashboardSummary = {
  period: { from: string; to: string };
  openOpportunities: {
    count: number;
    estimatedValue: string;
    byStage: { stageCode: PipelineStageCode | null; count: number; estimatedValue: string }[];
  };
  sales: {
    count: number;
    totalAmount: string;
    collectedAmount: string;
    outstandingAmount: string;
    averageTicket: string;
  };
  closeRate: {
    salesCreated: number;
    quotesSent: number;
    /** Fracción 0–1, o null si no hubo cotizaciones enviadas en el período. */
    rate: number | null;
    caveat: string;
  };
  pending: {
    quotesNoAnswer: number;
    noAnswerBusinessDays: number;
    quotesExpiringSoon: number;
    expiringSoonDays: number;
    quotesOverdue: number;
    salesWithBalance: number;
    outstandingAmount: string;
    salesPaymentOverdue: number;
    salesToComplete: number;
  };
};

/* ─────────────────────────────── Transporte ───────────────────────────────── */

async function authed<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {},
): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new Error("La sesión expiró. Volvé a iniciar sesión.");
  return apiRequest<T>(path, { ...options, token });
}

/** Descarta los filtros vacíos para no ensuciar la URL ni la caché. */
function toQuery(filters: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/* ─────────────────────────────── Operaciones ──────────────────────────────── */

export const crmApi = {
  stages: () => authed<PipelineStage[]>("/pipeline-stages"),

  /** Formas de pago vigentes · DM-18. */
  paymentMethods: () => authed<PaymentMethodOption[]>("/payment-methods"),

  /**
   * Etiquetas del catálogo. Con `includeInactive` vienen también las
   * desactivadas: un expediente puede tener una asignada de antes y hay que
   * poder mostrarla con su nombre.
   */
  tags: (includeInactive = false) =>
    authed<Tag[]>(`/tags${includeInactive ? "?includeInactive=true" : ""}`),

  team: () => authed<TeamMember[]>("/team"),

  /**
   * Motivos de pérdida del catálogo · HU-CLI-05 y HU-COT-12.
   *
   * El ámbito decide la lista: los de expediente no sirven para cerrar una
   * cotización y el backend rechaza mezclarlos.
   */
  lossReasons: (scope: LossReasonScope = "client", includeInactive = false) =>
    authed<LossReason[]>(`/loss-reasons${toQuery({ scope, includeInactive })}`),

  listClients: (filters: ClientFilters = {}) =>
    authed<Paginated<ClientSummary>>(`/clients${toQuery(filters)}`),

  /** Contadores de las columnas del Kanban; respeta los mismos filtros. */
  stageCounts: (filters: ClientFilters = {}) =>
    authed<Record<string, number>>(`/clients/stage-counts${toQuery(filters)}`),

  getClient: (id: string) => authed<ClientDetail>(`/clients/${id}`),

  activity: (id: string) => authed<ActivityEvent[]>(`/clients/${id}/activity`),

  createClient: (input: CreateClientInput) =>
    authed<ClientDetail>("/clients", { method: "POST", body: input }),

  updateClient: (id: string, input: UpdateClientInput) =>
    authed<ClientDetail>(`/clients/${id}`, { method: "PATCH", body: input }),

  moveStage: (id: string, pipelineStageId: string) =>
    authed<ClientSummary>(`/clients/${id}/stage`, {
      method: "PATCH",
      body: { pipelineStageId },
    }),

  /**
   * Descartar un prospecto · HU-CLI-05.
   *
   * El motivo es obligatorio y viaja como referencia al catálogo, no como texto:
   * el análisis de pérdida agrupa por código, no parseando cadenas.
   */
  markLost: (id: string, lostReasonId: string, note?: string) =>
    authed<ClientSummary>(`/clients/${id}/lost`, {
      method: "PATCH",
      body: { lostReasonId, note },
    }),

  /** Reasignar la cartera de otro. Solo Gerente y Administrador (HU-CLI-04). */
  assignAdvisor: (id: string, assignedAdvisorId: string | null) =>
    authed<ClientSummary>(`/clients/${id}/advisor`, {
      method: "PATCH",
      body: { assignedAdvisorId },
    }),

  /**
   * Dejar constancia de que se habló con el cliente · HU-EXP-02.
   *
   * La fecha del contacto la pone el servidor. `nextFollowUpAt` es opcional:
   * omitirlo deja la próxima acción como está, `null` la borra.
   */
  logContact: (id: string, input: { note?: string; nextFollowUpAt?: string | null }) =>
    authed<ClientDetail>(`/clients/${id}/contacto`, { method: "POST", body: input }),

  /**
   * Tomar un prospecto sin dueño · HU-CLI-04.
   *
   * No lleva cuerpo a propósito: el responsable nuevo es siempre quien llama, y
   * eso lo decide el backend a partir de la sesión. Es la vía de captación de los
   * prospectos que entran sin asignar.
   */
  claimClient: (id: string) =>
    authed<ClientSummary>(`/clients/${id}/claim`, { method: "PATCH" }),

  /* ── Proveedores · HU-PRO-01 a HU-PRO-05 ─────────────────────────────────── */

  listSuppliers: (filters: SupplierFilters = {}) =>
    authed<Paginated<Supplier>>(`/suppliers${toQuery(filters)}`),

  getSupplier: (id: string) => authed<Supplier>(`/suppliers/${id}`),

  supplierUsage: (id: string) => authed<SupplierUsage>(`/suppliers/${id}/usage`),

  createSupplier: (input: SupplierInput) =>
    authed<Supplier>("/suppliers", { method: "POST", body: input }),

  /** El tipo no viaja: no se edita una vez registrado. */
  updateSupplier: (id: string, input: Omit<Partial<SupplierInput>, "type">) =>
    authed<Supplier>(`/suppliers/${id}`, { method: "PATCH", body: input }),

  /** Desactivar, nunca eliminar (DM-06): devuelve cuántas cotizaciones lo usan. */
  deactivateSupplier: (id: string) =>
    authed<Supplier & { totalQuotes: number }>(`/suppliers/${id}/deactivate`, {
      method: "PATCH",
    }),

  activateSupplier: (id: string) =>
    authed<Supplier & { totalQuotes: number }>(`/suppliers/${id}/activate`, {
      method: "PATCH",
    }),

  /* ── Cotizaciones · HU-COT-01 a HU-COT-12 ────────────────────────────────── */

  listQuotes: (filters: QuoteFilters = {}) =>
    authed<Paginated<QuoteSummary>>(`/quotes${toQuery(filters)}`),

  /** KPI del listado; respeta los mismos filtros. */
  quotesSummary: (filters: QuoteFilters = {}) =>
    authed<QuotesSummary>(`/quotes/summary${toQuery(filters)}`),

  getQuote: (id: string) => authed<QuoteDetail>(`/quotes/${id}`),

  /** Historial completo; la vigente es la de mayor número (HU-COT-11). */
  quoteVersions: (id: string) => authed<QuoteVersionData[]>(`/quotes/${id}/versions`),

  createQuote: (input: QuoteInput) =>
    authed<QuoteDetail>("/quotes", { method: "POST", body: input }),

  /**
   * En borrador corrige la versión vigente; enviada, genera una nueva.
   *
   * `null` en un campo lo VACÍA; omitirlo lo conserva. La distinción es real y
   * el backend la respeta: sin ella no había forma de borrar unas condiciones y
   * cada versión nueva salía con el texto viejo pegado.
   */
  updateQuote: (id: string, input: QuoteUpdateInput) =>
    authed<QuoteDetail>(`/quotes/${id}`, { method: "PATCH", body: input }),

  /**
   * El motivo CATALOGADO es obligatorio al rechazar y al descartar.
   *
   * `reason` es el detalle libre y acompaña al motivo; no lo sustituye.
   */
  changeQuoteStatus: (
    id: string,
    status: QuoteStatus,
    close: { reasonId?: string; reason?: string } = {},
  ) =>
    authed<QuoteDetail>(`/quotes/${id}/status`, {
      method: "PATCH",
      body: { status, ...close },
    }),

  /** Copia la versión vigente en un borrador nuevo, con código propio. */
  duplicateQuote: (id: string) =>
    authed<QuoteDetail>(`/quotes/${id}/duplicar`, { method: "POST" }),

  /**
   * Contenido del archivo, servido por el API · HU-ARC-02.
   *
   * Se usa para DESCARGAR. Para mostrarlo incrustado sigue sirviendo `fileUrl`,
   * que devuelve el enlace firmado y se consume al instante.
   */
  downloadFile: async (fileId: string) => {
    const token = await getIdToken();
    if (!token) throw new Error("La sesión expiró. Volvé a iniciar sesión.");
    return apiDownload(`/files/${fileId}/download`, token);
  },

  /** Reasignar el responsable. Solo Gerente y Administrador (matriz 4.2). */
  reassignQuote: (id: string, advisorId: string) =>
    authed<QuoteDetail>(`/quotes/${id}/asesor`, {
      method: "PATCH",
      body: { advisorId },
    }),

  /** Genera el PDF y lo manda; el estado avanza solo si el correo salió. */
  sendQuote: (id: string, input: { to?: string[]; message?: string } = {}) =>
    authed<{ quote: QuoteDetail; recipients: string[]; simulated: boolean }>(
      `/quotes/${id}/send`,
      { method: "POST", body: input },
    ),

  /* ── Ventas y cobros · HU-VEN-01 a HU-VEN-08 ─────────────────────────────── */

  listSales: (filters: SaleFilters = {}) =>
    authed<Paginated<SaleSummary>>(`/sales${toQuery(filters)}`),

  /** KPI del listado; respeta los mismos filtros. */
  salesSummary: (filters: SaleFilters = {}) =>
    authed<SalesSummary>(`/sales/summary${toQuery(filters)}`),

  getSale: (id: string) => authed<SaleDetail>(`/sales/${id}`),

  /**
   * Estado de cuenta en PDF · hallazgo `F1`.
   *
   * Pasa por `apiDownload` y no por un enlace directo al endpoint: la ruta exige
   * sesión, y una navegación del navegador no lleva la cabecera `Authorization`
   * —abrirla en una pestaña devolvía 401 sin decir por qué—.
   */
  saleStatement: async (id: string) => {
    const token = await getIdToken();
    if (!token) throw new Error("La sesión expiró. Volvé a iniciar sesión.");
    return apiDownload(`/sales/${id}/estado-cuenta`, token);
  },

  /** Crea UNA venta ligada a la versión aceptada (HU-VEN-02). */
  acceptQuote: (quoteId: string, input: { paymentDueDate?: string } = {}) =>
    authed<SaleWithConfirmation>(`/quotes/${quoteId}/accept`, {
      method: "POST",
      body: input,
    }),

  createSale: (input: CreateSaleInput) =>
    authed<SaleWithConfirmation>("/sales", { method: "POST", body: input }),

  /** El backend recalcula saldo y emite el comprobante REC-NNNN. */
  registerPayment: (id: string, input: RegisterPaymentInput) =>
    authed<SaleDetail>(`/sales/${id}/payments`, { method: "POST", body: input }),

  /** Corregir destino, fechas de viaje y fecha límite · `B3`. */
  updateSale: (
    id: string,
    input: {
      destination?: string;
      tripStart?: string | null;
      tripEnd?: string | null;
      paymentDueDate?: string | null;
    },
  ) => authed<SaleDetail>(`/sales/${id}`, { method: "PATCH", body: input }),

  /** Reasignar el asesor · `B3`. Gerente o Administrador. */
  reassignSale: (id: string, advisorId: string) =>
    authed<SaleDetail>(`/sales/${id}/asesor`, {
      method: "PATCH",
      body: { advisorId },
    }),

  /** Dejar constancia de una gestión de cobro · agenda de cobro. */
  logCollectionContact: (id: string, note?: string) =>
    authed<SaleDetail>(`/sales/${id}/gestion-cobro`, {
      method: "POST",
      body: { note },
    }),

  /** Historial append-only de la venta · `G5`. */
  saleActivity: (id: string) => authed<SaleActivity[]>(`/sales/${id}/activity`),

  /** Anular la factura interna · DM-20. Gerente o Administrador. */
  voidInvoice: (id: string, reason: string) =>
    authed<SaleDetail>(`/sales/${id}/invoice/anular`, {
      method: "POST",
      body: { reason },
    }),

  /** Anular un abono · DM-15. Gerente o Administrador. */
  voidPayment: (id: string, paymentId: string, reason: string) =>
    authed<SaleDetail>(`/sales/${id}/payments/${paymentId}/anular`, {
      method: "POST",
      body: { reason },
    }),

  changeSaleStatus: (id: string, status: SaleStatus, reason?: string) =>
    authed<SaleDetail>(`/sales/${id}/status`, {
      method: "PATCH",
      body: { status, reason },
    }),

  /** Correlativo permanente: solo se emite una vez por venta (DV-11). */
  issueInvoice: (id: string) =>
    authed<SaleDetail>(`/sales/${id}/invoice`, { method: "POST" }),

  sendSaleConfirmation: (id: string, input: { to?: string[]; message?: string } = {}) =>
    authed<SaleWithConfirmation>(`/sales/${id}/confirmation`, {
      method: "POST",
      body: input,
    }),

  /* ── Archivos · HU-ARC-01 y HU-ARC-02 ────────────────────────────────────── */

  clientFiles: (clientId: string) =>
    authed<StoredFileRef[]>(`/files?clientId=${clientId}`),

  /** URL firmada temporal: los archivos nunca son públicos. */
  fileUrl: (id: string) =>
    authed<{ url: string; fileName: string; mimeType: string; expiresInMinutes: number }>(
      `/files/${id}/url`,
    ),

  /** PDF, JPG o PNG · máximo 10 MB. El backend vuelve a validarlo. */
  uploadFile: async (
    file: File,
    params: {
      clientId: string;
      fileType: FileType;
      relatedEntityId?: string;
      relatedEntityType?: "quoteVersion" | "sale" | "other";
    },
  ) => {
    const token = await getIdToken();
    if (!token) throw new Error("La sesión expiró. Volvé a iniciar sesión.");
    return apiUpload<StoredFileRef>(`/files${toQuery(params)}`, file, token);
  },

  /* ── Dashboard · HU-DAS-01, HU-DAS-02 y HU-DAS-07 ────────────────────────── */

  dashboard: (filters: { from?: string; to?: string; advisorId?: string } = {}) =>
    authed<DashboardSummary>(`/dashboard/summary${toQuery(filters)}`),
};

/** Formato de moneda para montos que llegan como string desde Decimal128. */
export function formatMoney(value: string | null): string {
  if (value === null) return "—";
  const amount = Number(value);
  if (Number.isNaN(amount)) return "—";
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Igual que `formatMoney`, pero con los centavos a la vista.
 *
 * Los cobros se muestran al centavo: un abono de 1,300.50 redondeado a 1,301
 * en la pantalla del saldo hace que las cuentas no cierren contra el
 * comprobante que recibió el cliente.
 */
export function formatAmount(value: string | null): string {
  if (value === null) return "—";
  const amount = Number(value);
  if (Number.isNaN(amount)) return "—";
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Porcentaje cobrado de una venta, acotado a 0–100 para la barra de progreso. */
export function paidPercentage(paid: string, total: string): number {
  const paidValue = Number(paid);
  const totalValue = Number(total);
  if (!Number.isFinite(paidValue) || !Number.isFinite(totalValue) || totalValue <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((paidValue / totalValue) * 100)));
}

/** "hace 2 h", "ayer", "5 d" — como en las tarjetas del wireframe. */
/**
 * ¿La próxima acción ya venció? · HU-EXP-02.
 *
 * Se compara contra el FIN del día comprometido, no contra el instante: una
 * fecha de hoy no está vencida hasta que hoy termina. Sin eso, un seguimiento
 * puesto para hoy aparecía en rojo desde la mañana.
 */
export function isFollowUpOverdue(iso: string | null): boolean {
  if (!iso) return false;
  const due = new Date(iso);
  due.setHours(23, 59, 59, 999);
  return due.getTime() < Date.now();
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ayer";
  if (days < 30) return `${days} d`;
  return new Date(iso).toLocaleDateString("es-SV", { day: "2-digit", month: "short" });
}
