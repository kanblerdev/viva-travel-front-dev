"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { RelativeTime } from "@/components/RelativeTime";
import { Modal } from "@/components/Modal";
import { SignedFileLink } from "@/components/SignedFileLink";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/AuthProvider";
import {
  crmApi,
  formatMoney,
  type LossReason,
  type QuoteDetail,
  type QuoteVersionData,
  type TeamMember,
} from "@/lib/api/crm";
import {
  QUOTE_EDITABLE_STATUSES,
  QUOTE_STATUSES_NEEDING_REASON,
  QUOTE_STATUS_CHIP,
  QUOTE_STATUS_LABEL,
  QUOTE_TYPE_LABEL,
  SERVICE_TYPE_LABEL,
  type QuoteStatus,
} from "@/lib/domain/enums";
import { QuoteEditor } from "../QuoteEditor";

/**
 * Transiciones manuales que se ofrecen desde cada estado (HU-COT-12).
 *
 * "Aceptada" no está acá: aceptar CREA la venta (HU-VEN-02) y tiene su propia
 * acción. "Enviada" tampoco: la pone el envío del correo. Y una vencida se
 * reabre emitiendo una versión nueva, no con un botón de estado, así que su
 * salida es "Editar", no esta lista.
 */
const NEXT_STATUSES: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["archived"],
  sent: ["negotiation", "rejected"],
  negotiation: ["rejected"],
  accepted: [],
  rejected: [],
  expired: [],
  archived: ["draft"],
};

/** Verbo de la acción, que no siempre coincide con el nombre del estado. */
const TRANSITION_LABEL: Partial<Record<QuoteStatus, string>> = {
  negotiation: "Pasar a negociación",
  rejected: "Marcar como rechazada",
  archived: "Descartar borrador",
  draft: "Recuperar borrador",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-SV", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function CotizacionView({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const { user } = useSession();
  const [quote, setQuote] = useState<QuoteDetail | null>(null);
  const [versions, setVersions] = useState<QuoteVersionData[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openVersion, setOpenVersion] = useState<QuoteVersionData | null>(null);
  /** Transición pendiente de confirmar. Las dos que cierran exigen motivo. */
  const [pendingStatus, setPendingStatus] = useState<QuoteStatus | null>(null);
  const [confirmingAccept, setConfirmingAccept] = useState(false);
  const [reassigning, setReassigning] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, history] = await Promise.all([
        crmApi.getQuote(quoteId),
        crmApi.quoteVersions(quoteId),
      ]);
      setQuote(detail);
      setVersions(history);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 404
          ? "Esta cotización no existe."
          : "No se pudo cargar la cotización.",
      );
    }
  }, [quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Solo hace falta para el selector de reasignación, que ven Gerente y
  // Administrador; que falle no puede dejar el detalle sin cargar.
  useEffect(() => {
    if (user?.role === "advisor") return;
    crmApi.team().then(setTeam).catch(() => undefined);
  }, [user?.role]);

  /**
   * Cambio de estado · HU-COT-12.
   *
   * Rechazar y descartar exigen motivo y son irreversibles, así que pasan por el
   * diálogo. El resto se aplica directo: pasar a negociación no cierra nada.
   */
  async function changeStatus(
    status: QuoteStatus,
    close: { reasonId?: string; reason?: string } = {},
  ) {
    setBusy(true);
    setActionError(null);
    try {
      setQuote(await crmApi.changeQuoteStatus(quoteId, status, close));
      setPendingStatus(null);
      setNotice(`La cotización quedó ${QUOTE_STATUS_LABEL[status].toLowerCase()}.`);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : "No se pudo cambiar el estado.",
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Duplicar · B5.
   *
   * Lleva directo a la copia: lo siguiente que se hace es cambiarle lo que
   * distingue a esta variante, y volver al listado a buscarla sería un paso de
   * más.
   */
  async function duplicate() {
    setBusy(true);
    setActionError(null);
    try {
      const copy = await crmApi.duplicateQuote(quoteId);
      router.push(`/cotizaciones/${copy.id}`);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : "No se pudo duplicar la cotización.",
      );
      setBusy(false);
    }
  }

  async function reassign(advisorId: string) {
    setBusy(true);
    setActionError(null);
    try {
      setQuote(await crmApi.reassignQuote(quoteId, advisorId));
      setReassigning(false);
      setNotice("La cotización cambió de responsable.");
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : "No se pudo reasignar la cotización.",
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Aceptar y crear la venta · HU-VEN-02.
   *
   * Lleva directo a la venta: lo siguiente que hace el asesor es registrar el
   * anticipo, y volver al listado para buscarla sería un paso de más.
   */
  async function accept(paymentDueDate?: string) {
    setBusy(true);
    setActionError(null);
    try {
      const result = await crmApi.acceptQuote(quoteId, { paymentDueDate });
      // `A5` · el resultado del correo se perdía al navegar. Viaja como código
      // de estado, nunca con los destinatarios: son datos personales y no van
      // en una barra de direcciones.
      const outcome = result.confirmation.sent
        ? result.confirmation.simulated
          ? "simulada"
          : "enviada"
        : "fallida";
      router.push(`/ventas/${result.sale.id}?confirmacion=${outcome}`);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : "No se pudo crear la venta.",
      );
      setConfirmingAccept(false);
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="card" style={{ padding: 48, textAlign: "center" }}>
        <div style={{ color: "var(--red)", fontWeight: 600, marginBottom: 12 }}>{error}</div>
        <Link href="/cotizaciones" className="btn ghost">
          Volver a cotizaciones
        </Link>
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-mute)" }}>
        Cargando cotización…
      </div>
    );
  }

  const version = quote.currentVersion;
  const editable = QUOTE_EDITABLE_STATUSES.includes(quote.status);
  // Editar una vencida es la forma de reabrirla, así que el botón cambia de
  // nombre: no es "otra versión más", es sacarla del estado en que quedó.
  const reopening = quote.status === "expired";
  // Solo lo que el cliente ya recibió se puede aceptar, y solo con vigencia al
  // día: aceptar un precio vencido es aceptar un precio que ya no se sostiene.
  const canAccept =
    ["sent", "negotiation"].includes(quote.status) && !quote.saleId && !quote.isOverdue;
  const canReassign = user?.role !== "advisor";

  if (editing) {
    return (
      <QuoteEditor
        quote={quote}
        onCancel={() => setEditing(false)}
        onSaved={(saved) => {
          setQuote(saved);
          setEditing(false);
          void load();
        }}
      />
    );
  }

  return (
    <>
      <div className="card exp-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 className="mono" style={{ margin: 0, fontSize: 22, color: "var(--navy)" }}>
              {quote.code}
            </h1>
            <span className={`chip ${QUOTE_STATUS_CHIP[quote.status]}`}>
              {QUOTE_STATUS_LABEL[quote.status]}
            </span>
            <span className="chip">v{quote.versionCount}</span>
            {quote.hasUnsentChanges && (
              <span
                className="chip orange"
                title={`El cliente recibió la v${quote.lastSentVersionNumber}`}
              >
                v{quote.versionCount} sin enviar
              </span>
            )}
            {quote.isOverdue && <span className="chip red">Vencida</span>}
            {quote.noAnswer && !quote.hasUnsentChanges && (
              <span className="chip orange">Sin respuesta</span>
            )}
          </div>

          <div className="exp-meta">
            {quote.client && (
              <span>
                <Icon name="users" />
                <Link href={`/clientes/${quote.client.id}`} style={{ color: "inherit" }}>
                  {quote.client.name}
                </Link>
              </span>
            )}
            <span>
              <Icon name="pin" />
              {version?.trip.destination ?? "—"}
            </span>
            <span>
              <Icon name="doc" />
              {QUOTE_TYPE_LABEL[quote.quoteType]}
              {quote.supplierAgency ? ` · ${quote.supplierAgency.name}` : ""}
            </span>
            <span>
              <Icon name="calendar" />
              Válida hasta {formatDate(quote.validUntil)}
            </span>
          </div>
        </div>

        <div className="actions">
          {/* Duplicar sirve en CUALQUIER estado: la variante se arma tanto sobre
              una que se está negociando como sobre una que ya se rechazó. */}
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => void duplicate()}
            title="Crear un borrador nuevo con este contenido"
          >
            <Icon name="doc" />
            Duplicar
          </button>
          {canReassign && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => setReassigning(true)}
              title="Cambiar el asesor responsable"
            >
              <Icon name="users" />
              Reasignar
            </button>
          )}
          {editable && (
            <button
              type="button"
              className={`btn ${reopening || quote.hasUnsentChanges ? "ghost" : "ghost"}`}
              onClick={() => setEditing(true)}
            >
              <Icon name="edit" />
              {reopening
                ? "Reabrir con versión nueva"
                : quote.status === "draft"
                  ? "Editar"
                  : "Nueva versión"}
            </button>
          )}
          {editable && !reopening && (
            <button
              type="button"
              className={`btn ${quote.hasUnsentChanges ? "primary" : "ghost"}`}
              onClick={() => setSending(true)}
            >
              <Icon name="mail" />
              {quote.hasUnsentChanges
                ? `Enviar la v${quote.versionCount}`
                : quote.status === "draft"
                  ? "Enviar por correo"
                  : "Reenviar"}
            </button>
          )}
          {/* HU-VEN-02: aceptar crea la venta con la versión vigente. */}
          {canAccept && (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => setConfirmingAccept(true)}
            >
              <Icon name="cart" />
              Aceptar y crear venta
            </button>
          )}
          {quote.saleId && (
            <Link href={`/ventas/${quote.saleId}`} className="btn primary">
              <Icon name="cart" />
              Ver la venta
            </Link>
          )}
        </div>
      </div>

      {/* El aviso más urgente primero: si hay una versión sin enviar, esperar
          respuesta de la anterior no es lo que corresponde hacer. */}
      {quote.hasUnsentChanges && (
        <div className="auth-alert info" style={{ marginTop: 14 }}>
          <Icon name="mail" />
          <div>
            El cliente recibió la <b>versión {quote.lastSentVersionNumber}</b>. La vigente
            es la <b>versión {quote.versionCount}</b> y todavía no salió: enviala para que
            vea los cambios.
          </div>
        </div>
      )}

      {reopening && (
        <div className="auth-alert info" style={{ marginTop: 14 }}>
          <Icon name="calendar" />
          <div>
            La vigencia venció el {formatDate(quote.validUntil)}. Para retomarla,
            <b> reabrila con una versión nueva</b> y vigencia futura; el historial se
            conserva.
          </div>
        </div>
      )}

      {(quote.closeReason || quote.closeReasonNote) && (
        <div className="auth-alert info" style={{ marginTop: 14 }}>
          <Icon name="doc" />
          <div>
            <b>
              {quote.status === "archived" ? "Motivo del descarte" : "Motivo del rechazo"}:
            </b>{" "}
            {quote.closeReason?.name ?? "sin clasificar"}
            {quote.closeReasonNote && ` · ${quote.closeReasonNote}`}
          </div>
        </div>
      )}

      {notice && (
        <div className="auth-alert info" style={{ marginTop: 14 }} role="status">
          <Icon name="check" />
          <div>{notice}</div>
        </div>
      )}

      {actionError && (
        <div className="auth-alert error" style={{ marginTop: 14 }} role="alert">
          <Icon name="target" />
          <div>{actionError}</div>
        </div>
      )}

      <div className="exp-body" style={{ marginTop: 14 }}>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          {version && <VersionDetail version={version} quoteType={quote.quoteType} />}

          {version?.pdfFileId ? (
            <PdfViewer fileId={version.pdfFileId} code={quote.code} />
          ) : (
            <div className="card" style={{ padding: 32, textAlign: "center" }}>
              <Icon
                name="doc"
                width={26}
                height={26}
                style={{ color: "var(--text-faint)", marginBottom: 12 }}
              />
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Todavía no hay PDF</div>
              <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
                Se genera al enviar la cotización, con la versión vigente.
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="stats" style={{ gridTemplateColumns: "1fr" }}>
            <div className="stat">
              <div className="label">Precio final</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "var(--navy)" }}>
                {formatMoney(quote.finalPrice)}
              </div>
              {version && (
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: "1px solid var(--border-soft)",
                    fontSize: 12,
                    color: "var(--text-mute)",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>
                    <Icon name="lock" width={11} height={11} /> Utilidad interna
                  </span>
                  <b style={{ color: "var(--green)" }}>
                    {formatMoney(version.commissions.totalUtility)}
                  </b>
                </div>
              )}
            </div>
          </div>

          {NEXT_STATUSES[quote.status].length > 0 && (
            <div className="card">
              <div className="card-h">
                <span className="ttl">Avanzar el estado</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {NEXT_STATUSES[quote.status].map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="btn ghost tiny"
                    disabled={busy}
                    onClick={() =>
                      // Rechazar y descartar cierran el registro y piden motivo:
                      // van por el diálogo. Pasar a negociación no cierra nada.
                      QUOTE_STATUSES_NEEDING_REASON.includes(status)
                        ? setPendingStatus(status)
                        : void changeStatus(status)
                    }
                  >
                    {TRANSITION_LABEL[status] ?? QUOTE_STATUS_LABEL[status]}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 10, lineHeight: 1.6 }}>
                Aceptada y rechazada son definitivas. Un borrador descartado no se elimina:
                se archiva y se puede recuperar.
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-h">
              <span className="ttl">Versiones</span>
            </div>
            <div className="timeline">
              {versions.map((entry) => (
                <div key={entry.id} className="timeline-item">
                  <div
                    className="dot"
                    style={{
                      background:
                        entry.versionNumber === quote.versionCount
                          ? "var(--orange)"
                          : "var(--border)",
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <b>
                      Versión {entry.versionNumber}
                      {entry.versionNumber === quote.versionCount && " · vigente"}
                    </b>
                    <span className="detail">
                      {formatMoney(entry.pricing.finalPrice)} ·{" "}
                      {entry.createdBy?.name ?? "—"}
                    </span>
                    <RelativeTime className="when" iso={entry.issuedAt} />
                    {entry.versionNumber !== quote.versionCount && (
                      <button
                        type="button"
                        className="btn ghost tiny"
                        style={{ marginTop: 6 }}
                        onClick={() => setOpenVersion(entry)}
                      >
                        <Icon name="eye" />
                        Ver
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {sending && quote.client && (
        <SendModal
          quote={quote}
          onClose={() => setSending(false)}
          onSent={(updated, recipients, simulated) => {
            setQuote(updated);
            setSending(false);
            setNotice(
              simulated
                ? `Envío simulado a ${recipients.join(", ")}: el CRM está en modo de prueba de correo, así que no salió nada hacia el cliente.`
                : `Cotización enviada a ${recipients.join(", ")}.`,
            );
            void load();
          }}
        />
      )}

      {openVersion && (
        <ReadOnlyVersionModal
          version={openVersion}
          quoteType={quote.quoteType}
          onClose={() => setOpenVersion(null)}
        />
      )}

      {pendingStatus && (
        <CloseQuoteModal
          quote={quote}
          status={pendingStatus}
          busy={busy}
          onClose={() => setPendingStatus(null)}
          onConfirm={(reasonId, note) =>
            void changeStatus(pendingStatus, { reasonId, reason: note || undefined })
          }
        />
      )}

      {confirmingAccept && (
        <AcceptQuoteModal
          quote={quote}
          busy={busy}
          onClose={() => setConfirmingAccept(false)}
          onConfirm={(paymentDueDate) => void accept(paymentDueDate)}
        />
      )}

      {reassigning && (
        <ReassignModal
          quote={quote}
          team={team}
          busy={busy}
          onClose={() => setReassigning(false)}
          onConfirm={(advisorId) => void reassign(advisorId)}
        />
      )}
    </>
  );
}

/* ──────────── Cierre con motivo · HU-COT-12, hallazgos B1 y B6 ───────────── */

/**
 * Rechazar y descartar son irreversibles y piden por qué.
 *
 * El motivo alimenta el análisis de pérdida del Sprint 8, y es un dato que solo
 * sabe quien cierra el registro el día que lo cierra: capturarlo después ya no
 * se puede. Antes las dos acciones se disparaban con un clic y sin explicación.
 */
function CloseQuoteModal({
  quote,
  status,
  busy,
  onClose,
  onConfirm,
}: {
  quote: QuoteDetail;
  status: QuoteStatus;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reasonId: string, note: string) => void;
}) {
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [reasons, setReasons] = useState<LossReason[] | null>(null);
  const archiving = status === "archived";

  // Los motivos del ámbito "cotización": los del expediente hablan de la
  // relación con el cliente, no de la propuesta, y el backend los rechaza acá.
  useEffect(() => {
    crmApi
      .lossReasons("quote")
      .then(setReasons)
      .catch(() => setReasons([]));
  }, []);

  return (
    <Modal
      title={
        <>
          <Icon name={archiving ? "trash" : "x"} style={{ color: "var(--red)" }} />
          {archiving ? `Descartar ${quote.code}` : `Rechazar ${quote.code}`}
        </>
      }
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (reasonId) onConfirm(reasonId, note.trim());
        }}
      >
        <p className="modal-lead">
          {archiving ? (
            <>
              El borrador sale del listado pero <b>no se elimina</b>: el código {quote.code}{" "}
              ya está tomado, y una cotización que desaparece sin dejar rastro es un hueco
              que después nadie puede explicar. Se puede recuperar.
            </>
          ) : (
            <>
              La cotización queda <b>rechazada de forma definitiva</b>: desde ahí ya no se
              edita, ni se envía, ni se acepta. Si el cliente sigue negociando, dejala en
              negociación.
            </>
          )}
        </p>

        <label className="label" htmlFor="closeReasonId">
          {archiving ? "¿Por qué se descarta? *" : "¿Por qué la rechazó el cliente? *"}
        </label>
        <select
          id="closeReasonId"
          className="input"
          value={reasonId}
          onChange={(e) => setReasonId(e.target.value)}
          disabled={busy || reasons === null}
        >
          <option value="">
            {reasons === null ? "Cargando motivos…" : "Elegí el motivo…"}
          </option>
          {(reasons ?? []).map((reason) => (
            <option key={reason.id} value={reason.id}>
              {reason.name}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 12, color: "var(--text-mute)", marginTop: 6 }}>
          <Icon name="chart" width={12} height={12} /> El motivo agrupa el análisis de
          pérdida. Los administra un Gerente desde el backoffice.
        </div>

        <label className="label" htmlFor="closeReasonNote" style={{ marginTop: 14 }}>
          Detalle
        </label>
        <textarea
          id="closeReasonNote"
          className="input"
          rows={2}
          style={{ resize: "vertical", lineHeight: 1.6 }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            archiving
              ? "Se duplicó al crearla desde el expediente…"
              : "Le cotizaron $200 menos en otra agencia…"
          }
          disabled={busy}
        />
        <div style={{ fontSize: 12, color: "var(--text-mute)", marginTop: 6 }}>
          Opcional. Acompaña al motivo con lo concreto de este caso.
        </div>

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn danger" disabled={busy || !reasonId}>
            {busy ? "Guardando…" : archiving ? "Descartar borrador" : "Rechazar cotización"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────────── Aceptar y crear la venta · HU-VEN-02, hallazgo B7 ────────── */

/**
 * Aceptar dispara cuatro cosas de una vez y ninguna se deshace.
 *
 * Antes era un clic directo: creaba la venta, cerraba la cotización, movía el
 * expediente y le escribía al cliente sin preguntar. El diálogo enumera lo que
 * va a pasar y aprovecha para pedir la fecha límite de pago, que el backend ya
 * aceptaba y la interfaz nunca mandaba.
 */
function AcceptQuoteModal({
  quote,
  busy,
  onClose,
  onConfirm,
}: {
  quote: QuoteDetail;
  busy: boolean;
  onClose: () => void;
  onConfirm: (paymentDueDate?: string) => void;
}) {
  const [paymentDueDate, setPaymentDueDate] = useState("");

  return (
    <Modal
      title={
        <>
            <Icon name="cart" style={{ color: "var(--green)" }} />
            Aceptar {quote.code}
        </>
      }
      onClose={onClose}
    >

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(paymentDueDate || undefined);
          }}
        >
          <p className="modal-lead">
            Al aceptar la <b>versión {quote.versionCount}</b> por{" "}
            <b>{formatMoney(quote.finalPrice)}</b> pasan cuatro cosas, y ninguna se
            deshace:
          </p>

          <ul style={{ fontSize: 13, lineHeight: 1.9, paddingLeft: 20, margin: "0 0 16px" }}>
            <li>Se crea la venta con las comisiones congeladas tal como están hoy.</li>
            <li>La cotización queda aceptada y ya no se edita ni se vuelve a aceptar.</li>
            <li>El expediente avanza a «Reserva / anticipo».</li>
            <li>Le sale un correo de confirmación al cliente.</li>
          </ul>

          <label className="label" htmlFor="paymentDueDate">
            Fecha límite de pago
          </label>
          <input
            id="paymentDueDate"
            type="date"
            className="input"
            value={paymentDueDate}
            onChange={(e) => setPaymentDueDate(e.target.value)}
            disabled={busy}
          />
          <div style={{ fontSize: 12, color: "var(--text-mute)", marginTop: 6 }}>
            Opcional. Es la que alimenta el aviso de cobro atrasado del Dashboard.
          </div>

          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Creando la venta…" : "Aceptar y crear la venta"}
            </button>
          </div>
        </form>
    </Modal>
  );
}

/* ─────────────── Reasignar el responsable · hallazgo B3 ───────────────────── */

function ReassignModal({
  quote,
  team,
  busy,
  onClose,
  onConfirm,
}: {
  quote: QuoteDetail;
  team: TeamMember[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (advisorId: string) => void;
}) {
  const [advisorId, setAdvisorId] = useState("");

  return (
    <Modal
      title={
        <>
            <Icon name="users" style={{ color: "var(--orange)" }} />
            Reasignar {quote.code}
        </>
      }
      onClose={onClose}
    >

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (advisorId) onConfirm(advisorId);
          }}
        >
          <p className="modal-lead">
            Un Asesor solo trabaja sus propias cotizaciones. Responsable actual:{" "}
            <b>{quote.advisor?.name ?? "sin asignar"}</b>.
          </p>

          <label className="label" htmlFor="newAdvisor">
            Nuevo responsable *
          </label>
          <select
            id="newAdvisor"
            className="input"
            value={advisorId}
            onChange={(e) => setAdvisorId(e.target.value)}
            disabled={busy}
            autoFocus
          >
            <option value="">Elegí a quién pasa…</option>
            {team
              .filter((member) => member.id !== quote.advisor?.id)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName}
                </option>
              ))}
          </select>

          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={busy || !advisorId}>
              {busy ? "Reasignando…" : "Reasignar"}
            </button>
          </div>
        </form>
    </Modal>
  );
}

/* ─────────────────────────── Detalle de la versión ────────────────────────── */

function VersionDetail({
  version,
  quoteType,
}: {
  version: QuoteVersionData;
  quoteType: QuoteDetail["quoteType"];
}) {
  return (
    <>
      <div className="card">
        <div className="card-h">
          <span className="ttl">Viaje</span>
          <span className="chip blue">Sale en el PDF</span>
        </div>
        <div className="kv-grid">
          <div>
            <span className="k">Destino</span>
            <span className="v">{version.trip.destination}</span>
          </div>
          <div>
            <span className="k">Fechas</span>
            <span className="v">
              {formatDate(version.trip.startDate)} al {formatDate(version.trip.endDate)}
            </span>
          </div>
          <div>
            <span className="k">Viajeros</span>
            <span className="v">
              {version.trip.passengers.adults} adulto(s)
              {version.trip.passengers.children > 0 &&
                ` y ${version.trip.passengers.children} menor(es)`}
            </span>
          </div>
          <div>
            <span className="k">Emitida</span>
            <span className="v">{formatDate(version.issuedAt)}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <span className="ttl">
            {quoteType === "own_package" ? "Servicios incluidos" : "Propuesta"}
          </span>
        </div>

        {quoteType === "own_package" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {version.serviceLines.map((line, index) => (
              <div key={index} style={{ display: "flex", gap: 10, fontSize: 13 }}>
                <span
                  className="chip orange"
                  style={{ flex: "none", alignSelf: "flex-start" }}
                >
                  {SERVICE_TYPE_LABEL[line.serviceType]}
                </span>
                <span>{line.description}</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              {version.supplierProposal?.description}
            </div>
            {version.supplierProposal && version.supplierProposal.includes.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 13 }}>
                <b>Incluye:</b> {version.supplierProposal.includes.join(", ")}
              </div>
            )}
            {version.supplierProposal && version.supplierProposal.excludes.length > 0 && (
              <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
                <b>No incluye:</b> {version.supplierProposal.excludes.join(", ")}
              </div>
            )}
          </>
        )}
      </div>

      {/* Lo que el cliente lee en el PDF, visible también acá.
          Estos dos textos salían en el documento y no aparecían en ninguna
          pantalla del CRM: el asesor no podía revisar qué había mandado sin
          abrir el adjunto (hallazgo C3). */}
      {(version.conditions || version.clientNotes) && (
        <div className="card">
          <div className="card-h">
            <span className="ttl">Texto para el cliente</span>
            <span className="chip blue">Sale en el PDF</span>
          </div>

          {version.conditions && (
            <div>
              <span className="k">Condiciones</span>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                  marginTop: 4,
                }}
              >
                {version.conditions}
              </div>
            </div>
          )}

          {version.clientNotes && (
            <div style={{ marginTop: version.conditions ? 14 : 0 }}>
              <span className="k">Nota para el cliente</span>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                  marginTop: 4,
                }}
              >
                {version.clientNotes}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <span className="ttl">Precio y comisiones</span>
          <span className="chip">
            <Icon name="lock" width={11} height={11} />
            Interno
          </span>
        </div>
        <div className="kv-grid">
          <div>
            {/* El precio va acá porque es lo que cambia entre versiones: sin él,
                el historial no dice en qué se diferencian. */}
            <span className="k">Precio final</span>
            <span className="v" style={{ fontWeight: 700 }}>
              {formatMoney(version.pricing.finalPrice)} {version.pricing.currency}
            </span>
          </div>
          <div>
            <span className="k">Válida hasta</span>
            <span className="v">{formatDate(version.validUntil)}</span>
          </div>
          <div>
            <span className="k">Gestión</span>
            <span className="v">
              {formatMoney(version.commissions.management.amount)}{" "}
              <span style={{ fontSize: 12, color: "var(--text-mute)" }}>
                ({version.commissions.management.mode === "percentage"
                  ? `${version.commissions.management.value} %`
                  : "monto fijo"}
                )
              </span>
            </span>
          </div>
          {version.commissions.agency && (
            <div>
              <span className="k">Agencia</span>
              <span className="v">
                {formatMoney(version.commissions.agency.amount)}{" "}
                <span style={{ fontSize: 12, color: "var(--text-mute)" }}>
                  ({version.commissions.agency.mode === "percentage"
                    ? `${version.commissions.agency.value} %`
                    : "monto fijo"}
                  )
                </span>
              </span>
            </div>
          )}
          <div>
            <span className="k">Utilidad total</span>
            <span className="v" style={{ fontWeight: 700, color: "var(--green)" }}>
              {formatMoney(version.commissions.totalUtility)}
            </span>
          </div>
        </div>

        {version.internalNotes && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid var(--border-soft)",
              fontSize: 13,
              color: "var(--text-mute)",
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
            }}
          >
            {version.internalNotes}
          </div>
        )}
      </div>
    </>
  );
}

/* ──────────────────────── Visor de PDF · pantalla 2 ───────────────────────── */

/**
 * El PDF se muestra con el visor del navegador, que ya trae descarga e
 * impresión. La URL es firmada y caduca: no se puede compartir el enlace como
 * si fuera público (HU-ARC-02).
 */
function PdfViewer({ fileId, code }: { fileId: string; code: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // El enlace del visor se pide al montar porque el `iframe` lo usa al instante.
  useEffect(() => {
    crmApi
      .fileUrl(fileId)
      .then((file) => setUrl(file.url))
      .catch(() => setError("No se pudo abrir el PDF. Probá de nuevo."));
  }, [fileId]);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="card-h"
        style={{ margin: 0, padding: "14px 18px", borderBottom: "1px solid var(--border-soft)" }}
      >
        <span className="ttl">Documento del cliente</span>
        <span style={{ display: "flex", gap: 6 }}>
          {/* Abrir pide una URL fresca y descargar pasa por el API: el enlace
              firmado caduca a los 15 minutos y `download` no aplica contra otro
              dominio (hallazgo F3). */}
          <SignedFileLink fileId={fileId} label="Abrir" fileName={`${code}.pdf`} />
        </span>
      </div>

      {error ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--red)", fontSize: 13 }}>
          {error}
        </div>
      ) : url ? (
        <iframe
          src={url}
          title={`Cotización ${code}`}
          style={{ width: "100%", height: 620, border: 0, display: "block" }}
        />
      ) : (
        <div style={{ padding: 32, textAlign: "center", color: "var(--text-mute)", fontSize: 13 }}>
          Generando enlace seguro…
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Envío · HU-COT-09 ────────────────────────────── */

function SendModal({
  quote,
  onClose,
  onSent,
}: {
  quote: QuoteDetail;
  onClose: () => void;
  onSent: (quote: QuoteDetail, recipients: string[], simulated: boolean) => void;
}) {
  const [to, setTo] = useState(quote.currentVersion?.clientSnapshot.email ?? "");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await crmApi.sendQuote(quote.id, {
        to: to.split(",").map((address) => address.trim()).filter(Boolean),
        message: message.trim() || undefined,
      });
      onSent(result.quote, result.recipients, result.simulated);
    } catch (caught) {
      // El backend deja la cotización como estaba si el correo no salió.
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo enviar la cotización.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={
        <>
            <Icon name="mail" style={{ color: "var(--orange)" }} />
            Enviar {quote.code}
        </>
      }
      onClose={onClose}
    >

        <form onSubmit={handleSubmit}>
          <p className="modal-lead">
            Se genera el PDF de la versión vigente y se adjunta al correo. La cotización
            pasa a <b>enviada</b> solo si el envío sale bien.
          </p>

          {error && (
            <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
              <Icon name="target" />
              <div>{error}</div>
            </div>
          )}

          <label className="label" htmlFor="to">
            Destinatarios
          </label>
          <input
            id="to"
            className="input"
            required
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="cliente@correo.com"
            disabled={submitting}
          />
          <div style={{ fontSize: 12, color: "var(--text-mute)", marginTop: 6 }}>
            Separá varios con coma.
          </div>

          <label className="label" htmlFor="message" style={{ marginTop: 14 }}>
            Mensaje
          </label>
          <textarea
            id="message"
            className="input"
            rows={3}
            style={{ resize: "vertical", lineHeight: 1.6 }}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Adjuntamos la cotización solicitada. Quedamos atentos a cualquier consulta."
            disabled={submitting}
          />

          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? "Enviando…" : "Generar PDF y enviar"}
            </button>
          </div>
        </form>
    </Modal>
  );
}

/* ───────────────── Versión anterior en solo lectura · HU-COT-11 ───────────── */

function ReadOnlyVersionModal({
  version,
  quoteType,
  onClose,
}: {
  version: QuoteVersionData;
  quoteType: QuoteDetail["quoteType"];
  onClose: () => void;
}) {
  return (
    <Modal
      title={
        <>
            <Icon name="doc" />
            Versión {version.versionNumber}
        </>
      }
      onClose={onClose}
    >

        <p className="modal-lead">
          Solo lectura: las versiones anteriores son la constancia de lo que el cliente
          recibió y no se modifican.
        </p>

        <VersionDetail version={version} quoteType={quoteType} />

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>
    </Modal>
  );
}
