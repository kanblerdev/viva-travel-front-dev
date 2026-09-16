"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { ApiError } from "@/lib/api/client";
import {
  crmApi,
  DUPLICATE_REASON_LABEL,
  type ClientDetail,
  type ClientSummary,
  type DuplicateMatch,
  type LossReason,
  type Tag,
  type TeamMember,
} from "@/lib/api/crm";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import {
  SOURCE_CHANNELS,
  SOURCE_CHANNEL_LABEL,
  type SourceChannel,
} from "@/lib/domain/enums";


/** "Cancún, Punta Cana" → ["Cancún", "Punta Cana"], sin vacíos ni repetidos. */
export function splitList(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

/* ─────────────────── Registrar contacto · HU-EXP-02 ───────────────────────── */

/** Hoy en formato `YYYY-MM-DD`, que es lo que espera `<input type="date">`. */
function isoToday(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/**
 * Dejar constancia de que se habló con el cliente.
 *
 * Tiene que costar un clic: la nota y la próxima acción son opcionales, y el
 * botón funciona con el formulario vacío. Si registrar un contacto es trabajoso,
 * nadie lo registra y `lastContactAt` vuelve a mentir.
 */
export function RegistrarContactoModal({
  client,
  onClose,
  onDone,
}: {
  client: ClientDetail;
  onClose: () => void;
  onDone: (updated: ClientDetail) => void;
}) {
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState(
    client.nextFollowUpAt ? client.nextFollowUpAt.slice(0, 10) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previous = client.nextFollowUpAt ? client.nextFollowUpAt.slice(0, 10) : "";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onDone(
        await crmApi.logContact(client.id, {
          note: note.trim() || undefined,
          // Solo viaja si cambió: omitirlo deja la fecha como está, y `null` la borra.
          ...(followUp === previous
            ? {}
            : { nextFollowUpAt: followUp ? new Date(followUp).toISOString() : null }),
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo registrar el contacto.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={
        <>
          <Icon name="check" style={{ color: "var(--green)" }} />
          Registrar contacto
        </>
      }
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <p className="modal-lead">
          Queda registrado que hablaste con <b>{client.fullName}</b> hoy. Es lo que
          alimenta la fecha de último contacto del tablero.
        </p>

        {error && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        <label className="label" htmlFor="contactNote">
          ¿De qué hablaron? <span style={{ fontWeight: 400 }}>(opcional)</span>
        </label>
        <textarea
          id="contactNote"
          className="input"
          rows={3}
          style={{ resize: "vertical", lineHeight: 1.6 }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Llamada: confirma fechas la próxima semana…"
          disabled={submitting}
          autoFocus
        />
        <div style={hintStyle}>
          <Icon name="lock" width={12} height={12} />
          Queda en el historial del expediente y no se puede editar después.
        </div>

        <label className="label" htmlFor="followUp" style={{ marginTop: 16 }}>
          Próxima acción <span style={{ fontWeight: 400 }}>(opcional)</span>
        </label>
        <input
          id="followUp"
          type="date"
          className="input"
          min={isoToday()}
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          disabled={submitting}
        />
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {[
            { label: "Mañana", days: 1 },
            { label: "En 3 días", days: 3 },
            { label: "En una semana", days: 7 },
          ].map((preset) => (
            <button
              key={preset.days}
              type="button"
              className="btn ghost tiny"
              disabled={submitting}
              onClick={() => setFollowUp(isoToday(preset.days))}
            >
              {preset.label}
            </button>
          ))}
          {followUp && (
            <button
              type="button"
              className="btn ghost tiny"
              disabled={submitting}
              onClick={() => setFollowUp("")}
            >
              Sin fecha
            </button>
          )}
        </div>
        <div style={hintStyle}>
          <Icon name="calendar" width={12} height={12} />
          El tablero marca la ficha cuando la fecha se vence. No se manda ningún correo.
        </div>

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={submitting}>
            {submitting ? "Registrando…" : "Registrar contacto"}
          </button>
        </div>
      </form>
    </Modal>
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

/* ────────────────────── Marcar como perdido · wireframe 13 ────────────────── */

/**
 * Descartar un prospecto.
 *
 * Los motivos vienen del catálogo, no de una lista escrita acá: lo que se guarda
 * es una referencia con código inmutable, para que el análisis de pérdida agrupe
 * en vez de partir cadenas, y para que renombrar un motivo desde el backoffice no
 * rompa el histórico.
 */
export function MarkLostModal({
  client,
  onClose,
  onDone,
}: {
  client: ClientSummary;
  onClose: () => void;
  onDone: (updated: ClientSummary) => void;
}) {
  const [reasons, setReasons] = useState<LossReason[] | null>(null);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    crmApi
      .lossReasons()
      .then((list) => {
        setReasons(list);
        setReasonId(list[0]?.id ?? "");
      })
      .catch(() =>
        setError("No se pudieron cargar los motivos. Revisá el catálogo del backoffice."),
      );
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onDone(await crmApi.markLost(client.id, reasonId, note || undefined));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo descartar el prospecto.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={
        <>
          <Icon name="target" style={{ color: "var(--red)" }} />
          Marcar como Perdido
        </>
      }
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <p className="modal-lead">
          <b>{client.fullName}</b> saldrá del flujo activo. Indicá el motivo: es
          obligatorio y alimenta el análisis de pérdida.
        </p>

        {error && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        <label className="label" htmlFor="reason">
          Motivo
        </label>
        <select
          id="reason"
          className="input"
          value={reasonId}
          onChange={(e) => setReasonId(e.target.value)}
          disabled={submitting || reasons === null}
        >
          {reasons === null ? (
            <option value="">Cargando motivos…</option>
          ) : (
            reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))
          )}
        </select>

        <label className="label" htmlFor="note" style={{ marginTop: 14 }}>
          Nota opcional
        </label>
        <input
          id="note"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Detalle para el historial…"
          disabled={submitting}
        />

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn danger"
            disabled={submitting || !reasonId}
          >
            {submitting ? "Descartando…" : "Descartar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ──────────────────────── Nuevo prospecto · HU-CLI-01 ─────────────────────── */

export function NewProspectModal({
  team,
  tags,
  defaultAdvisorId,
  onClose,
  onCreated,
}: {
  team: TeamMember[];
  tags: Tag[];
  defaultAdvisorId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Sin valor por defecto a propósito. El canal es INMUTABLE una vez creada la
  // ficha: con "Otro" preseleccionado, la mayoría de los expedientes quedaba con
  // el origen equivocado para siempre, y con eso se degradan el filtro por canal
  // y el reporte de canal.
  const [channel, setChannel] = useState<SourceChannel | "">("");
  const [destinations, setDestinations] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [advisorId, setAdvisorId] = useState(defaultAdvisorId ?? "");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // DM-14: el backend rechaza el alta sin medio de contacto. Se anticipa acá
  // para no gastar un viaje al servidor en un error evitable.
  const hasContact = phone.trim() !== "" || email.trim() !== "";

  const duplicates = useProbeDuplicates({ fullName, phone, email });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const listaDestinos = splitList(destinations);
      await crmApi.createClient({
        fullName,
        primaryPhone: phone.trim() || undefined,
        primaryEmail: email.trim() || undefined,
        sourceChannel: channel as SourceChannel,
        assignedAdvisorId: advisorId || undefined,
        tagIds: tagIds.length > 0 ? tagIds : undefined,
        travelPreferences:
          listaDestinos.length > 0 ? { destinations: listaDestinos } : undefined,
        estimatedValue: estimatedValue.trim() || undefined,
        internalNotes: notes.trim() || undefined,
      });
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo crear el prospecto.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={
        <>
          <Icon name="plus" style={{ color: "var(--orange)" }} />
          Nuevo prospecto
        </>
      }
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        <label className="label" htmlFor="fullName">
          Nombre completo *
        </label>
        <input
          id="fullName"
          className="input"
          required
          minLength={3}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Nombre Apellido"
          disabled={submitting}
          autoFocus
        />

        <div className="modal-grid" style={{ marginTop: 14 }}>
          <div>
            <label className="label" htmlFor="phone">
              Teléfono
            </label>
            <input
              id="phone"
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+503 7000 0000"
              disabled={submitting}
            />
          </div>
          <div>
            <label className="label" htmlFor="email">
              Correo
            </label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@correo.com"
              disabled={submitting}
            />
          </div>
        </div>

        {!hasContact && (
          <div style={hintStyle}>
            <Icon name="target" width={12} height={12} />
            Indicá al menos un medio de contacto.
          </div>
        )}

        <DuplicateWarning matches={duplicates} />

        <div className="modal-grid" style={{ marginTop: 14 }}>
          <div>
            <label className="label" htmlFor="channel">
              Canal de origen *
            </label>
            <select
              id="channel"
              className="input"
              required
              value={channel}
              onChange={(e) => setChannel(e.target.value as SourceChannel)}
              disabled={submitting}
            >
              <option value="">Elegí por dónde llegó…</option>
              {SOURCE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {SOURCE_CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="advisor">
              Responsable
            </label>
            <select
              id="advisor"
              className="input"
              value={advisorId}
              onChange={(e) => setAdvisorId(e.target.value)}
              disabled={submitting}
            >
              <option value="">Sin asignar</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="modal-grid" style={{ marginTop: 14 }}>
          <div>
            <label className="label" htmlFor="destination">
              Destinos de interés
            </label>
            <input
              id="destination"
              className="input"
              value={destinations}
              onChange={(e) => setDestinations(e.target.value)}
              placeholder="Cancún, Punta Cana"
              disabled={submitting}
            />
          </div>
          <div>
            <label className="label" htmlFor="value">
              Valor estimado (USD)
            </label>
            <input
              id="value"
              className="input"
              inputMode="decimal"
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
              placeholder="1800.00"
              disabled={submitting}
            />
          </div>
        </div>

        {tags.length > 0 && (
          <>
            <label className="label" style={{ marginTop: 14 }} id="tagsLabel">
              Etiquetas
            </label>
            <div
              role="group"
              aria-labelledby="tagsLabel"
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              {tags.map((tag) => {
                const selected = tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className="tagpick"
                    aria-pressed={selected}
                    disabled={submitting}
                    onClick={() =>
                      setTagIds((prev) =>
                        selected ? prev.filter((id) => id !== tag.id) : [...prev, tag.id],
                      )
                    }
                  >
                    {selected && <Icon name="check" />}
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <label className="label" htmlFor="notes" style={{ marginTop: 14 }}>
          Notas internas
        </label>
        <textarea
          id="notes"
          className="input"
          rows={3}
          style={{ resize: "vertical", lineHeight: 1.6 }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Contexto del interés, presupuesto, fechas tentativas…"
          disabled={submitting}
        />

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          {channel === "" && hasContact && (
            <span style={{ ...hintStyle, marginTop: 0, marginRight: "auto" }}>
              <Icon name="target" width={12} height={12} />
              Falta el canal de origen.
            </span>
          )}
          <button
            type="submit"
            className="btn primary"
            disabled={submitting || !hasContact || channel === ""}
          >
            {submitting ? "Creando…" : "Crear prospecto"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ──────────────────── Posibles duplicados en el alta · F2 ─────────────────── */

/**
 * Consulta posibles duplicados mientras se escribe el alta · HU-CLI-10.
 *
 * Con debounce, y solo cuando hay algo con qué comparar: un nombre de una sola
 * palabra no alcanza (el backend tampoco lo usa) y un teléfono de menos de 7
 * dígitos todavía se está escribiendo.
 */
function useProbeDuplicates(input: { fullName: string; phone: string; email: string }) {
  // Se debouncea una cadena y no el objeto: un objeto nuevo en cada render nunca
  // se "estabiliza", y la consulta se repetiría sin parar.
  const key = useDebouncedValue(JSON.stringify(input), 400);
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);

  useEffect(() => {
    const probe = JSON.parse(key) as typeof input;
    const fullName = probe.fullName.trim();
    const phone = probe.phone.replace(/\D/g, "");
    const email = probe.email.trim();

    const params = {
      fullName: fullName.split(/\s+/).length >= 2 ? fullName : undefined,
      primaryPhone: phone.length >= 7 ? probe.phone.trim() : undefined,
      primaryEmail: email.includes("@") ? email : undefined,
    };
    if (!params.fullName && !params.primaryPhone && !params.primaryEmail) {
      setMatches([]);
      return;
    }

    let cancelled = false;
    crmApi
      .probeDuplicates(params)
      .then((result) => {
        if (!cancelled) setMatches(result);
      })
      // El aviso ayuda, pero no puede bloquear el alta si la consulta falla.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);

  return matches;
}

/**
 * Aviso de que la persona ya podría estar cargada · `F2`.
 *
 * No bloquea: dos personas distintas pueden llamarse igual, y la fusión la
 * decide un Gerente. Los enlaces abren en otra pestaña para no perder lo escrito.
 */
export function DuplicateWarning({ matches }: { matches: DuplicateMatch[] }) {
  if (matches.length === 0) return null;

  return (
    <div className="duplicate-warning" role="status">
      <b>
        <Icon name="users" />
        {matches.length === 1 ? "Puede que ya esté cargado" : "Puede que ya esté cargado más de una vez"}
      </b>
      <ul>
        {matches.map((match) => (
          <li key={match.client.id}>
            <Link href={`/clientes/${match.client.id}`} target="_blank" rel="noreferrer">
              {match.client.fullName}
            </Link>
            <span>
              {match.reasons.map((reason) => DUPLICATE_REASON_LABEL[reason]).join(", ")}
              {match.client.advisor ? ` · ${match.client.advisor.fullName}` : " · sin responsable"}
            </span>
          </li>
        ))}
      </ul>
      <p>Revisalo antes de crear otro. Si es la misma persona, trabajá sobre ese expediente.</p>
    </div>
  );
}

/* ───────────────────── Fusionar expedientes · HU-CLI-11 ───────────────────── */

/**
 * Confirmación de la fusión · wireframe 13.
 *
 * Tres cosas que la persona tiene que decidir o saber ANTES de confirmar, porque
 * la fusión no se deshace: cuál de los dos queda, qué se mueve, y que está
 * afirmando que son la misma persona. Por eso la casilla es obligatoria: la regla
 * transversal pide confirmación humana explícita, no un clic de paso.
 */
export function MergeClientsModal({
  current,
  candidate,
  onClose,
  onMerged,
}: {
  current: ClientSummary;
  candidate: ClientSummary;
  onClose: () => void;
  /** Recibe el id del expediente que quedó. */
  onMerged: (targetId: string) => void;
}) {
  const [keep, setKeep] = useState<"current" | "candidate">("current");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = keep === "current" ? current : candidate;
  const source = keep === "current" ? candidate : current;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await crmApi.mergeClients(target.id, source.id);
      onMerged(target.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo fusionar.");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={
        <>
          <Icon name="users" style={{ color: "var(--orange)" }} />
          Fusionar contactos
        </>
      }
      onClose={onClose}
      wide
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        <fieldset className="merge-choice" disabled={submitting}>
          <legend className="label">¿Cuál expediente queda?</legend>
          {[
            { value: "current" as const, client: current },
            { value: "candidate" as const, client: candidate },
          ].map((option) => (
            <label key={option.value} className="merge-option" data-checked={keep === option.value}>
              <input
                type="radio"
                name="keep"
                value={option.value}
                checked={keep === option.value}
                onChange={() => setKeep(option.value)}
              />
              <span>
                <b>{option.client.fullName}</b>
                <small>
                  {[option.client.primaryPhone, option.client.primaryEmail].filter(Boolean).join(" · ") ||
                    "Sin teléfono ni correo"}
                  {option.client.advisor ? ` · ${option.client.advisor.fullName}` : " · sin responsable"}
                </small>
              </span>
            </label>
          ))}
        </fieldset>

        <p className="modal-lead" style={{ marginTop: 14 }}>
          Queda <b>{target.fullName}</b> y se absorbe <b>{source.fullName}</b>:
        </p>
        <ul className="consequences">
          <li>
            Las cotizaciones, ventas, archivos, correos y conversaciones de <b>{source.fullName}</b> pasan
            a <b>{target.fullName}</b>, con todo su historial.
          </li>
          <li>
            Se unen las identidades de WhatsApp, Messenger e Instagram, las etiquetas y los destinos.
            Lo que <b>{target.fullName}</b> no tenía —teléfono, correo, responsable— se toma del otro.
          </li>
          <li>
            <b>{target.fullName}</b> conserva su nombre, su etapa y su canal de origen. Las notas internas
            de <b>{source.fullName}</b> se agregan al final, marcadas.
          </li>
          <li>
            <b>{source.fullName}</b> no se borra: queda como fusionado, apuntando a este expediente.
            <b> La fusión no se puede deshacer.</b>
          </li>
        </ul>

        <label className="merge-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={submitting}
          />
          Confirmo que son la misma persona.
        </label>

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" className="btn danger" disabled={submitting || !confirmed}>
            {submitting ? "Fusionando…" : "Fusionar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
