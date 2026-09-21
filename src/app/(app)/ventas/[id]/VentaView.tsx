"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icon";
import { RelativeTime } from "@/components/RelativeTime";
import { SignedFileLink } from "@/components/SignedFileLink";
import { useSession } from "@/lib/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import {
  crmApi,
  formatAmount,
  formatMoney,
  paidPercentage,
  type SaleDetail,
  type SaleActivity,
  type SalePayment,
  type TeamMember,
} from "@/lib/api/crm";
import {
  manualSaleTransitions,
  PAYMENT_STATUS_LABEL,
  QUOTE_TYPE_LABEL,
  SALE_STATUS_LABEL,
  type PaymentKind,
} from "@/lib/domain/enums";
import {
  AnularAbonoModal,
  AnularFacturaModal,
  ReenviarConfirmacionModal,
  CancelarVentaModal,
  EditarVentaModal,
  ReasignarVentaModal,
  RegistrarPagoModal,
} from "../modals";
import { SALE_STATUS_CHIP } from "../VentasView";

const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  deposit: "Anticipo",
  partial: "Abono parcial",
  final: "Pago final",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-SV", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** Lo que "Aceptar y crear venta" alcanzó a saber del correo · `A5`. */
const CONFIRMATION_NOTICE: Record<string, string> = {
  enviada: "Venta creada y confirmación enviada al cliente.",
  simulada:
    "Venta creada. La confirmación quedó simulada: el CRM está en modo de prueba de correo, así que no salió nada hacia el cliente.",
  fallida:
    "Venta creada, pero NO se envió la confirmación. Revisá el correo del expediente y reenviala desde acá.",
};

export function VentaView({ saleId }: { saleId: string }) {
  const { user } = useSession();
  const params = useSearchParams();
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [voiding, setVoiding] = useState<SalePayment | null>(null);
  const [voidingInvoice, setVoidingInvoice] = useState(false);
  const [resending, setResending] = useState(false);
  const [downloadingStatement, setDownloadingStatement] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSale(await crmApi.getSale(saleId));
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 404
          ? "Esta venta no existe."
          : "No se pudo cargar la venta.",
      );
    }
  }, [saleId]);

  useEffect(() => {
    void load();
  }, [load]);

  // El aviso de la aceptación llega por la URL porque la pantalla anterior
  // navega hacia acá y el resultado del correo se perdía en el camino (`A5`).
  useEffect(() => {
    const outcome = params.get("confirmacion");
    if (!outcome) return;
    if (outcome === "fallida") setActionError(CONFIRMATION_NOTICE.fallida);
    else if (CONFIRMATION_NOTICE[outcome]) setNotice(CONFIRMATION_NOTICE[outcome]);
  }, [params]);

  // Solo hace falta para reasignar, que es de Gerente y Administrador.
  useEffect(() => {
    if (user?.role === "advisor") return;
    crmApi.team().then(setTeam).catch(() => undefined);
  }, [user?.role]);

  /** Envuelve una acción del encabezado con su estado de carga y su error. */
  async function run(action: () => Promise<SaleDetail>, success: string) {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      setSale(await action());
      setNotice(success);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : "No se pudo completar la acción.",
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Estado de cuenta en PDF · hallazgo `F1`.
   *
   * Antes era un enlace directo al endpoint abierto en otra pestaña. La ruta
   * exige sesión y una navegación no lleva `Authorization`, así que devolvía 401
   * en todos los entornos. Ahora se pide con el token y el blob se guarda desde
   * el mismo origen, que es lo único que hace que `download` se respete.
   */
  async function downloadStatement() {
    if (!sale) return;
    setDownloadingStatement(true);
    setActionError(null);
    try {
      const blob = await crmApi.saleStatement(sale.id);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `estado-cuenta-${sale.code}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError
          ? caught.message
          : "No se pudo descargar el estado de cuenta.",
      );
    } finally {
      setDownloadingStatement(false);
    }
  }

  if (error) {
    return (
      <div className="card" style={{ padding: 48, textAlign: "center" }}>
        <div style={{ color: "var(--red)", fontWeight: 600, marginBottom: 12 }}>{error}</div>
        <Link href="/ventas" className="btn ghost">
          Volver a ventas
        </Link>
      </div>
    );
  }

  if (!sale) {
    return (
      <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-mute)" }}>
        Cargando venta…
      </div>
    );
  }

  const active = sale.saleStatus !== "canceled";
  const hasBalance = Number(sale.balanceAmount) > 0;
  const isManager = user?.role !== "advisor";
  // Cancelar se separa del resto: exige motivo y tiene su propio diálogo. El
  // resto sale derivado de la máquina de estados, no de una tabla escrita acá.
  const advances = manualSaleTransitions(sale.saleStatus).filter(
    (status) => status !== "canceled",
  );
  const canCancel =
    manualSaleTransitions(sale.saleStatus).includes("canceled") && isManager;

  return (
    <>
      <div className="card exp-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 className="mono" style={{ margin: 0, fontSize: 22, color: "var(--navy)" }}>
              {sale.code}
            </h1>
            <span className={`chip ${SALE_STATUS_CHIP[sale.saleStatus]}`}>
              {SALE_STATUS_LABEL[sale.saleStatus]}
            </span>
            <span className="chip">{PAYMENT_STATUS_LABEL[sale.paymentStatus]}</span>
            {sale.isPaymentOverdue && <span className="chip red">Cobro atrasado</span>}
            {sale.invoiceCode && (
              <span
                className={`chip mono ${sale.documents.invoiceVoidedAt ? "red" : "green"}`}
                title={sale.documents.invoiceVoidReason ?? undefined}
              >
                {sale.invoiceCode}
                {sale.documents.invoiceVoidedAt ? " · anulada" : ""}
              </span>
            )}
          </div>

          <div className="exp-meta">
            {sale.client && (
              <span>
                <Icon name="users" />
                <Link href={`/clientes/${sale.client.id}`} style={{ color: "inherit" }}>
                  {sale.client.name}
                </Link>
              </span>
            )}
            <span>
              <Icon name="pin" />
              {sale.destination}
            </span>
            <span>
              <Icon name="doc" />
              {QUOTE_TYPE_LABEL[sale.quoteType]}
              {sale.supplierAgency ? ` · ${sale.supplierAgency.name}` : ""}
            </span>
            {sale.tripStart && sale.tripEnd && (
              <span>
                <Icon name="calendar" />
                {formatDate(sale.tripStart)} al {formatDate(sale.tripEnd)}
              </span>
            )}
          </div>

          {sale.cancelReason && (
            <div className="auth-alert error" style={{ marginTop: 12 }}>
              <Icon name="target" />
              <div>
                <b>Venta cancelada:</b> {sale.cancelReason}
              </div>
            </div>
          )}
        </div>

        <div className="actions">
          {active && hasBalance && (
            <button type="button" className="btn primary" onClick={() => setPaying(true)}>
              <Icon name="tag" />
              Registrar abono
            </button>
          )}
          {active && (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              <Icon name="edit" />
              Editar
            </button>
          )}
          {active && !sale.invoiceCode && (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() =>
                void run(
                  () => crmApi.issueInvoice(sale.id),
                  "Factura interna emitida. Queda en los documentos de la venta.",
                )
              }
            >
              <Icon name="doc" />
              Emitir factura
            </button>
          )}
          {sale.invoiceCode && !sale.documents.invoiceVoidedAt && isManager && (
            <button
              type="button"
              className="btn ghost"
              style={{ color: "var(--red)" }}
              disabled={busy}
              onClick={() => setVoidingInvoice(true)}
            >
              <Icon name="doc" />
              Anular factura
            </button>
          )}
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => setResending(true)}
          >
            <Icon name="mail" />
            Reenviar confirmación
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy || downloadingStatement}
            onClick={() => void downloadStatement()}
          >
            <Icon name="doc" />
            {downloadingStatement ? "Generando…" : "Estado de cuenta"}
          </button>
        </div>
      </div>

      {notice && (
        <div className="auth-alert info dismissable" style={{ marginTop: 14 }} role="status">
          <Icon name="check" />
          <div>{notice}</div>
          <button type="button" className="iconbtn" onClick={() => setNotice(null)} aria-label="Cerrar aviso">
            <Icon name="x" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="auth-alert error dismissable" style={{ marginTop: 14 }} role="alert">
          <Icon name="target" />
          <div>{actionError}</div>
          <button
            type="button"
            className="iconbtn"
            onClick={() => setActionError(null)}
            aria-label="Cerrar aviso"
          >
            <Icon name="x" />
          </button>
        </div>
      )}

      <div className="exp-body" style={{ marginTop: 14 }}>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <CobroCard sale={sale} />
          <AbonosCard sale={sale} canVoid={isManager} onVoid={setVoiding} />
          <DocumentosCard sale={sale} />
          <HistorialCard saleId={sale.id} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {sale.commissions && <ComisionesCard sale={sale} />}

          {(advances.length > 0 || canCancel) && (
            <div className="card">
              <div className="card-h">
                <span className="ttl">Avanzar el estado</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {advances.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="btn ghost tiny"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => crmApi.changeSaleStatus(sale.id, status),
                        `La venta pasó a ${SALE_STATUS_LABEL[status].toLowerCase()}.`,
                      )
                    }
                  >
                    {SALE_STATUS_LABEL[status]}
                  </button>
                ))}
                {canCancel && (
                  <button
                    type="button"
                    className="btn ghost tiny"
                    style={{ color: "var(--red)" }}
                    disabled={busy}
                    onClick={() => setCanceling(true)}
                  >
                    Cancelar venta
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 10, lineHeight: 1.6 }}>
                {sale.saleStatus === "reserved"
                  ? "La venta pasa a pagada sola, cuando el saldo llega a cero."
                  : "Cada avance mueve también la etapa del expediente."}
              </div>
            </div>
          )}

          {sale.quote && (
            <div className="card">
              <div className="card-h">
                <span className="ttl">Origen</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                Nace de la cotización{" "}
                <Link href={`/cotizaciones/${sale.quote.id}`} className="mono">
                  {sale.quote.name}
                </Link>
                . El precio y las comisiones quedaron congelados en la versión aceptada.
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-h">
              <span className="ttl">Registro</span>
              {isManager && active && (
                <button
                  type="button"
                  className="btn ghost tiny"
                  disabled={busy}
                  onClick={() => setReassigning(true)}
                >
                  Reasignar
                </button>
              )}
            </div>
            <div className="kv-grid">
              <div>
                <span className="k">Asesor</span>
                <span className="v">{sale.advisor?.name ?? "—"}</span>
              </div>
              <div>
                <span className="k">Creada</span>
                <RelativeTime className="v" iso={sale.createdAt} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {paying && (
        <RegistrarPagoModal
          sale={sale}
          onClose={() => setPaying(false)}
          onRegistered={(updated, warning) => {
            setPaying(false);
            setSale(updated);
            const registered =
              Number(updated.balanceAmount) <= 0
                ? "Abono registrado. La venta quedó pagada por completo."
                : `Abono registrado. Saldo pendiente: ${formatAmount(updated.balanceAmount)}.`;
            // El comprobante no bloquea el cobro (`C2`), pero que su carga haya
            // fallado no puede quedar en silencio: sin aviso, el asesor cree que
            // el archivo está adjunto.
            if (warning) {
              setNotice(null);
              setActionError(`${registered} ${warning}`);
            } else {
              setActionError(null);
              setNotice(registered);
            }
          }}
        />
      )}

      {editing && (
        <EditarVentaModal
          sale={sale}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            setSale(updated);
            setActionError(null);
            setNotice("Los datos de la venta quedaron corregidos.");
          }}
        />
      )}

      {reassigning && (
        <ReasignarVentaModal
          sale={sale}
          team={team}
          onClose={() => setReassigning(false)}
          onReassigned={(updated) => {
            setReassigning(false);
            setSale(updated);
            setActionError(null);
            setNotice(`La venta pasó a ${updated.advisor?.name ?? "otro asesor"}.`);
          }}
        />
      )}

      {resending && (
        <ReenviarConfirmacionModal
          sale={sale}
          onClose={() => setResending(false)}
          onSent={(result) => {
            setResending(false);
            setSale(result.sale);
            setActionError(null);
            setNotice(
              result.confirmation.simulated
                ? `Envío simulado a ${result.confirmation.recipients.join(", ")}: el CRM está en modo de prueba de correo, así que no salió nada hacia el cliente.`
                : `Confirmación enviada a ${result.confirmation.recipients.join(", ")}.`,
            );
          }}
        />
      )}

      {voidingInvoice && (
        <AnularFacturaModal
          sale={sale}
          onClose={() => setVoidingInvoice(false)}
          onVoided={(updated) => {
            setVoidingInvoice(false);
            setSale(updated);
            setActionError(null);
            setNotice(
              `La factura ${updated.invoiceCode} quedó anulada. Su PDF ya lleva el sello.`,
            );
          }}
        />
      )}

      {voiding && (
        <AnularAbonoModal
          sale={sale}
          payment={voiding}
          onClose={() => setVoiding(null)}
          onVoided={(updated) => {
            setVoiding(null);
            setSale(updated);
            setActionError(null);
            setNotice(
              `Abono anulado. Saldo pendiente: ${formatAmount(updated.balanceAmount)}.`,
            );
          }}
        />
      )}

      {canceling && (
        <CancelarVentaModal
          sale={sale}
          onClose={() => setCanceling(false)}
          onCanceled={(updated) => {
            setCanceling(false);
            setSale(updated);
            setNotice("La venta quedó cancelada.");
          }}
        />
      )}
    </>
  );
}

/* ─────────────────── Seguimiento de cobro · HU-VEN-05 ─────────────────────── */

function CobroCard({ sale }: { sale: SaleDetail }) {
  const percentage = paidPercentage(sale.paidAmount, sale.finalPrice);
  const settled = percentage >= 100;

  return (
    <div className="card">
      <div className="card-h">
        <span className="ttl">Seguimiento de cobro</span>
        <span className="chip">{PAYMENT_STATUS_LABEL[sale.paymentStatus]}</span>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <span className="k" style={kLabelStyle}>
            Precio total
          </span>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)" }}>
            {formatAmount(sale.finalPrice)}
          </div>
        </div>
        <div>
          <span className="k" style={kLabelStyle}>
            Abonado
          </span>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--green)" }}>
            {formatAmount(sale.paidAmount)}
          </div>
        </div>
        <div>
          <span className="k" style={kLabelStyle}>
            Saldo
          </span>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: settled ? "var(--text-faint)" : "var(--orange-deep)",
            }}
          >
            {formatAmount(sale.balanceAmount)}
          </div>
        </div>
      </div>

      <div
        style={{ background: "var(--border-soft)", height: 10, borderRadius: 5, overflow: "hidden" }}
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Cobrado ${percentage} %`}
      >
        <div
          style={{
            background: settled ? "var(--green)" : "var(--orange)",
            height: "100%",
            width: `${percentage}%`,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          fontSize: 12,
          color: "var(--text-mute)",
        }}
      >
        <span>{percentage} % cobrado</span>
        {sale.paymentDueDate && (
          <span style={{ color: sale.isPaymentOverdue ? "var(--red)" : "inherit" }}>
            {sale.isPaymentOverdue ? "Venció el " : "Fecha límite: "}
            {formatDate(sale.paymentDueDate)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ───────────────────── Historial de abonos · DM-07 ────────────────────────── */

function AbonosCard({
  sale,
  canVoid,
  onVoid,
}: {
  sale: SaleDetail;
  /** Anular mueve el registro de dinero: Gerente y Administrador (DM-15). */
  canVoid: boolean;
  onVoid: (payment: SalePayment) => void;
}) {
  // El contador cuenta los VIGENTES: son los que suman al cobro. Los anulados
  // siguen en la tabla como constancia, con su motivo (DM-15).
  const voided = sale.payments.filter((payment) => payment.voidedAt).length;

  return (
    <div className="card">
      <div className="card-h">
        <span className="ttl">Abonos</span>
        <span className="chip">{sale.payments.length - voided}</span>
        {voided > 0 && (
          <span className="chip red">
            {voided} {voided === 1 ? "anulado" : "anulados"}
          </span>
        )}
      </div>

      {sale.payments.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
          Todavía no se registró ningún pago.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="t" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Comprobante</th>
                <th>Concepto</th>
                <th style={{ textAlign: "right" }}>Monto</th>
                <th>Fecha</th>
                <th>Registró</th>
                <th>Documentos</th>
                {canVoid && <th />}
              </tr>
            </thead>
            <tbody>
              {sale.payments.map((payment) => (
                <tr key={payment.id} style={payment.voidedAt ? voidedRowStyle : undefined}>
                  <td>
                    <span className="mono">{payment.receiptCode}</span>
                    {payment.voidedAt && (
                      <span className="chip red" style={{ marginLeft: 6 }}>
                        Anulado
                      </span>
                    )}
                  </td>
                  <td>
                    {PAYMENT_KIND_LABEL[payment.kind]}
                    {payment.method && (
                      <div style={{ color: "var(--text-mute)", fontSize: 11 }}>
                        {payment.method.name}
                      </div>
                    )}
                    {payment.notes && (
                      <div style={{ color: "var(--text-mute)", fontSize: 11 }}>
                        {payment.notes}
                      </div>
                    )}
                    {payment.voidReason && (
                      <div style={{ color: "var(--red)", fontSize: 11 }}>
                        Anulado por {payment.voidedBy?.name ?? "—"}: {payment.voidReason}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <b
                      className="num"
                      style={
                        payment.voidedAt ? { textDecoration: "line-through" } : undefined
                      }
                    >
                      {formatAmount(payment.amount)}
                    </b>
                  </td>
                  <td>{formatDate(payment.paidAt)}</td>
                  <td>{payment.createdBy?.name ?? "—"}</td>
                  <td>
                    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {payment.receiptPdfFileId && (
                        <SignedFileLink
                          fileId={payment.receiptPdfFileId}
                          label="Comprobante"
                          fileName={`${payment.receiptCode}.pdf`}
                        />
                      )}
                      {payment.receiptFileId && (
                        <SignedFileLink
                          fileId={payment.receiptFileId}
                          label="Adjunto"
                          fileName={`${payment.receiptCode}-adjunto`}
                        />
                      )}
                      {!payment.receiptPdfFileId && !payment.receiptFileId && "—"}
                    </span>
                  </td>
                  {canVoid && (
                    <td style={{ textAlign: "right" }}>
                      {payment.voidedAt ? (
                        <span style={{ color: "var(--text-faint)", fontSize: 11 }}>—</span>
                      ) : (
                        <button
                          type="button"
                          className="btn ghost tiny"
                          style={{ color: "var(--red)" }}
                          onClick={() => onVoid(payment)}
                        >
                          Anular
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─────────────── Documentos de la venta · Documentos · pantalla 3 ─────────── */

function DocumentosCard({ sale }: { sale: SaleDetail }) {
  const rows = [
    sale.documents.quotePdfFileId && {
      key: "quote",
      label: "Cotización de origen",
      detail: sale.quote?.name ?? "PDF enviado al cliente",
      fileId: sale.documents.quotePdfFileId,
      fileName: `${sale.quote?.name ?? "cotizacion"}.pdf`,
    },
    sale.documents.invoiceFileId && {
      key: "invoice",
      label: sale.documents.invoiceVoidedAt
        ? "Factura interna · ANULADA"
        : "Factura interna",
      detail: sale.documents.invoiceVoidedAt
        ? `${sale.documents.invoiceCode} · anulada el ${formatDate(sale.documents.invoiceVoidedAt)}: ${sale.documents.invoiceVoidReason ?? "sin motivo"}`
        : `${sale.documents.invoiceCode} · emitida el ${formatDate(sale.documents.invoiceIssuedAt)}`,
      fileId: sale.documents.invoiceFileId,
      fileName: `${sale.documents.invoiceCode}.pdf`,
    },
  ].filter(Boolean) as {
    key: string;
    label: string;
    detail: string;
    fileId: string;
    fileName: string;
  }[];

  return (
    <div className="card">
      <div className="card-h">
        <span className="ttl">Documentos</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-mute)", lineHeight: 1.7 }}>
          Sin documentos todavía. La factura interna se emite desde el botón del
          encabezado; los comprobantes salen solos con cada abono.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row) => (
            <div
              key={row.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
              }}
            >
              <Icon name="doc" style={{ color: "var(--orange)", flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{row.label}</div>
                <div style={{ fontSize: 11, color: "var(--text-mute)" }}>{row.detail}</div>
              </div>
              <SignedFileLink fileId={row.fileId} label="Abrir" fileName={row.fileName} />
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 12, lineHeight: 1.6 }}>
        La factura es un documento de control interno: no es un DTE ni pasa por el
        Ministerio de Hacienda.
      </div>
    </div>
  );
}

/* ───────────────────── Historial de la venta · `G5` ───────────────────────── */

/**
 * Qué dice cada acción, en el idioma del negocio.
 *
 * El backend guarda códigos técnicos y son inmutables (son el contrato con la
 * auditoría ya registrada); la traducción vive acá.
 */
const ACTION_LABEL: Record<string, string> = {
  created: "Registró la venta",
  updated: "Actualizó los datos",
  status_changed: "Cambió el estado",
  payment_registered: "Registró un abono",
  payment_voided: "Anuló un abono",
  assigned: "Reasignó el asesor",
};

/** Los campos que aparecen en `changes`, en español. */
const FIELD_LABEL: Record<string, string> = {
  code: "código",
  finalPrice: "precio",
  origin: "origen",
  status: "estado",
  reason: "motivo",
  receipt: "comprobante",
  amount: "monto",
  paymentStatus: "cobro",
  balance: "saldo",
  invoice: "factura",
  invoiceVoided: "factura anulada",
  confirmation: "confirmación",
  advisor: "asesor",
  destination: "destino",
  tripStart: "salida",
  tripEnd: "regreso",
  paymentDueDate: "fecha límite",
};

function HistorialCard({ saleId }: { saleId: string }) {
  const [events, setEvents] = useState<SaleActivity[] | null>(null);

  useEffect(() => {
    crmApi.saleActivity(saleId).then(setEvents).catch(() => setEvents([]));
  }, [saleId]);

  return (
    <div className="card">
      <div className="card-h">
        <span className="ttl">Historial</span>
        {events && <span className="chip">{events.length}</span>}
      </div>

      {events === null ? (
        <div style={{ fontSize: 13, color: "var(--text-mute)" }}>Cargando…</div>
      ) : events.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
          Sin movimientos registrados.
        </div>
      ) : (
        <ol className="timeline">
          {events.map((event) => (
            <li key={event.id}>
              <div className="timeline-head">
                <b>{ACTION_LABEL[event.action] ?? event.action}</b>
                <RelativeTime className="timeline-when" iso={event.occurredAt} />
              </div>
              <div className="timeline-actor">{event.actor}</div>
              {event.changes && (
                <div className="timeline-changes">
                  {Object.entries(event.changes).map(([field, change]) => (
                    <span key={field}>
                      {FIELD_LABEL[field] ?? field}:{" "}
                      {change.from !== null && change.from !== undefined && (
                        <s>{String(change.from)}</s>
                      )}{" "}
                      {change.to !== null && change.to !== undefined ? (
                        <b>{String(change.to)}</b>
                      ) : (
                        "—"
                      )}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ─────────────────────── Zona interna · regla 8.2 ─────────────────────────── */

function ComisionesCard({ sale }: { sale: SaleDetail }) {
  // El componente solo se monta con comisiones visibles (DM-19); el resguardo
  // evita que un cambio futuro en el llamador lo rompa en silencio.
  if (!sale.commissions) return null;

  return (
    <div className="card">
      <div className="card-h">
        <span className="ttl">Comisiones</span>
        <span className="chip">
          <Icon name="lock" width={11} height={11} />
          Interno
        </span>
      </div>

      <div className="kv-grid">
        <div>
          <span className="k">Gestión</span>
          <span className="v">{formatMoney(sale.commissions.managementAmount)}</span>
        </div>
        {Number(sale.commissions.agencyAmount) > 0 && (
          <div>
            <span className="k">Agencia</span>
            <span className="v">{formatMoney(sale.commissions.agencyAmount)}</span>
          </div>
        )}
        <div>
          <span className="k">Utilidad total</span>
          <span className="v" style={{ fontWeight: 700, color: "var(--green)" }}>
            {formatMoney(sale.commissions.totalUtility)}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 12, lineHeight: 1.6 }}>
        Congeladas al cerrar la venta. No aparecen en la factura, el comprobante ni el
        correo del cliente.
      </div>
    </div>
  );
}

/** Un asiento anulado se conserva a la vista, atenuado y con su motivo. */
const voidedRowStyle = { opacity: 0.55 } as const;

const kLabelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-faint)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
} as const;
