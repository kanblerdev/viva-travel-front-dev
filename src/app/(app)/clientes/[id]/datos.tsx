"use client";

import {
  useEffect,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Icon } from "@/components/Icon";
import { EmailLinks, PhoneLinks } from "@/components/ContactLinks";
import { RelativeTime } from "@/components/RelativeTime";
import { ApiError } from "@/lib/api/client";
import {
  formatMoney,
  type ClientDetail,
  type Tag,
  type UpdateClientInput,
} from "@/lib/api/crm";
import { isValidAmount } from "@/lib/domain/money";
import { SOURCE_CHANNEL_LABEL, SOURCE_CHANNELS, type SourceChannel } from "@/lib/domain/enums";
import { splitList } from "../modals";

const CHANNEL_CLASS: Record<SourceChannel, string> = {
  whatsapp: "wa",
  messenger: "ms",
  instagram: "ig",
  other: "",
};

/** Hasta dos decimales. El backend vuelve a validarlo. */
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** Rótulo pequeño sobre cada dato del expediente. */
const kLabelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-faint)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
} as const;

/*
 * Datos generales del expediente y su edición en línea · `D3`.
 *
 * Es la primera pestaña, la única que no trae sus propios datos —los recibe del
 * expediente— y la que concentra la mecánica de editar sección por sección
 * (HU-EXP-02). Salió de `ExpedienteView.tsx` junto con las demás pestañas.
 */

/* ─────────────────────── Edición en línea · HU-EXP-02 ─────────────────────── */

type InlineEdit<T> = {
  /** El guardado chocó con una edición ajena (409) · `D5`. */
  conflict: boolean;
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
  /**
   * El guardado chocó con una edición ajena · `D5`.
   *
   * Se distingue de cualquier otro error porque la salida es distinta: los demás
   * se arreglan corrigiendo el campo; este solo se arregla viendo primero qué
   * cambió el otro.
   */
  const [conflict, setConflict] = useState(false);

  return {
    draft,
    setDraft,
    editing,
    saving,
    error,
    conflict,
    start: () => {
      setDraft(current);
      setError(null);
      setConflict(false);
      setEditing(true);
    },
    cancel: () => {
      setEditing(false);
      setError(null);
      setConflict(false);
    },
    submit: async (event: FormEvent) => {
      event.preventDefault();
      setSaving(true);
      setError(null);
      setConflict(false);
      try {
        await save(draft);
        setEditing(false);
      } catch (caught) {
        // El backend explica por qué rechazó —permiso, formato, duplicado— y ese
        // mensaje le sirve más al usuario que uno genérico.
        setError(
          caught instanceof ApiError ? caught.message : "No se pudo guardar el cambio.",
        );
        // 409 es la precondición de `D5`: alguien editó mientras esto estaba
        // abierto. No se pierde lo escrito — el borrador sigue en pantalla.
        setConflict(caught instanceof ApiError && caught.status === 409);
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
              <div>
                {edit.error}
                {/*
                  Un conflicto necesita una SALIDA, no solo un mensaje · `D5`.
                  Los demás errores se arreglan corrigiendo el campo; este solo se
                  arregla viendo antes qué cambió el otro. Lo escrito sigue en
                  pantalla hasta que se decida recargar.
                */}
                {edit.conflict && (
                  <button
                    type="button"
                    className="btn ghost tiny"
                    style={{ marginTop: 8 }}
                    onClick={() => window.location.reload()}
                  >
                    Recargar el expediente
                  </button>
                )}
              </div>
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

export function DatosGenerales({
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
            <div className="field-hint">
              <Icon name="target" width={12} height={12} />
              Dejá al menos un medio de contacto: teléfono o correo.
            </div>
          )}

          <div className="field-hint" style={{ marginTop: 12 }}>
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

          <div className="field-hint">
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
          <div className="field-hint">
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
          Creado <RelativeTime iso={client.createdAt} /> · última edición{" "}
          <RelativeTime iso={client.updatedAt} />
        </div>
      </>
    </EditableCard>
  );
}

export function ValorEstimadoCard({ client, canEdit, onSave }: CardProps) {
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
              <div className="field-hint">
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
