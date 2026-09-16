"use client";

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { EmailLinks, PhoneLinks } from "@/components/ContactLinks";
import { SignedFileLink } from "@/components/SignedFileLink";
import { useSession, type SessionUser } from "@/lib/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import {
  crmApi,
  DUPLICATE_REASON_LABEL,
  formatAmount,
  formatMoney,
  isFollowUpOverdue,
  relativeTime,
  type ActivityEvent,
  type ClientDetail,
  type ConversationSummary,
  type DuplicateMatch,
  type PipelineStage,
  type QuoteSummary,
  type SaleSummary,
  type StoredFileRef,
  type Tag,
  type TeamMember,
  type UpdateClientInput,
} from "@/lib/api/crm";
import {
  CHANNEL_LABEL,
  CONVERSATION_STATUS_LABEL,
  FILE_TYPE_LABEL,
  PIPELINE_STAGE_COLOR,
  PIPELINE_STAGE_LABEL,
  QUOTE_STATUS_LABEL,
  SALE_STATUS_LABEL,
  SOURCE_CHANNEL_LABEL,
  stageLabel,
  type FileType,
  QUOTE_STATUS_CHIP,
  type SourceChannel,
} from "@/lib/domain/enums";
import {
  MarkLostModal,
  MergeClientsModal,
  RegistrarContactoModal,
  splitList,
} from "../modals";
import { NuevaVentaModal } from "../../ventas/modals";
import { SALE_STATUS_CHIP } from "../../ventas/VentasView";

const CHANNEL_CLASS: Record<SourceChannel, string> = {
  whatsapp: "wa",
  messenger: "ms",
  instagram: "ig",
  other: "",
};

/** Pestañas del expediente. */
const TABS = [
  { id: "datos", label: "Datos generales" },
  { id: "cotizaciones", label: "Cotizaciones" },
  { id: "ventas", label: "Ventas" },
  { id: "conversaciones", label: "Conversaciones" },
  { id: "archivos", label: "Archivos" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const ACTION_LABEL: Record<string, string> = {
  created: "Expediente creado",
  updated: "Datos editados",
  stage_changed: "Cambio de etapa",
  contact_logged: "Contacto registrado",
  assigned: "Responsable asignado",
  status_changed: "Cambio de estado",
  merged: "Expedientes fusionados",
};

/** Canal de una conversación → clase de color del chip. */
const CONVERSATION_CHANNEL_CLASS = { whatsapp: "wa", messenger: "ms", instagram: "ig" } as const;

/** Mismo formato que acepta el backend: monto en dólares, hasta dos decimales. */
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Quién puede editar este expediente · HU-EXP-02.
 *
 * Espejo de la regla del backend (transversal 8.2): el Asesor edita lo propio y
 * lo que está sin asignar; Gerente y Administrador editan todo. Ocultar el botón
 * no autoriza nada — el backend vuelve a comprobarlo en cada PATCH.
 */
function canEditClient(user: SessionUser | null, client: ClientDetail): boolean {
  if (!user) return false;
  if (user.role !== "advisor") return true;
  return !client.advisor || client.advisor.id === user.id;
}

export function ExpedienteView({ clientId }: { clientId: string }) {
  const { user } = useSession();
  const router = useRouter();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [merging, setMerging] = useState<DuplicateMatch | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loggingContact, setLoggingContact] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [tab, setTab] = useState<TabId>("datos");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, events, stageList, tagList] = await Promise.all([
        crmApi.getClient(clientId),
        crmApi.activity(clientId),
        crmApi.stages(),
        // Con las desactivadas: el expediente puede tener alguna asignada de
        // antes y hay que poder mostrarla con su nombre.
        crmApi.tags(true),
      ]);
      setClient(detail);
      setActivity(events);
      setStages(stageList);
      setTags(tagList);
      // Aparte y tolerante a fallos: sin el equipo se pierde el selector de
      // responsable, no el expediente entero.
      crmApi.team().then(setTeam).catch(() => undefined);
      // HU-CLI-10: igual de accesorio. Sin la sugerencia el expediente sirve.
      crmApi.clientDuplicates(clientId).then(setDuplicates).catch(() => setDuplicates([]));
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 404
          ? "Este expediente no existe o fue fusionado con otro."
          : "No se pudo cargar el expediente.",
      );
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Guarda un tramo del expediente · HU-EXP-02.
   *
   * Deja subir el error para que la tarjeta lo muestre junto al campo. La
   * actividad se refresca porque la edición acaba de sumar un evento; si ese
   * refresco falla no se deshace nada: el dato ya está guardado.
   */
  const saveSection = useCallback(
    async (patch: UpdateClientInput) => {
      setClient(await crmApi.updateClient(clientId, patch));
      const events = await crmApi.activity(clientId).catch(() => null);
      if (events) setActivity(events);
    },
    [clientId],
  );

  if (error) {
    return (
      <div className="card" style={{ padding: 48, textAlign: "center" }}>
        <div style={{ color: "var(--red)", fontWeight: 600, marginBottom: 12 }}>{error}</div>
        <Link href="/clientes" className="btn ghost">
          Volver a clientes
        </Link>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-mute)" }}>
        Cargando expediente…
      </div>
    );
  }

  const stage = stages.find((s) => s.id === client.pipelineStageId);
  const merged = client.status === "merged";
  // Un expediente fusionado es constancia: se trabaja sobre el destino.
  const canEdit = !merged && canEditClient(user, client);

  return (
    <>
      {/* Encabezado · wireframe 04 */}
      <div className="card exp-head">
        <span className="avatar o1" style={{ width: 46, height: 46, fontSize: 16 }}>
          {client.initials}
        </span>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 22, color: "var(--navy)" }}>
              {client.fullName}
            </h1>
            {client.identities.map((identity) => (
              <span
                key={`${identity.channel}:${identity.externalId}`}
                className={`chip ${CHANNEL_CLASS[identity.channel]}`}
              >
                {CHANNEL_LABEL[identity.channel]}
              </span>
            ))}
            {client.status === "lost" && <span className="chip red">Descartado</span>}
          </div>

          <div className="exp-meta">
            {stage && (
              <StageControl
                client={client}
                stage={stage}
                stages={stages}
                canEdit={canEdit}
                onChanged={load}
                onRequestLost={() => setDiscarding(true)}
              />
            )}
            <AdvisorControl
              client={client}
              user={user}
              team={team}
              onChanged={load}
            />
            <span>
              <Icon name="globe" />
              {SOURCE_CHANNEL_LABEL[client.sourceChannel]}
            </span>
          </div>

          {client.status === "lost" && client.lostReason && (
            <div className="auth-alert error" style={{ marginTop: 12 }}>
              <Icon name="target" />
              <div>
                <b>Motivo del descarte:</b>{" "}
                {client.lostReason.name ?? "Motivo retirado del catálogo"}
                {client.lostReasonNote && (
                  <div style={{ marginTop: 4, fontWeight: 400 }}>
                    {client.lostReasonNote}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* B6: reactivar ya no borra el motivo, así que se puede contar la
              historia completa — se perdió por esto y después volvió. */}
          {client.status !== "lost" && client.reactivatedAt && client.lostReason && (
            <div className="reactivated-note">
              <Icon name="check" />
              <div>
                Se había descartado por{" "}
                <b>{client.lostReason.name ?? "un motivo retirado"}</b> y volvió al flujo{" "}
                {relativeTime(client.reactivatedAt)}.
              </div>
            </div>
          )}
        </div>

        <div className="actions">
          {canEdit && client.status !== "lost" && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => setDiscarding(true)}
            >
              <Icon name="target" />
              Descartar
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => setLoggingContact(true)}
            >
              <Icon name="check" />
              Registrar contacto
            </button>
          )}
          {/* HU-EXP-04: el cliente viaja en la URL y el editor lo precarga. */}
          <Link href={`/cotizaciones/nueva?clientId=${client.id}`} className="btn primary">
            <Icon name="doc" />
            Nueva cotización
          </Link>
        </div>
      </div>

      {merged && (
        <div className="auth-alert info" style={{ marginTop: 14 }} role="note">
          <Icon name="users" />
          <div>
            Este expediente se fusionó con otro y quedó como constancia. Sus cotizaciones, ventas,
            archivos y conversaciones están en el expediente destino.{" "}
            {client.mergedIntoClientId && (
              <Link href={`/clientes/${client.mergedIntoClientId}`} style={{ fontWeight: 700, color: "inherit" }}>
                Ir al expediente destino
              </Link>
            )}
          </div>
        </div>
      )}

      {!merged && !canEdit && (
        <div
          className="card"
          style={{ marginTop: 14, padding: 14, display: "flex", gap: 10, alignItems: "center" }}
        >
          <Icon name="lock" style={{ color: "var(--text-faint)", flex: "none" }} />
          <div style={{ fontSize: 12, color: "var(--text-mute)", lineHeight: 1.6 }}>
            Este expediente es de <b>{client.advisor?.fullName}</b>, así que lo ves
            completo pero no lo podés editar. Pedile a un Gerente que te lo reasigne.
          </div>
        </div>
      )}

      <div className="viewtabs" style={{ margin: "14px 0" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="exp-body">
        <div style={{ minWidth: 0 }}>
          {tab === "datos" ? (
            <DatosGenerales
              client={client}
              tags={tags}
              canEdit={canEdit}
              onSave={saveSection}
            />
          ) : tab === "cotizaciones" ? (
            <CotizacionesTab clientId={client.id} />
          ) : tab === "ventas" ? (
            <VentasTab clientId={client.id} canEdit={canEdit} />
          ) : tab === "archivos" ? (
            <ArchivosTab clientId={client.id} canEdit={canEdit} />
          ) : (
            <ConversacionesTab clientId={client.id} />
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {!merged && duplicates.length > 0 && (
            <DuplicadosCard
              duplicates={duplicates}
              canMerge={canReassign(user)}
              onMerge={setMerging}
            />
          )}

          <ValorEstimadoCard client={client} canEdit={canEdit} onSave={saveSection} />

          <SeguimientoCard client={client} />

          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
              Actividad reciente
            </div>
            {activity.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
                Sin eventos registrados.
              </div>
            ) : (
              <div className="timeline">
                {activity.map((event) => (
                  <div key={event.id} className="timeline-item">
                    <div className="dot" />
                    <div>
                      <b>{ACTION_LABEL[event.action] ?? event.action}</b>
                      <ChangeSummary event={event} />
                      <span className="when">
                        {event.actor} · {relativeTime(event.occurredAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {discarding && (
        <MarkLostModal
          client={client}
          onClose={() => setDiscarding(false)}
          onDone={() => {
            setDiscarding(false);
            // Se recarga el expediente entero: `markLost` devuelve el resumen y
            // acá hace falta el detalle, más la actividad que acaba de crecer.
            void load();
          }}
        />
      )}

      {merging && (
        <MergeClientsModal
          current={client}
          candidate={merging.client}
          onClose={() => setMerging(null)}
          onMerged={(targetId) => {
            setMerging(null);
            // Si quedó el otro, este expediente pasó a ser constancia: se va al que quedó.
            if (targetId === client.id) void load();
            else router.push(`/clientes/${targetId}`);
          }}
        />
      )}

      {loggingContact && (
        <RegistrarContactoModal
          client={client}
          onClose={() => setLoggingContact(false)}
          onDone={(updated) => {
            setClient(updated);
            setLoggingContact(false);
            // El contacto acaba de sumar un evento; si el refresco falla no se
            // deshace nada, el dato ya está guardado.
            crmApi.activity(clientId).then(setActivity).catch(() => undefined);
          }}
        />
      )}
    </>
  );
}

/* ──────────────────── Seguimiento del expediente · HU-EXP-02 ─────────────── */

/**
 * Último contacto y próxima acción, juntos.
 *
 * Van en la misma tarjeta porque se leen juntos: "hace cuánto no hablamos" solo
 * significa algo al lado de "cuándo quedamos en volver a hablar".
 */
function SeguimientoCard({ client }: { client: ClientDetail }) {
  const overdue = isFollowUpOverdue(client.nextFollowUpAt);

  return (
    <div className={`card followup-card${overdue ? " is-overdue" : ""}`}>
      <div className="card-h">
        <span className="ttl">Seguimiento</span>
        {overdue && <span className="chip red">Vencido</span>}
      </div>

      <div className="kv-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div>
          <span className="k">Último contacto</span>
          <span className="v">
            {client.lastContactAt ? relativeTime(client.lastContactAt) : "Sin registrar"}
          </span>
        </div>
        <div>
          <span className="k">Próxima acción</span>
          <span className="v" style={overdue ? { color: "var(--red)" } : undefined}>
            {client.nextFollowUpAt
              ? new Date(client.nextFollowUpAt).toLocaleDateString("es-SV", {
                  day: "2-digit",
                  month: "long",
                })
              : "Sin fecha"}
          </span>
        </div>
      </div>

      <div style={{ ...hintStyle, marginTop: 12 }}>
        <Icon name="calendar" width={12} height={12} />
        Se registra con el botón «Registrar contacto». Nunca se mueve sola al editar
        la ficha.
      </div>
    </div>
  );
}

/* ──────────────── Etapa del expediente · HU-CLI-03 ────────────────────────── */

/**
 * Etapa, editable donde se lee.
 *
 * Antes era texto de solo lectura: la única forma de avanzar una oportunidad era
 * volver al tablero y arrastrar la tarjeta. Pero el asesor trabaja desde acá —lee
 * las notas, registra el contacto, arma la cotización—, y obligarlo a salir en
 * cada movimiento tenía un costo real: la etapa se dejaba de actualizar y el
 * tablero terminaba mostrando un embudo que no era el de verdad.
 */
function StageControl({
  client,
  stage,
  stages,
  canEdit,
  onChanged,
  onRequestLost,
}: {
  client: ClientDetail;
  stage: PipelineStage;
  stages: PipelineStage[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onRequestLost: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stage.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const target = stages.find((s) => s.id === draft);
    if (!target || target.id === stage.id) {
      setEditing(false);
      return;
    }

    // Descartar exige motivo: el backend rechaza el movimiento directo a la etapa
    // terminal, así que se abre el modal en vez de provocar un error (HU-CLI-05).
    if (target.isTerminal) {
      setEditing(false);
      onRequestLost();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await crmApi.moveStage(client.id, target.id);
      await onChanged();
      setEditing(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo cambiar la etapa.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <span className="advisor-control is-editing">
        <Icon name="pin" />
        <select
          className="input tiny"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          aria-label="Etapa del expediente"
          autoFocus
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {stageLabel(s)}
            </option>
          ))}
        </select>
        <button type="button" className="btn primary tiny" disabled={busy} onClick={() => void save()}>
          {busy ? "Moviendo…" : "Mover"}
        </button>
        <button
          type="button"
          className="btn ghost tiny"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          Cancelar
        </button>
        {error && <span className="advisor-error">{error}</span>}
      </span>
    );
  }

  return (
    <span className="advisor-control">
      <Icon name="pin" />
      <span className={`chip ${PIPELINE_STAGE_COLOR[stage.code]?.chip ?? ""}`}>
        {stageLabel(stage)}
      </span>
      {canEdit && (
        <button
          type="button"
          className="btn ghost tiny"
          onClick={() => {
            setDraft(stage.id);
            setError(null);
            setEditing(true);
          }}
        >
          <Icon name="edit" />
          Cambiar
        </button>
      )}
    </span>
  );
}

/* ─────────────── Responsable del expediente · HU-CLI-04 ──────────────────── */

/**
 * Quién puede reasignar la cartera de otro.
 *
 * Espejo de la matriz 4.2: solo Gerente y Administrador. Tomar un prospecto SIN
 * dueño es otra cosa y la puede cualquiera — el backend vuelve a comprobar las
 * dos reglas, esto solo decide qué controles se dibujan.
 */
function canReassign(user: SessionUser | null): boolean {
  return user?.role === "admin" || user?.role === "manager";
}

/**
 * Responsable, editable en el mismo lugar donde se lee.
 *
 * Antes era texto muerto: el endpoint de reasignación existía y ningún control lo
 * llamaba, así que el aviso "pedile a un Gerente que te lo reasigne" no tenía
 * destinatario posible. Y un prospecto que entraba sin dueño —la vía normal de
 * captación desde Meta— no lo podía tomar nadie.
 */
function AdvisorControl({
  client,
  user,
  team,
  onChanged,
}: {
  client: ClientDetail;
  user: SessionUser | null;
  team: TeamMember[];
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(client.advisor?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reassignable = canReassign(user);
  const claimable = !client.advisor && user !== null && client.status !== "merged";

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
      setEditing(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo cambiar el responsable.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <span className="advisor-control is-editing">
        <Icon name="users" />
        <select
          className="input tiny"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          aria-label="Responsable del expediente"
          autoFocus
        >
          <option value="">Sin asignar</option>
          {team.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn primary tiny"
          disabled={busy}
          onClick={() => void run(() => crmApi.assignAdvisor(client.id, draft || null))}
        >
          {busy ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          className="btn ghost tiny"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          Cancelar
        </button>
        {error && <span className="advisor-error">{error}</span>}
      </span>
    );
  }

  return (
    <span className="advisor-control">
      <Icon name="users" />
      {client.advisor ? (
        client.advisor.fullName
      ) : (
        <span className="chip amber">Sin asignar</span>
      )}

      {claimable && (
        <button
          type="button"
          className="btn primary tiny"
          disabled={busy}
          onClick={() => void run(() => crmApi.claimClient(client.id))}
        >
          {busy ? "Tomando…" : "Tomar este prospecto"}
        </button>
      )}

      {reassignable && (
        <button
          type="button"
          className="btn ghost tiny"
          onClick={() => {
            setDraft(client.advisor?.id ?? "");
            setError(null);
            setEditing(true);
          }}
        >
          <Icon name="edit" />
          {client.advisor ? "Reasignar" : "Asignar"}
        </button>
      )}

      {error && <span className="advisor-error">{error}</span>}
    </span>
  );
}

/** Mantenimiento del registro, no cambios de negocio: no se muestran. */
const INTERNAL_FIELDS = [
  // Por dónde se asignó (tomar la conversación, reasignar): dato de auditoría.
  "via",
  "_id",
  "__v",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "normalizedName",
  "identityKeys",
];

const FIELD_LABEL: Record<string, string> = {
  stage: "Etapa",
  fullName: "Nombre",
  primaryPhone: "Teléfono",
  primaryEmail: "Correo",
  internalNotes: "Notas internas",
  estimatedValue: "Valor estimado",
  travelPreferences: "Preferencias de viaje",
  tagIds: "Etiquetas",
  identities: "Identidades",
  lostReason: "Motivo del descarte",
  assignedAdvisorId: "Responsable",
  absorbed: "Absorbió a",
  mergedInto: "Fusionado en",
  moved: "Registros movidos",
  sourceChannel: "Canal de origen",
  status: "Estado",
};

/**
 * Un valor del diff en texto, o `null` si no se puede resumir en una línea.
 *
 * Los montos llegan como Decimal128 serializado y las preferencias como objeto:
 * pasarlos por `String()` imprimía "[object Object]" en el historial.
 */
function describeValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return String(value);

  if (typeof value === "string") {
    const label = PIPELINE_STAGE_LABEL[value as keyof typeof PIPELINE_STAGE_LABEL];
    const text = label ?? value;
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  }

  if (typeof value === "object" && "$numberDecimal" in (value as object)) {
    return formatMoney((value as { $numberDecimal: string }).$numberDecimal);
  }

  return null;
}

/**
 * Resume el diff del evento en una línea legible · HU-EXP-03.
 *
 * Lo que no cabe en un "antes → después" se nombra sin volcarlo: saber que se
 * tocaron las preferencias de viaje ya orienta, y el detalle está en la ficha.
 */
function ChangeSummary({ event }: { event: ActivityEvent }) {
  if (!event.changes) return null;

  const parts = Object.entries(event.changes)
    // El backend ya no los registra, pero los eventos viejos siguen guardados:
    // `audit_events` es append-only, así que el pasado se filtra al mostrarlo.
    .filter(([field]) => !INTERNAL_FIELDS.includes(field))
    .slice(0, 3)
    .map(([field, change]) => {
      const label = FIELD_LABEL[field] ?? field;
      const from = describeValue(change.from);
      const to = describeValue(change.to);
      return from !== null && to !== null ? `${label}: ${from} → ${to}` : label;
    });

  if (parts.length === 0) return null;
  return <span className="detail">{parts.join(" · ")}</span>;
}

/* ─────────────────────── Edición en línea · HU-EXP-02 ─────────────────────── */

type InlineEdit<T> = {
  draft: T;
  setDraft: Dispatch<SetStateAction<T>>;
  editing: boolean;
  saving: boolean;
  error: string | null;
  start: () => void;
  cancel: () => void;
  submit: (event: FormEvent) => Promise<void>;
};

/**
 * Estado de una tarjeta editable.
 *
 * El borrador se copia del valor actual al entrar en edición, no al montar: así
 * "Cancelar" descarta de verdad y una edición ajena que llegue mientras tanto no
 * se pisa con datos viejos.
 */
function useInlineEdit<T>(current: T, save: (draft: T) => Promise<void>): InlineEdit<T> {
  const [draft, setDraft] = useState<T>(current);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return {
    draft,
    setDraft,
    editing,
    saving,
    error,
    start: () => {
      setDraft(current);
      setError(null);
      setEditing(true);
    },
    cancel: () => {
      setEditing(false);
      setError(null);
    },
    submit: async (event: FormEvent) => {
      event.preventDefault();
      setSaving(true);
      setError(null);
      try {
        await save(draft);
        setEditing(false);
      } catch (caught) {
        // El backend explica por qué rechazó —permiso, formato, duplicado— y ese
        // mensaje le sirve más al usuario que uno genérico.
        setError(
          caught instanceof ApiError ? caught.message : "No se pudo guardar el cambio.",
        );
      } finally {
        setSaving(false);
      }
    },
  };
}

/** Tarjeta que alterna entre mostrar los datos y editarlos en el mismo lugar. */
function EditableCard<T>({
  title,
  edit,
  canEdit,
  canSave = true,
  children,
  form,
}: {
  title: string;
  edit: InlineEdit<T>;
  canEdit: boolean;
  /** Validación previa; el backend igual la repite. */
  canSave?: boolean;
  children: ReactNode;
  form: ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-h">
        <span className="ttl">{title}</span>
        {canEdit && !edit.editing && (
          <button type="button" className="btn ghost tiny" onClick={edit.start}>
            <Icon name="edit" />
            Editar
          </button>
        )}
      </div>

      {edit.editing ? (
        <form onSubmit={edit.submit}>
          {edit.error && (
            <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
              <Icon name="target" />
              <div>{edit.error}</div>
            </div>
          )}

          {form}

          <div className="edit-foot">
            <button
              type="button"
              className="btn ghost"
              onClick={edit.cancel}
              disabled={edit.saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={edit.saving || !canSave}
            >
              {edit.saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      ) : (
        children
      )}
    </div>
  );
}

function DatosGenerales({
  client,
  tags,
  canEdit,
  onSave,
}: {
  client: ClientDetail;
  tags: Tag[];
  canEdit: boolean;
  onSave: (patch: UpdateClientInput) => Promise<void>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <ContactoCard client={client} canEdit={canEdit} onSave={onSave} />

      <div className="card">
        <div className="card-h">
          <span className="ttl">Identidades vinculadas</span>
        </div>
        {client.identities.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
            Sin identidades de Meta. Se vinculan solas cuando el contacto escribe por
            WhatsApp, Messenger o Instagram.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {client.identities.map((identity) => (
              <span
                key={`${identity.channel}:${identity.externalId}`}
                className={`chip ${CHANNEL_CLASS[identity.channel]}`}
                style={{ padding: "7px 12px" }}
              >
                {identity.username ?? identity.externalId}
                {identity.isPrimary && " · principal"}
              </span>
            ))}
          </div>
        )}
      </div>

      <PreferenciasCard client={client} canEdit={canEdit} onSave={onSave} />
      <EtiquetasCard client={client} tags={tags} canEdit={canEdit} onSave={onSave} />
      <NotasCard client={client} canEdit={canEdit} onSave={onSave} />
    </div>
  );
}

type CardProps = {
  client: ClientDetail;
  canEdit: boolean;
  onSave: (patch: UpdateClientInput) => Promise<void>;
};

function ContactoCard({ client, canEdit, onSave }: CardProps) {
  const edit = useInlineEdit(
    {
      fullName: client.fullName,
      primaryPhone: client.primaryPhone ?? "",
      primaryEmail: client.primaryEmail ?? "",
    },
    (draft) =>
      onSave({
        fullName: draft.fullName.trim(),
        // `null` vacía el campo; "" no pasa la validación de correo del backend.
        primaryPhone: draft.primaryPhone.trim() || null,
        primaryEmail: draft.primaryEmail.trim() || null,
      }),
  );

  // DM-14: la ficha no puede quedarse sin ningún medio de contacto. El backend
  // lo rechaza igual; acá se evita el viaje y se explica antes de intentarlo.
  const hasContact =
    edit.draft.primaryPhone.trim() !== "" ||
    edit.draft.primaryEmail.trim() !== "" ||
    client.identities.length > 0;

  return (
    <EditableCard
      title="Información de contacto"
      edit={edit}
      canEdit={canEdit}
      canSave={hasContact && edit.draft.fullName.trim().length >= 3}
      form={
        <>
          <label className="label" htmlFor="fullName">
            Nombre completo
          </label>
          <input
            id="fullName"
            className="input"
            required
            minLength={3}
            value={edit.draft.fullName}
            onChange={(e) => edit.setDraft((d) => ({ ...d, fullName: e.target.value }))}
            disabled={edit.saving}
            autoFocus
          />

          <div className="modal-grid" style={{ marginTop: 14 }}>
            <div>
              <label className="label" htmlFor="primaryPhone">
                Teléfono
              </label>
              <input
                id="primaryPhone"
                className="input"
                value={edit.draft.primaryPhone}
                onChange={(e) =>
                  edit.setDraft((d) => ({ ...d, primaryPhone: e.target.value }))
                }
                placeholder="+503 7000 0000"
                disabled={edit.saving}
              />
            </div>
            <div>
              <label className="label" htmlFor="primaryEmail">
                Correo
              </label>
              <input
                id="primaryEmail"
                type="email"
                className="input"
                value={edit.draft.primaryEmail}
                onChange={(e) =>
                  edit.setDraft((d) => ({ ...d, primaryEmail: e.target.value }))
                }
                placeholder="nombre@correo.com"
                disabled={edit.saving}
              />
            </div>
          </div>

          {!hasContact && (
            <div style={hintStyle}>
              <Icon name="target" width={12} height={12} />
              Dejá al menos un medio de contacto: teléfono o correo.
            </div>
          )}

          <div style={{ ...hintStyle, marginTop: 12 }}>
            <Icon name="lock" width={12} height={12} />
            El canal de origen no se edita: es el dato histórico de cómo llegó el
            contacto.
          </div>
        </>
      }
    >
      <div className="kv-grid">
        <div>
          <span className="k">Nombre completo</span>
          <span className="v">{client.fullName}</span>
        </div>
        <div>
          <span className="k">Teléfono</span>
          <span className="v">
            <PhoneLinks phone={client.primaryPhone} />
          </span>
        </div>
        <div>
          <span className="k">Correo</span>
          <span className="v">
            <EmailLinks email={client.primaryEmail} />
          </span>
        </div>
        <div>
          <span className="k">Canal de origen</span>
          <span className="v">{SOURCE_CHANNEL_LABEL[client.sourceChannel]}</span>
        </div>
      </div>
    </EditableCard>
  );
}

function PreferenciasCard({ client, canEdit, onSave }: CardProps) {
  const edit = useInlineEdit(
    {
      destinations: client.travelPreferences.destinations.join(", "),
      interests: client.travelPreferences.interests.join(", "),
      notes: client.travelPreferences.notes ?? "",
    },
    (draft) =>
      onSave({
        travelPreferences: {
          destinations: splitList(draft.destinations),
          interests: splitList(draft.interests),
          notes: draft.notes.trim() || null,
        },
      }),
  );

  return (
    <EditableCard
      title="Preferencias de viaje"
      edit={edit}
      canEdit={canEdit}
      form={
        <>
          <div className="modal-grid">
            <div>
              <label className="label" htmlFor="destinations">
                Destinos de interés
              </label>
              <input
                id="destinations"
                className="input"
                value={edit.draft.destinations}
                onChange={(e) =>
                  edit.setDraft((d) => ({ ...d, destinations: e.target.value }))
                }
                placeholder="Cancún, Punta Cana"
                disabled={edit.saving}
                autoFocus
              />
            </div>
            <div>
              <label className="label" htmlFor="interests">
                Intereses
              </label>
              <input
                id="interests"
                className="input"
                value={edit.draft.interests}
                onChange={(e) =>
                  edit.setDraft((d) => ({ ...d, interests: e.target.value }))
                }
                placeholder="Luna de miel, Todo incluido"
                disabled={edit.saving}
              />
            </div>
          </div>

          <div style={hintStyle}>
            <Icon name="tag" width={12} height={12} />
            Separá cada valor con una coma.
          </div>

          <label className="label" htmlFor="prefNotes" style={{ marginTop: 14 }}>
            Notas del viaje
          </label>
          <textarea
            id="prefNotes"
            className="input"
            rows={3}
            style={{ resize: "vertical", lineHeight: 1.6 }}
            value={edit.draft.notes}
            onChange={(e) => edit.setDraft((d) => ({ ...d, notes: e.target.value }))}
            placeholder="Fechas tentativas, cantidad de viajeros, presupuesto…"
            disabled={edit.saving}
          />
        </>
      }
    >
      <>
        <div className="kv-grid">
          <div>
            <span className="k">Destinos de interés</span>
            <span className="v">
              {client.travelPreferences.destinations.join(", ") || "—"}
            </span>
          </div>
          <div>
            <span className="k">Intereses</span>
            <span className="v">
              {client.travelPreferences.interests.join(", ") || "—"}
            </span>
          </div>
        </div>
        {client.travelPreferences.notes && (
          <div style={{ marginTop: 16 }}>
            <span className="k" style={kLabelStyle}>
              Notas del viaje
            </span>
            <div style={{ fontSize: 13, color: "var(--text-mute)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
              {client.travelPreferences.notes}
            </div>
          </div>
        )}
      </>
    </EditableCard>
  );
}

function EtiquetasCard({
  client,
  tags,
  canEdit,
  onSave,
}: CardProps & { tags: Tag[] }) {
  const edit = useInlineEdit(client.tagIds, (draft) => onSave({ tagIds: draft }));

  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  // Las desactivadas solo aparecen si el expediente ya las tenía: se pueden
  // conservar o quitar, pero no agregar de nuevo (HU-CFG-01).
  const selectable = tags.filter(
    (tag) => tag.status === "active" || client.tagIds.includes(tag.id),
  );

  return (
    <EditableCard
      title="Etiquetas"
      edit={edit}
      canEdit={canEdit}
      form={
        selectable.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
            Todavía no hay etiquetas en el catálogo. Se crean desde el backoffice.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {selectable.map((tag) => {
              const selected = edit.draft.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className="tagpick"
                  aria-pressed={selected}
                  disabled={edit.saving}
                  onClick={() =>
                    edit.setDraft((prev) =>
                      selected ? prev.filter((id) => id !== tag.id) : [...prev, tag.id],
                    )
                  }
                >
                  {selected && <Icon name="check" />}
                  {tag.name}
                  {tag.status === "inactive" && (
                    <span style={{ opacity: 0.7, fontWeight: 500 }}>· desactivada</span>
                  )}
                </button>
              );
            })}
          </div>
        )
      }
    >
      {client.tagIds.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
          Sin etiquetas. Sirven para agrupar la cartera y filtrar el tablero.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {client.tagIds.map((id) => {
            const tag = byId.get(id);
            return (
              <span key={id} className="chip orange" style={{ padding: "6px 12px" }}>
                {tag?.name ?? "Etiqueta retirada"}
                {tag?.status === "inactive" && (
                  <span style={{ opacity: 0.7, marginLeft: 6 }}>· desactivada</span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </EditableCard>
  );
}

function NotasCard({ client, canEdit, onSave }: CardProps) {
  const edit = useInlineEdit(client.internalNotes ?? "", (draft) =>
    onSave({ internalNotes: draft.trim() || null }),
  );

  return (
    <EditableCard
      title="Notas internas"
      edit={edit}
      canEdit={canEdit}
      form={
        <>
          <textarea
            className="input"
            rows={5}
            style={{ resize: "vertical", lineHeight: 1.7 }}
            value={edit.draft}
            onChange={(e) => edit.setDraft(e.target.value)}
            placeholder="Contexto del interés, presupuesto, fechas tentativas…"
            disabled={edit.saving}
            aria-label="Notas internas"
            autoFocus
          />
          <div style={hintStyle}>
            <Icon name="lock" width={12} height={12} />
            Uso interno del equipo: nunca sale en cotizaciones ni correos al cliente.
          </div>
        </>
      }
    >
      <>
        <div
          style={{
            fontSize: 13,
            color: "var(--text-mute)",
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
          }}
        >
          {client.internalNotes ?? "Sin notas."}
        </div>
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid var(--border-soft)",
            fontSize: 11,
            color: "var(--text-faint)",
          }}
        >
          Creado {relativeTime(client.createdAt)} · última edición{" "}
          {relativeTime(client.updatedAt)}
        </div>
      </>
    </EditableCard>
  );
}

function ValorEstimadoCard({ client, canEdit, onSave }: CardProps) {
  const edit = useInlineEdit(client.estimatedValue ?? "", (draft) =>
    onSave({ estimatedValue: draft.trim() || null }),
  );

  const trimmed = edit.draft.trim();
  const validAmount = trimmed === "" || MONEY_PATTERN.test(trimmed);

  return (
    <div className="stats" style={{ gridTemplateColumns: "1fr" }}>
      <div className="stat">
        <div className="card-h">
          <div className="label" style={{ margin: 0 }}>
            Valor estimado
          </div>
          {canEdit && !edit.editing && (
            <button type="button" className="btn ghost tiny" onClick={edit.start}>
              <Icon name="edit" />
              Editar
            </button>
          )}
        </div>

        {edit.editing ? (
          <form onSubmit={edit.submit}>
            {edit.error && (
              <div className="auth-alert error" style={{ marginBottom: 12 }} role="alert">
                <Icon name="target" />
                <div>{edit.error}</div>
              </div>
            )}
            <input
              className="input"
              inputMode="decimal"
              value={edit.draft}
              onChange={(e) => edit.setDraft(e.target.value)}
              placeholder="1800.00"
              disabled={edit.saving}
              aria-label="Valor estimado en dólares"
              autoFocus
            />
            {!validAmount && (
              <div style={hintStyle}>
                <Icon name="target" width={12} height={12} />
                Escribí un monto como 1800 o 1800.00.
              </div>
            )}
            <div className="edit-foot">
              <button
                type="button"
                className="btn ghost tiny"
                onClick={edit.cancel}
                disabled={edit.saving}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn primary tiny"
                disabled={edit.saving || !validAmount}
              >
                {edit.saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </form>
        ) : (
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)" }}>
            {formatMoney(client.estimatedValue)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Cotizaciones del expediente · HU-EXP-01.
 *
 * Solo las de este cliente, con el estado y los avisos del listado general para
 * no obligar a saltar de pantalla para saber cómo va cada una.
 */
function CotizacionesTab({ clientId }: { clientId: string }) {
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    crmApi
      .listQuotes({ clientId, sortBy: "created", sortDir: "desc" })
      .then((page) => setQuotes(page.items))
      .catch(() => setError("No se pudieron cargar las cotizaciones."));
  }, [clientId]);

  if (error) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--red)" }}>
        {error}
      </div>
    );
  }

  if (quotes === null) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--text-mute)" }}>
        Cargando cotizaciones…
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Sin cotizaciones todavía</div>
        <div style={{ fontSize: 13, color: "var(--text-mute)", marginBottom: 18 }}>
          Creá la primera con el cliente ya precargado.
        </div>
        <Link href={`/cotizaciones/nueva?clientId=${clientId}`} className="btn primary">
          <Icon name="doc" />
          Nueva cotización
        </Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead>
            <tr>
              <th>Código</th>
              <th>Destino</th>
              <th>Total</th>
              <th>Ver.</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((quote) => (
              <tr key={quote.id}>
                <td>
                  <Link
                    href={`/cotizaciones/${quote.id}`}
                    className="mono"
                    style={{ fontSize: 12, color: "var(--navy)", fontWeight: 600 }}
                  >
                    {quote.code}
                  </Link>
                </td>
                <td>{quote.destination ?? "—"}</td>
                <td>
                  <b className="num">{formatMoney(quote.finalPrice)}</b>
                </td>
                <td>
                  <span className="chip">v{quote.versionCount}</span>
                </td>
                <td>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className={`chip ${QUOTE_STATUS_CHIP[quote.status]}`}>
                      {QUOTE_STATUS_LABEL[quote.status]}
                    </span>
                    {quote.noAnswer && <span className="chip orange">Sin respuesta</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Ventas del expediente · HU-EXP-06.
 *
 * Muestra el cobro de cada operación, no solo el monto: desde el expediente lo
 * que se consulta es si el cliente quedó a paz y salvo.
 */
function VentasTab({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const [sales, setSales] = useState<SaleSummary[] | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [creating, setCreating] = useState(false);
  const [saleNotice, setSaleNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    crmApi
      .listSales({ clientId, sortBy: "created", sortDir: "desc" })
      .then((page) => setSales(page.items))
      .catch(() => setError("No se pudieron cargar las ventas."));
  }, [clientId]);

  useEffect(() => {
    load();
    crmApi.team().then(setTeam).catch(() => undefined);
  }, [load]);

  if (error) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--red)" }}>
        {error}
      </div>
    );
  }

  if (sales === null) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--text-mute)" }}>
        Cargando ventas…
      </div>
    );
  }

  return (
    <>
      {sales.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Sin ventas todavía</div>
          <div style={{ fontSize: 13, color: "var(--text-mute)", marginBottom: 18 }}>
            Una venta nace al aceptar una cotización. Si se cerró por fuera, registrala
            directo.
          </div>
          {canEdit && (
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>
              <Icon name="cart" />
              Registrar venta
            </button>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Destino</th>
                  <th>Total</th>
                  <th>Saldo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      <Link
                        href={`/ventas/${sale.id}`}
                        className="mono"
                        style={{ fontSize: 12, color: "var(--navy)", fontWeight: 600 }}
                      >
                        {sale.code}
                      </Link>
                    </td>
                    <td>{sale.destination}</td>
                    <td>
                      <b className="num">{formatMoney(sale.finalPrice)}</b>
                    </td>
                    <td>
                      <span
                        className="num"
                        style={{
                          color:
                            Number(sale.balanceAmount) > 0
                              ? "var(--orange-deep)"
                              : "var(--green)",
                        }}
                      >
                        {Number(sale.balanceAmount) > 0
                          ? formatAmount(sale.balanceAmount)
                          : "Pagada"}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span className={`chip ${SALE_STATUS_CHIP[sale.saleStatus]}`}>
                          {SALE_STATUS_LABEL[sale.saleStatus]}
                        </span>
                        {sale.isPaymentOverdue && (
                          <span className="chip red">Cobro atrasado</span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {saleNotice && (
        <div className="auth-alert info dismissable" style={{ marginBottom: 14 }} role="status">
          <Icon name="check" />
          <div>{saleNotice}</div>
          <button
            type="button"
            className="iconbtn"
            onClick={() => setSaleNotice(null)}
            aria-label="Cerrar aviso"
          >
            <Icon name="x" />
          </button>
        </div>
      )}

      {creating && (
        <NuevaVentaModal
          team={team}
          clientId={clientId}
          onClose={() => setCreating(false)}
          onCreated={(sale, confirmation) => {
            setCreating(false);
            // `A5` · un expediente sin correo no generaba ningún aviso por este
            // camino: la venta se creaba y nadie sabía que no salió nada.
            setSaleNotice(
              confirmation.sent
                ? confirmation.simulated
                  ? `Venta ${sale.code} registrada. La confirmación quedó simulada: el CRM está en modo de prueba de correo.`
                  : `Venta ${sale.code} registrada y confirmación enviada al cliente.`
                : `Venta ${sale.code} registrada, pero NO se envió la confirmación: ${confirmation.error ?? "revisá el correo del expediente."}`,
            );
            load();
          }}
        />
      )}
    </>
  );
}

/**
 * Archivos del expediente · HU-ARC-01 y HU-ARC-02.
 *
 * Junta lo que sube el equipo —pasaportes, comprobantes— con lo que genera el
 * sistema: PDF de cotización, facturas y recibos. Todo el material del cliente
 * en un solo lugar, que es lo que pide el expediente 360°.
 */
function ArchivosTab({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const [files, setFiles] = useState<StoredFileRef[] | null>(null);
  const [fileType, setFileType] = useState<FileType>("passport");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    crmApi
      .clientFiles(clientId)
      .then(setFiles)
      .catch(() => setError("No se pudieron cargar los archivos."));
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      await crmApi.uploadFile(file, { clientId, fileType });
      load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo subir el archivo.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {canEdit && (
        <div className="card">
          <div className="card-h">
            <span className="ttl">Subir un archivo</span>
          </div>

          {error && (
            <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
              <Icon name="target" />
              <div>{error}</div>
            </div>
          )}

          <div className="modal-grid">
            <div>
              <label className="label" htmlFor="fileType">
                Tipo de documento
              </label>
              <select
                id="fileType"
                className="input"
                value={fileType}
                onChange={(e) => setFileType(e.target.value as FileType)}
                disabled={uploading}
              >
                {/* Los PDF que genera el sistema no se suben a mano. */}
                {(["passport", "payment_receipt", "other"] as const).map((type) => (
                  <option key={type} value={type}>
                    {FILE_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="fileInput">
                Archivo
              </label>
              <input
                id="fileInput"
                type="file"
                className="input"
                accept="application/pdf,image/jpeg,image/png"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </div>
          </div>

          <div style={hintStyle}>
            <Icon name="lock" width={12} height={12} />
            PDF, JPG o PNG hasta 10 MB. Ningún archivo es público: se abre con un enlace
            que caduca.
          </div>
        </div>
      )}

      {files === null ? (
        <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--text-mute)" }}>
          Cargando archivos…
        </div>
      ) : files.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Sin archivos</div>
          <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
            Acá aparecen los pasaportes y comprobantes que subas, y los PDF que genera el
            sistema.
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Tipo</th>
                  <th>Tamaño</th>
                  <th>Subido</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td style={{ fontWeight: 600 }}>{file.originalName}</td>
                    <td>
                      <span className="chip">{FILE_TYPE_LABEL[file.fileType]}</span>
                    </td>
                    <td className="num" style={{ fontSize: 12, color: "var(--text-mute)" }}>
                      {formatBytes(file.sizeBytes)}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-mute)" }}>
                      {relativeTime(file.uploadedAt)}
                    </td>
                    <td>
                      <SignedFileLink
                        fileId={file.id}
                        label="Abrir"
                        fileName={file.originalName}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ─────────────────────── Posibles duplicados · HU-CLI-10 ──────────────────── */

/**
 * Candidatos a ser la misma persona, con el motivo de cada uno.
 *
 * Todos lo ven —quien carga o atiende tiene que saberlo—; fusionar es de Gerente
 * y Administrador. Para el Asesor, la tarjeta le dice a quién pedírselo.
 */
function DuplicadosCard({
  duplicates,
  canMerge,
  onMerge,
}: {
  duplicates: DuplicateMatch[];
  canMerge: boolean;
  onMerge: (match: DuplicateMatch) => void;
}) {
  return (
    <div className="card duplicates-card">
      <div className="duplicates-card-head">
        <Icon name="users" />
        <b>Posibles duplicados</b>
      </div>
      <ul>
        {duplicates.map((match) => (
          <li key={match.client.id}>
            <div style={{ minWidth: 0 }}>
              <Link href={`/clientes/${match.client.id}`}>{match.client.fullName}</Link>
              <span>
                {match.reasons.map((reason) => DUPLICATE_REASON_LABEL[reason]).join(", ")}
                {match.client.advisor ? ` · ${match.client.advisor.fullName}` : " · sin responsable"}
              </span>
            </div>
            {canMerge && (
              <button type="button" className="btn ghost tiny" onClick={() => onMerge(match)}>
                Fusionar
              </button>
            )}
          </li>
        ))}
      </ul>
      {!canMerge && (
        <p>Si son la misma persona, pedile a un Gerente que los fusione.</p>
      )}
    </div>
  );
}

/* ───────────────────── Conversaciones del expediente · HU-EXP-05 ──────────── */

/**
 * Las conversaciones de este cliente en los tres canales.
 *
 * El hilo se lee y se atiende en la bandeja: acá está el índice, con un enlace
 * directo que abre la conversación ya seleccionada.
 */
function ConversacionesTab({ clientId }: { clientId: string }) {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    crmApi
      .listConversations({ clientId, view: "all", pageSize: 100 })
      .then((page) => setConversations(page.items))
      .catch(() => setError("No se pudieron cargar las conversaciones."));
  }, [clientId]);

  if (error) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--red)" }}>
        {error}
      </div>
    );
  }

  if (conversations === null) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--text-mute)" }}>
        Cargando conversaciones…
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Sin conversaciones</div>
        <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
          Este cliente todavía no escribió por WhatsApp, Messenger ni Instagram.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead>
            <tr>
              <th>Canal</th>
              <th>Último mensaje</th>
              <th>Atiende</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {conversations.map((conversation) => (
              <tr key={conversation.id}>
                <td>
                  <span className={`chip ${CONVERSATION_CHANNEL_CLASS[conversation.channel]}`}>
                    {CHANNEL_LABEL[conversation.channel]}
                  </span>
                </td>
                <td style={{ maxWidth: 320 }}>
                  <div className="ellipsis">{conversation.lastMessagePreview ?? "—"}</div>
                  <time
                    dateTime={conversation.lastMessageAt}
                    style={{ fontSize: 11, color: "var(--text-mute)" }}
                  >
                    {relativeTime(conversation.lastMessageAt)}
                  </time>
                </td>
                <td>
                  {conversation.advisor?.fullName ?? <span className="chip amber">Sin asignar</span>}
                </td>
                <td>
                  <span className={`chip ${conversation.status === "resolved" ? "green" : "navy"}`}>
                    {CONVERSATION_STATUS_LABEL[conversation.status]}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link
                    href={`/bandeja?vista=all&conversacion=${conversation.id}`}
                    className="btn ghost tiny"
                  >
                    Abrir en la bandeja
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const hintStyle = {
  fontSize: 12,
  color: "var(--text-mute)",
  marginTop: 8,
  display: "flex",
  gap: 6,
  alignItems: "center",
} as const;

const kLabelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-faint)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
} as const;
