"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { ApiError } from "@/lib/api/client";
import {
  crmApi,
  type ConversationSummary,
  type TeamMember,
} from "@/lib/api/crm";
import { USER_ROLE_LABEL } from "@/lib/domain/enums";

/** El equipo activo, cargado al abrir el diálogo. */
function useTeam() {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    crmApi
      .team()
      .then(setTeam)
      .catch(() => setError("No se pudo cargar el equipo."));
  }, []);

  return { team, error };
}

/* ──────────────────────────── Transferir · HU-MSG-07 ──────────────────────── */

/**
 * Pasar la conversación a otra persona del equipo.
 *
 * La nota es opcional pero es lo que evita que quien la recibe tenga que leer
 * el hilo entero para saber en qué quedó: "pide descuento de grupo, ya le
 * cotizamos Cancún". Queda en la auditoría.
 */
export function TransferConversationModal({
  conversation,
  onClose,
  onDone,
}: {
  conversation: ConversationSummary;
  onClose: () => void;
  onDone: (updated: ConversationSummary) => void;
}) {
  const { team, error: teamError } = useTeam();
  const [toUserId, setToUserId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = (team ?? []).filter((member) => member.id !== conversation.advisor?.id);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onDone(await crmApi.transferConversation(conversation.id, toUserId, note.trim() || undefined));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo transferir la conversación.");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={
        <>
          <Icon name="arrow-right" style={{ color: "var(--orange)" }} />
          Transferir conversación
        </>
      }
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <p className="modal-lead">
          La conversación con <b>{conversation.client?.fullName ?? "este contacto"}</b> pasa a otra
          persona con todo su historial. Vos dejás de atenderla.
        </p>

        {(error || teamError) && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error ?? teamError}</div>
          </div>
        )}

        <label className="label" htmlFor="transferTo">
          Quién la recibe *
        </label>
        <select
          id="transferTo"
          className="input"
          required
          value={toUserId}
          onChange={(event) => setToUserId(event.target.value)}
          disabled={submitting || !team}
        >
          <option value="">{team ? "Elegí a alguien del equipo…" : "Cargando equipo…"}</option>
          {candidates.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName} · {USER_ROLE_LABEL[member.role]}
            </option>
          ))}
        </select>

        <label className="label" htmlFor="transferNote" style={{ marginTop: 14 }}>
          Nota para quien la recibe
        </label>
        <textarea
          id="transferNote"
          className="input"
          rows={3}
          maxLength={500}
          style={{ resize: "vertical", lineHeight: 1.6 }}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="En qué quedó, qué espera el cliente…"
          disabled={submitting}
        />

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={submitting || !toUserId}>
            {submitting ? "Transfiriendo…" : "Transferir"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────────────────────── Reasignar · HU-MSG-08 ──────────────────────── */

/** Gerente y Administrador: a quien sea, o de vuelta a "sin asignar". */
export function AssignConversationModal({
  conversation,
  onClose,
  onDone,
}: {
  conversation: ConversationSummary;
  onClose: () => void;
  onDone: (updated: ConversationSummary) => void;
}) {
  const { team, error: teamError } = useTeam();
  const [advisorId, setAdvisorId] = useState(conversation.advisor?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unchanged = advisorId === (conversation.advisor?.id ?? "");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onDone(await crmApi.assignConversation(conversation.id, advisorId || null));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo reasignar la conversación.");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={
        <>
          <Icon name="users" style={{ color: "var(--orange)" }} />
          Reasignar conversación
        </>
      }
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <p className="modal-lead">
          {conversation.advisor ? (
            <>
              Hoy la atiende <b>{conversation.advisor.fullName}</b>.
            </>
          ) : (
            "Hoy no la atiende nadie."
          )}{" "}
          El cambio queda registrado en la auditoría.
        </p>

        {(error || teamError) && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error ?? teamError}</div>
          </div>
        )}

        <label className="label" htmlFor="assignTo">
          Quién la atiende
        </label>
        <select
          id="assignTo"
          className="input"
          value={advisorId}
          onChange={(event) => setAdvisorId(event.target.value)}
          disabled={submitting || !team}
        >
          <option value="">Sin asignar (vuelve a la bandeja común)</option>
          {(team ?? []).map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName} · {USER_ROLE_LABEL[member.role]}
            </option>
          ))}
        </select>

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={submitting || unchanged}>
            {submitting ? "Guardando…" : "Reasignar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
