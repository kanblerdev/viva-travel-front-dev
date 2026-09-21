"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { DialogTitle, todayLocal } from "@/components/DialogTitle";
import { Modal } from "@/components/Modal";
import { ClientPicker } from "@/components/ClientPicker";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/AuthProvider";
import {
  crmApi,
  formatAmount,
  type ClientSummary,
  type ConfirmationResult,
  type PaymentMethodOption,
  type SaleDetail,
  type SalePayment,
  type Supplier,
  type TeamMember,
} from "@/lib/api/crm";
import { commissionAmount, fromCents, isValidAmount, toCents } from "@/lib/domain/money";
import {
  COMMISSION_MODE_LABEL,
  COMMISSION_MODES,
  PAYMENT_KINDS,
  QUOTE_TYPE_LABEL,
  QUOTE_TYPES,
  type CommissionMode,
  type PaymentKind,
  type QuoteType,
} from "@/lib/domain/enums";

/** Lo que acepta el backend para un archivo adjunto · DM-05. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  deposit: "Anticipo",
  partial: "Abono parcial",
  final: "Pago final",
};

/* ──────────────── Abono con comprobante · HU-VEN-05 y HU-VEN-06 ───────────── */

/**
 * Registrar un abono.
 *
 * El comprobante del cliente NO bloquea el cobro (`C2`): si la carga falla, el
 * abono se registra igual y se avisa que el archivo quedó pendiente. El dinero
 * ya entró, y perder el registro por no poder guardar una foto es el peor de los
 * dos resultados posibles.
 */
export function RegistrarPagoModal({
  sale,
  onClose,
  onRegistered,
}: {
  sale: SaleDetail;
  onClose: () => void;
  onRegistered: (sale: SaleDetail, warning?: string) => void;
}) {
  const [amount, setAmount] = useState(sale.balanceAmount);
  const [touchedKind, setTouchedKind] = useState(false);
  const [kind, setKind] = useState<PaymentKind>("deposit");
  const [paidAt, setPaidAt] = useState(todayLocal);
  const [notes, setNotes] = useState("");
  const [methodId, setMethodId] = useState("");
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El catálogo se pide una vez: son media docena de opciones que casi nunca
  // cambian, y "Sin especificar" existe solo para los abonos viejos, así que no
  // se ofrece al registrar uno nuevo.
  useEffect(() => {
    crmApi
      .paymentMethods()
      .then((list) => setMethods(list.filter((m) => m.code !== "unspecified")))
      .catch(() => undefined);
  }, []);

  const trimmed = amount.trim();
  const validAmount = isValidAmount(trimmed) && toCents(trimmed) > 0n;
  const balanceCents = toCents(sale.balanceAmount);
  const exceedsBalance = validAmount && toCents(trimmed) > balanceCents;

  /**
   * El concepto se deriva del monto · hallazgo `E3`.
   *
   * Antes era "sin abonos previos → anticipo, si no → pago final", así que el
   * segundo de tres abonos se proponía como *pago final*. Lo que decide es si el
   * monto cubre el saldo, no cuántos abonos hubo.
   */
  const activePayments = sale.payments.filter((payment) => !payment.voidedAt).length;
  const suggestedKind: PaymentKind = useMemo(() => {
    if (!validAmount) return activePayments === 0 ? "deposit" : "partial";
    if (toCents(trimmed) >= balanceCents) return activePayments === 0 ? "deposit" : "final";
    return activePayments === 0 ? "deposit" : "partial";
  }, [validAmount, trimmed, balanceCents, activePayments]);

  // La sugerencia manda hasta que el usuario elige a mano: a partir de ahí es
  // una decisión suya y no se le pisa.
  const effectiveKind = touchedKind ? kind : suggestedKind;

  // `C2` · el archivo se comprueba ANTES de subirlo: descubrir el límite tras
  // esperar la carga de 12 MB es la peor forma de enterarse.
  const fileTooBig = receipt !== null && receipt.size > MAX_UPLOAD_BYTES;
  const fileWrongType = receipt !== null && !ACCEPTED_TYPES.includes(receipt.type);
  const fileRejected = fileTooBig || fileWrongType;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validAmount || exceedsBalance || fileRejected || !methodId) return;

    setSubmitting(true);
    setError(null);

    // La subida es "mejor esfuerzo": lo que no puede perderse es el cobro.
    let receiptFileId: string | undefined;
    let warning: string | undefined;
    if (receipt) {
      try {
        const stored = await crmApi.uploadFile(receipt, {
          clientId: sale.client?.id ?? "",
          fileType: "payment_receipt",
          relatedEntityId: sale.id,
          relatedEntityType: "sale",
        });
        receiptFileId = stored.id;
      } catch {
        warning =
          "El abono quedó registrado, pero el comprobante no se pudo subir. Adjuntalo desde la pestaña Archivos del expediente.";
      }
    }

    try {
      const updated = await crmApi.registerPayment(sale.id, {
        amount: trimmed,
        kind: effectiveKind,
        methodId: methodId || undefined,
        paidAt,
        receiptFileId,
        notes: notes.trim() || undefined,
      });
      onRegistered(updated, warning);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo registrar el abono.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={<DialogTitle icon="tag">Registrar abono · {sale.code}</DialogTitle>}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <p className="modal-lead">
          Saldo pendiente: <b className="num">{formatAmount(sale.balanceAmount)}</b>. Al
          guardar se emite el comprobante y se actualiza el estado de cuenta.
        </p>

        {error && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        <div className="modal-grid">
          <div>
            <label className="label" htmlFor="paymentAmount">
              Monto recibido (USD)
            </label>
            <input
              id="paymentAmount"
              className="input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={submitting}
              autoFocus
              required
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                type="button"
                className="btn ghost tiny"
                disabled={submitting}
                onClick={() => setAmount(fromCents(balanceCents / 2n))}
              >
                50 %
              </button>
              <button
                type="button"
                className="btn ghost tiny"
                disabled={submitting}
                onClick={() => setAmount(sale.balanceAmount)}
              >
                Saldo completo
              </button>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="paymentKind">
              Concepto
            </label>
            <select
              id="paymentKind"
              className="input"
              value={effectiveKind}
              onChange={(e) => {
                setTouchedKind(true);
                setKind(e.target.value as PaymentKind);
              }}
              disabled={submitting}
            >
              {PAYMENT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_KIND_LABEL[value]}
                </option>
              ))}
            </select>
            {!touchedKind && (
              <div className="field-hint">Sugerido según el monto. Podés cambiarlo.</div>
            )}
          </div>
        </div>

        {exceedsBalance && (
          <div className="field-hint is-error">
            <Icon name="target" width={12} height={12} />
            El abono no puede superar el saldo de {formatAmount(sale.balanceAmount)}.
          </div>
        )}

        <label className="label" htmlFor="paymentMethod" style={{ marginTop: 14 }}>
          Forma de pago
        </label>
        <select
          id="paymentMethod"
          className="input"
          value={methodId}
          onChange={(e) => setMethodId(e.target.value)}
          disabled={submitting || methods.length === 0}
          required
        >
          <option value="">Elegí cómo se recibió…</option>
          {methods.map((method) => (
            <option key={method.id} value={method.id}>
              {method.name}
            </option>
          ))}
        </select>
        <div className="field-hint">
          <Icon name="tag" width={12} height={12} />
          Solo se sabe ahora: después no hay forma de reconstruirlo.
        </div>

        <label className="label" htmlFor="paymentDate" style={{ marginTop: 14 }}>
          Fecha del pago
        </label>
        <input
          id="paymentDate"
          type="date"
          className="input"
          value={paidAt}
          max={todayLocal}
          onChange={(e) => setPaidAt(e.target.value)}
          disabled={submitting}
        />

        <label className="label" htmlFor="paymentReceipt" style={{ marginTop: 14 }}>
          Comprobante del cliente
        </label>
        <input
          id="paymentReceipt"
          type="file"
          className="input"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
          disabled={submitting}
        />
        {fileTooBig ? (
          <div className="field-hint is-error">
            <Icon name="target" width={12} height={12} />
            El archivo pesa {(receipt!.size / 1024 / 1024).toFixed(1)} MB y el máximo es 10 MB.
          </div>
        ) : fileWrongType ? (
          <div className="field-hint is-error">
            <Icon name="target" width={12} height={12} />
            Solo se aceptan PDF, JPG y PNG.
          </div>
        ) : (
          <div className="field-hint">
            <Icon name="doc" width={12} height={12} />
            Opcional · PDF, JPG o PNG hasta 10 MB. Si falla la carga, el abono se registra
            igual.
          </div>
        )}

        <label className="label" htmlFor="paymentNotes" style={{ marginTop: 14 }}>
          Referencia
        </label>
        <input
          id="paymentNotes"
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Transferencia Banco Agrícola, depósito en efectivo…"
          disabled={submitting}
        />

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={
              submitting || !validAmount || exceedsBalance || fileRejected || !methodId
            }
          >
            {submitting ? "Registrando…" : "Registrar abono"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────────────────── Cancelación · HU-VEN-04 ──────────────────────────── */

/**
 * Cancelar una venta · DM-16.
 *
 * El motivo es obligatorio y solo lo hace Gerente o Administrador. Desde el 5D
 * se puede cancelar también una venta ya cobrada o con el viaje en marcha, así
 * que la confirmación tiene que decir QUÉ pasa con cada cosa: los abonos, la
 * factura y la cotización de origen.
 */
export function CancelarVentaModal({
  sale,
  onClose,
  onCanceled,
}: {
  sale: SaleDetail;
  onClose: () => void;
  onCanceled: (sale: SaleDetail) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paid = toCents(sale.paidAmount) > 0n;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onCanceled(await crmApi.changeSaleStatus(sale.id, "canceled", reason.trim()));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo cancelar la venta.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={<DialogTitle icon="target">Cancelar {sale.code}</DialogTitle>}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <p className="modal-lead">Al cancelar, esto es lo que ocurre:</p>

        <ul className="consequences">
          <li>La venta deja de contar en los indicadores del mes.</li>
          <li>
            Los abonos registrados <b>no</b> se borran: quedan como constancia de lo
            recibido. La devolución se gestiona fuera del sistema.
          </li>
          {sale.quote && (
            <li>
              La cotización <b className="mono">{sale.quote.name}</b> vuelve a quedar
              disponible para aceptarse de nuevo.
            </li>
          )}
          {sale.invoiceCode && (
            <li>
              La factura <b className="mono">{sale.invoiceCode}</b> ya emitida <b>no</b> se
              anula automáticamente. Coordinalo con administración.
            </li>
          )}
        </ul>

        {error && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        {paid && (
          <div className="auth-alert error" style={{ marginBottom: 14 }}>
            <Icon name="target" />
            <div>
              Esta venta tiene <b>{formatAmount(sale.paidAmount)}</b> cobrados. Confirmá la
              devolución con administración antes de cancelar.
            </div>
          </div>
        )}

        <label className="label" htmlFor="cancelReason">
          Motivo de la cancelación
        </label>
        <textarea
          id="cancelReason"
          className="input"
          rows={3}
          style={{ resize: "vertical", lineHeight: 1.6 }}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="El cliente desistió del viaje, el proveedor canceló la salida…"
          disabled={submitting}
          required
          autoFocus
        />

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Volver
          </button>
          <button
            type="submit"
            className="btn danger"
            disabled={submitting || reason.trim().length < 3}
          >
            {submitting ? "Cancelando…" : "Cancelar la venta"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ────────────────── Anulación de un abono · DM-15 · `C1` ──────────────────── */

/**
 * Anular un abono.
 *
 * No hay diálogo para EDITARLO, y no lo va a haber: corregir el monto en su
 * sitio dejaría el `REC-NNNN` que el cliente ya tiene en la mano diciendo otra
 * cosa. Se anula el asiento equivocado y se registra el correcto.
 */
export function AnularAbonoModal({
  sale,
  payment,
  onClose,
  onVoided,
}: {
  sale: SaleDetail;
  payment: SalePayment;
  onClose: () => void;
  onVoided: (sale: SaleDetail) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balanceAfter = fromCents(
    toCents(sale.balanceAmount) + toCents(payment.amount),
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onVoided(await crmApi.voidPayment(sale.id, payment.id, reason.trim()));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo anular el abono.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={<DialogTitle icon="target">Anular {payment.receiptCode}</DialogTitle>}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <p className="modal-lead">Al anular, esto es lo que ocurre:</p>

        <ul className="consequences">
          <li>
            El asiento <b className="mono">{payment.receiptCode}</b> se conserva, tachado y
            con este motivo. <b>No</b> se borra: su correlativo ya se emitió.
          </li>
          <li>
            Deja de sumar al cobro: el saldo pasa de{" "}
            <b className="num">{formatAmount(sale.balanceAmount)}</b> a{" "}
            <b className="num">{formatAmount(balanceAfter)}</b>.
          </li>
          <li>
            Si con esto la venta deja de estar saldada, vuelve a{" "}
            <b>reservada</b> por sí sola.
          </li>
        </ul>

        {error && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        <label className="label" htmlFor="voidReason">
          Motivo de la anulación
        </label>
        <textarea
          id="voidReason"
          className="input"
          rows={3}
          style={{ resize: "vertical", lineHeight: 1.6 }}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Cargado en la venta equivocada, monto distinto al recibido…"
          disabled={submitting}
          required
          autoFocus
        />

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Volver
          </button>
          <button
            type="submit"
            className="btn danger"
            disabled={submitting || reason.trim().length < 3}
          >
            {submitting ? "Anulando…" : "Anular el abono"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────────── Reenvío de la confirmación · HU-VEN-08 · `G6` ────────────── */

/**
 * Reenviar la confirmación al cliente.
 *
 * El endpoint aceptaba destinatarios y mensaje desde el Sprint 5 y el botón
 * mandaba a ciegas al correo del expediente: si no había ninguno, devolvía un
 * error y no ofrecía escribirlo. Ahora se puede corregir el destinatario en el
 * momento sin salir a editar el expediente.
 *
 * ⚠️ El cuerpo NO lleva comisiones ni utilidad: lo arma el backend (regla 8.2).
 */
export function ReenviarConfirmacionModal({
  sale,
  onClose,
  onSent,
}: {
  sale: SaleDetail;
  onClose: () => void;
  onSent: (result: { sale: SaleDetail; confirmation: ConfirmationResult }) => void;
}) {
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recipients = to
    .split(/[,;\s]+/)
    .map((address) => address.trim())
    .filter(Boolean);
  const malformed = recipients.filter((address) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (malformed.length > 0) return;

    setSubmitting(true);
    setError(null);
    try {
      onSent(
        await crmApi.sendSaleConfirmation(sale.id, {
          to: recipients.length > 0 ? recipients : undefined,
          message: message.trim() || undefined,
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo enviar la confirmación.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={<DialogTitle icon="tag">Reenviar confirmación · {sale.code}</DialogTitle>}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <p className="modal-lead">
          Se envía el resumen de la reserva con precio, abonado y saldo. Las comisiones y la
          utilidad <b>nunca</b> salen en este correo.
        </p>

        {error && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        <label className="label" htmlFor="confirmTo">
          Destinatarios
        </label>
        <input
          id="confirmTo"
          className="input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Vacío = el correo del expediente"
          disabled={submitting}
          autoFocus
        />
        {malformed.length > 0 ? (
          <div className="field-hint is-error">
            <Icon name="target" width={12} height={12} />
            No parece un correo: {malformed.join(", ")}.
          </div>
        ) : (
          <div className="field-hint">
            <Icon name="mail" width={12} height={12} />
            Separá varios con coma. Dejalo vacío para usar el del expediente.
          </div>
        )}

        <label className="label" htmlFor="confirmMessage" style={{ marginTop: 14 }}>
          Mensaje
        </label>
        <textarea
          id="confirmMessage"
          className="input"
          rows={3}
          style={{ resize: "vertical", lineHeight: 1.6 }}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Vacío = el texto estándar de confirmación de la reserva"
          disabled={submitting}
        />

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={submitting || malformed.length > 0}
          >
            {submitting ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────────── Anulación de la factura · DM-20 · `B5` ───────────────────── */

/**
 * Anular la factura interna.
 *
 * No hay reemisión: el correlativo ya se consumió. Lo que ocurre es que el PDF
 * se regenera con el sello de ANULADA sobre el mismo archivo, para que una copia
 * impresa vieja y la que se descarga hoy no digan cosas distintas.
 */
export function AnularFacturaModal({
  sale,
  onClose,
  onVoided,
}: {
  sale: SaleDetail;
  onClose: () => void;
  onVoided: (sale: SaleDetail) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onVoided(await crmApi.voidInvoice(sale.id, reason.trim()));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo anular la factura.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={<DialogTitle icon="target">Anular {sale.invoiceCode}</DialogTitle>}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <p className="modal-lead">Al anular, esto es lo que ocurre:</p>

        <ul className="consequences">
          <li>
            El correlativo <b className="mono">{sale.invoiceCode}</b> se conserva. <b>No</b>{" "}
            se reemite con otro número: dos facturas para la misma operación es justo lo que
            un correlativo existe para evitar.
          </li>
          <li>
            El PDF se regenera con el sello de <b>ANULADA</b> sobre el mismo archivo, así que
            el enlace que ya se compartió muestra el documento anulado.
          </li>
          <li>Esta venta queda sin factura vigente y no se puede volver a facturar.</li>
        </ul>

        {error && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        <label className="label" htmlFor="voidInvoiceReason">
          Motivo de la anulación
        </label>
        <textarea
          id="voidInvoiceReason"
          className="input"
          rows={3}
          style={{ resize: "vertical", lineHeight: 1.6 }}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Emitida sobre la venta equivocada, datos del cliente incorrectos…"
          disabled={submitting}
          required
          autoFocus
        />

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Volver
          </button>
          <button
            type="submit"
            className="btn danger"
            disabled={submitting || reason.trim().length < 3}
          >
            {submitting ? "Anulando…" : "Anular la factura"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ──────────────── Corregir los datos de la venta · `B3` ───────────────────── */

/**
 * Editar la venta.
 *
 * Solo la DESCRIPCIÓN de la operación. El precio y las comisiones son el
 * snapshot de lo que el cliente aceptó y no se tocan — el backend tampoco los
 * acepta. Si el trato cambió, se cancela la venta y se emite otra.
 */
export function EditarVentaModal({
  sale,
  onClose,
  onSaved,
}: {
  sale: SaleDetail;
  onClose: () => void;
  onSaved: (sale: SaleDetail) => void;
}) {
  const [destination, setDestination] = useState(sale.destination);
  const [tripStart, setTripStart] = useState(sale.tripStart?.slice(0, 10) ?? "");
  const [tripEnd, setTripEnd] = useState(sale.tripEnd?.slice(0, 10) ?? "");
  const [paymentDueDate, setPaymentDueDate] = useState(
    sale.paymentDueDate?.slice(0, 10) ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tripBackwards = tripStart !== "" && tripEnd !== "" && tripEnd < tripStart;
  const blocked = destination.trim().length < 2 || tripBackwards;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;

    setSubmitting(true);
    setError(null);
    try {
      // `null` vacía el campo y ausente lo deja igual: hay que distinguir "lo
      // borré" de "no lo toqué", o una fecha limpiada volvería sola.
      onSaved(
        await crmApi.updateSale(sale.id, {
          destination: destination.trim(),
          tripStart: tripStart || null,
          tripEnd: tripEnd || null,
          paymentDueDate: paymentDueDate || null,
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo guardar la venta.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={<DialogTitle icon="cart">Editar {sale.code}</DialogTitle>}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <p className="modal-lead">
          Se corrigen los datos del viaje y el plazo de pago. El precio y las comisiones
          quedaron congelados al cerrar la venta y no se editan.
        </p>

        {error && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        <label className="label" htmlFor="editDestination">
          Destino
        </label>
        <input
          id="editDestination"
          className="input"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          disabled={submitting}
          required
          autoFocus
        />

        <div className="modal-grid" style={{ marginTop: 14 }}>
          <div>
            <label className="label" htmlFor="editTripStart">
              Salida
            </label>
            <input
              id="editTripStart"
              type="date"
              className="input"
              value={tripStart}
              onChange={(e) => setTripStart(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div>
            <label className="label" htmlFor="editTripEnd">
              Regreso
            </label>
            <input
              id="editTripEnd"
              type="date"
              className="input"
              min={tripStart || undefined}
              value={tripEnd}
              onChange={(e) => setTripEnd(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        {tripBackwards && (
          <div className="field-hint is-error">
            <Icon name="target" width={12} height={12} />
            El regreso no puede ser anterior a la salida.
          </div>
        )}

        <label className="label" htmlFor="editDue" style={{ marginTop: 14 }}>
          Fecha límite de pago
        </label>
        <input
          id="editDue"
          type="date"
          className="input"
          value={paymentDueDate}
          onChange={(e) => setPaymentDueDate(e.target.value)}
          disabled={submitting}
        />
        <div className="field-hint">
          <Icon name="doc" width={12} height={12} />
          Dejala vacía para quitar el plazo. Es la fecha que decide si el cobro figura
          atrasado.
        </div>

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={submitting || blocked}>
            {submitting ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ──────────────────── Reasignar el asesor · `B3` ──────────────────────────── */

export function ReasignarVentaModal({
  sale,
  team,
  onClose,
  onReassigned,
}: {
  sale: SaleDetail;
  team: TeamMember[];
  onClose: () => void;
  onReassigned: (sale: SaleDetail) => void;
}) {
  const [advisorId, setAdvisorId] = useState(sale.advisor?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onReassigned(await crmApi.reassignSale(sale.id, advisorId));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo reasignar la venta.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={<DialogTitle icon="cart">Reasignar {sale.code}</DialogTitle>}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <p className="modal-lead">
          El asesor responsable es quien puede trabajar la venta y a quien se le atribuye en
          los reportes.
        </p>

        {error && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        <label className="label" htmlFor="reassignAdvisor">
          Asesor responsable
        </label>
        <select
          id="reassignAdvisor"
          className="input"
          value={advisorId}
          onChange={(e) => setAdvisorId(e.target.value)}
          disabled={submitting}
          required
        >
          <option value="">Elegí un asesor…</option>
          {team.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </select>

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={submitting || !advisorId || advisorId === sale.advisor?.id}
          >
            {submitting ? "Reasignando…" : "Reasignar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}


