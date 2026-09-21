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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icon";
import { RelativeTime } from "@/components/RelativeTime";
import { TabPanel, Tabs, type TabOption } from "@/components/Tabs";
import { DatosGenerales, ValorEstimadoCard } from "./datos";
import {
  ArchivosTab,
  ConversacionesTab,
  CotizacionesTab,
  VentasTab,
} from "./tabs";
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
  QUOTE_STATUS_CHIP,
  QUOTE_STATUS_LABEL,
  SALE_STATUS_CHIP,
  SALE_STATUS_LABEL,
  SOURCE_CHANNEL_LABEL,
  stageLabel,
  type FileType,
  type SourceChannel,
} from "@/lib/domain/enums";
import {
  MarkLostModal,
  MergeClientsModal,
  RegistrarContactoModal,
  splitList,
} from "../modals";
import { NuevaVentaModal } from "@/components/NuevaVentaModal";

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

type TabCounts = {
  quotes: number;
  sales: number;
  conversations: number;
  files: number;
  economics: {
    quotedAmount: string;
    quotedCount: number;
    soldAmount: string;
    soldCount: number;
    outstandingAmount: string;
  };
};

/**
 * Las pestañas con lo que hay detrás de cada una · `C7`.
 *
 * "Cotizaciones 3" ahorra el clic de entrar a ver si hay algo, que en un
 * expediente recién creado son cuatro clics a pestañas vacías. `Datos
 * generales` no lleva número: siempre tiene contenido.
 */
function TABS_WITH_COUNTS(counts: TabCounts | null): readonly TabOption<TabId>[] {
  return TABS.map((tab) => ({
    ...tab,
    count:
      counts === null || tab.id === "datos"
        ? null
        : tab.id === "cotizaciones"
          ? counts.quotes
          : tab.id === "ventas"
            ? counts.sales
            : tab.id === "conversaciones"
              ? counts.conversations
              : counts.files,
  }));
}

const ACTION_LABEL: Record<string, string> = {
  created: "Expediente creado",
  updated: "Datos editados",
  stage_changed: "Cambio de etapa",
  contact_logged: "Contacto registrado",
  assigned: "Responsable asignado",
  status_changed: "Cambio de estado",
  merged: "Expedientes fusionados",
};

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
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<TabCounts | null>(null);

  /*
   * La pestaña abierta vive en la URL · `C7`.
   *
   * Es lo que permite mandarle a un compañero "mirá las ventas de este
   * expediente" pegando un enlace, y que el botón de atrás devuelva a la
   * pestaña de la que se venía en vez de al principio. `datos` no se escribe:
   * es la de entrada y ensuciaría cada URL.
   */
  const pathname = usePathname();
  const params = useSearchParams();
  const urlTab = params.get("seccion");
  const tab: TabId = TABS.some((option) => option.id === urlTab)
    ? (urlTab as TabId)
    : "datos";

  const setTab = useCallback(
    (next: TabId) => {
      const query = next === "datos" ? "" : `?seccion=${next}`;
      // `replace`: cambiar de pestaña no es navegar a otra pantalla, y una
      // entrada de historial por pestaña haría del botón de atrás un laberinto.
      router.replace(`${pathname}${query}`, { scroll: false });
    },
    [router, pathname],
  );

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
      // `C7`: los contadores de las pestañas. Si fallan, las pestañas se
      // muestran sin número, que es como estaban antes.
      crmApi.clientTabCounts(clientId).then(setCounts).catch(() => undefined);
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
      /*
       * La precondición de `D5`: el `updatedAt` que esta pantalla tiene cargado.
       *
       * Si alguien editó el expediente mientras estaba abierto, el backend
       * responde 409 en vez de pisar su trabajo. Sin esto, guardar una nota diez
       * minutos después devolvía al valor viejo el teléfono que otro acababa de
       * corregir —porque el formulario manda TODOS sus campos, no solo el que se
       * tocó— y nadie se enteraba.
       */
      setClient(
        await crmApi.updateClient(clientId, {
          ...patch,
          ...(client ? { expectedUpdatedAt: client.updatedAt } : {}),
        }),
      );
      const events = await crmApi.activity(clientId).catch(() => null);
      if (events) setActivity(events);
    },
    [clientId, client],
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
                <RelativeTime iso={client.reactivatedAt} />.
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

      {counts && <ResumenEconomico economics={counts.economics} />}

      <Tabs
        options={TABS_WITH_COUNTS(counts)}
        value={tab}
        onChange={setTab}
        label="Secciones del expediente"
        idPrefix="expediente"
        style={{ margin: "14px 0" }}
      />

      <div className="exp-body">
        <TabPanel id={tab} idPrefix="expediente" style={{ minWidth: 0 }}>
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
        </TabPanel>

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
                        {event.actor} · <RelativeTime iso={event.occurredAt} />
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
            <RelativeTime iso={client.lastContactAt} empty="Sin registrar" />
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

      <div className="field-hint" style={{ marginTop: 12 }}>
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

/**
 * Las tres cifras que resumen la relación comercial · `F5`, HU-EXP-01.
 *
 * Cotizado, vendido y saldo. Hasta ahora había que entrar a dos pestañas y sumar
 * a mano para responder "¿cuánto le hemos cotizado a esta persona y cuánto nos
 * compró?", que es la primera pregunta antes de llamarla.
 *
 * **No lleva comisiones ni utilidad**: el expediente lo abre cualquiera y DM-19
 * recorta la utilidad por rol. Lo económico interno vive en el detalle de cada
 * venta, que sí la aplica.
 */
function ResumenEconomico({ economics }: { economics: TabCounts["economics"] }) {
  const cifras = [
    {
      label: "Cotizado",
      value: economics.quotedAmount,
      note: `${economics.quotedCount} cotización${
        economics.quotedCount === 1 ? "" : "es"
      } enviada${economics.quotedCount === 1 ? "" : "s"}`,
    },
    {
      label: "Vendido",
      value: economics.soldAmount,
      note: `${economics.soldCount} venta${
        economics.soldCount === 1 ? "" : "s"
      } sin contar canceladas`,
    },
    {
      label: "Saldo pendiente",
      value: economics.outstandingAmount,
      note: Number(economics.outstandingAmount) > 0 ? "Hay algo por cobrar" : "Todo cobrado",
    },
  ];

  return (
    <div className="exp-money">
      {cifras.map((cifra) => (
        <div key={cifra.label}>
          <span className="k">{cifra.label}</span>
          <span className="v">
            {formatMoney(cifra.value)} <span className="u">USD</span>
          </span>
          <span className="n">{cifra.note}</span>
        </div>
      ))}
    </div>
  );
}
