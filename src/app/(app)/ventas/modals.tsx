"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
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

/**
 * Hoy, en la zona del usuario · hallazgo `E2`.
 *
 * `toISOString()` da la fecha en UTC: después de las 18:00 en El Salvador ya
 * devuelve el día siguiente, y el abono nacía con un comprobante fechado
 * mañana. El backend ahora lo rechaza, así que el valor por defecto tenía que
 * dejar de producirlo.
 */
function localDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

const todayLocal = localDate(new Date());

/** Título con icono, para el `Modal` compartido que solo recibe un nodo. */
function DialogTitle({ icon, children }: { icon: "cart" | "tag" | "target"; children: React.ReactNode }) {
  return (
    <>
      <Icon name={icon} style={{ color: "var(--orange)" }} />
      {children}
    </>
  );
}

/* ─────────────────── Venta directa · HU-VEN-03 ────────────────────────────── */

type VentaDraft = {
  clientId: string;
  advisorId: string;
  quoteType: QuoteType;
  supplierAgencyId: string;
  destination: string;
  tripStart: string;
  tripEnd: string;
  finalPrice: string;
  managementMode: CommissionMode;
  managementValue: string;
  agencyMode: CommissionMode;
  agencyValue: string;
  paymentDueDate: string;
};

const EMPTY_DRAFT: VentaDraft = {
  clientId: "",
  advisorId: "",
  quoteType: "own_package",
  supplierAgencyId: "",
  destination: "",
  tripStart: "",
  tripEnd: "",
  finalPrice: "",
  managementMode: "percentage",
  managementValue: "10",
  agencyMode: "percentage",
  agencyValue: "",
  paymentDueDate: "",
};

/**
 * Registrar una venta sin cotización previa · HU-VEN-03.
 *
 * Pide lo mismo que una cotización aceptada necesita para existir: cliente,
 * viaje, precio y comisiones. Las comisiones quedan congeladas en la venta, así
 * que se calculan una vez y no vuelven a moverse — razón de más para que el
 * asesor vea la utilidad ANTES de guardar (`E4`).
 */
export function NuevaVentaModal({
  team,
  clientId,
  onClose,
  onCreated,
}: {
  team: TeamMember[];
  /** Precargado cuando se registra desde el expediente. */
  clientId?: string;
  onClose: () => void;
  onCreated: (sale: SaleDetail, confirmation: ConfirmationResult) => void;
}) {
  const { user } = useSession();
  const [draft, setDraft] = useState<VentaDraft>({ ...EMPTY_DRAFT, clientId: clientId ?? "" });
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    crmApi
      .listSuppliers({ status: "active", pageSize: 200 })
      .then((page) => setSuppliers(page.items))
      .catch(() => setError("No se pudieron cargar los proveedores."));
  }, []);

  // Al abrirse desde el expediente el cliente viene fijo, pero hay que poder
  // mostrar su nombre: el buscador solo conoce lo que el usuario escribió.
  useEffect(() => {
    if (!clientId) return;
    crmApi.getClient(clientId).then(setClient).catch(() => undefined);
  }, [clientId]);

  function set<K extends keyof VentaDraft>(key: K, value: VentaDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const agencies = suppliers.filter((supplier) => supplier.type === "agency");
  const needsAgency = draft.quoteType === "supplier_package";

  /**
   * Utilidad calculada en vivo · hallazgo `E4`.
   *
   * Se elegían modo y valor de dos comisiones y se guardaba a ciegas: el error
   * "la utilidad no puede superar el precio final" llegaba del servidor después
   * de rellenar el formulario entero. Usa la misma aritmética en centavos que el
   * backend, así que lo que se ve coincide al centavo con lo que se guarda.
   */
  const utility = useMemo(() => {
    if (!isValidAmount(draft.finalPrice)) return null;

    const priceCents = toCents(draft.finalPrice);
    const management = isValidAmount(draft.managementValue)
      ? toCents(commissionAmount(draft.finalPrice, {
          mode: draft.managementMode,
          value: draft.managementValue,
        }))
      : 0n;
    const agency =
      needsAgency && isValidAmount(draft.agencyValue)
        ? toCents(commissionAmount(draft.finalPrice, {
            mode: draft.agencyMode,
            value: draft.agencyValue,
          }))
        : 0n;

    const total = management + agency;
    return {
      management: fromCents(management),
      agency: fromCents(agency),
      total: fromCents(total),
      exceedsPrice: total > priceCents,
    };
  }, [
    draft.finalPrice,
    draft.managementMode,
    draft.managementValue,
    draft.agencyMode,
    draft.agencyValue,
    needsAgency,
  ]);

  /**
   * Una comisión escrita mal se AVISA, no se descarta · hallazgo `C3`.
   *
   * Antes la de agencia solo viajaba si el patrón validaba: escribir "12%" o
   * "1,200" la dejaba caer sin un solo aviso, y la venta nacía con utilidad de
   * agencia en cero — congelada para siempre.
   */
  const agencyTyped = draft.agencyValue.trim() !== "";
  const agencyMalformed = needsAgency && agencyTyped && !isValidAmount(draft.agencyValue);
  const percentageOverflow =
    (draft.managementMode === "percentage" &&
      isValidAmount(draft.managementValue) &&
      Number(draft.managementValue) > 100) ||
    (needsAgency &&
      draft.agencyMode === "percentage" &&
      isValidAmount(draft.agencyValue) &&
      Number(draft.agencyValue) > 100);

  // `E5` · las fechas se comprueban acá, no después de un viaje al servidor.
  const tripBackwards =
    draft.tripStart !== "" && draft.tripEnd !== "" && draft.tripEnd < draft.tripStart;
  const dueAfterTrip =
    draft.paymentDueDate !== "" &&
    draft.tripStart !== "" &&
    draft.paymentDueDate > draft.tripStart;
  const dueInPast = draft.paymentDueDate !== "" && draft.paymentDueDate < todayLocal;

  const missing: string[] = [];
  if (!draft.clientId) missing.push("el cliente");
  if (draft.destination.trim().length < 2) missing.push("el destino");
  if (!isValidAmount(draft.finalPrice)) missing.push("el precio final");
  if (!isValidAmount(draft.managementValue)) missing.push("la comisión de gestión");
  if (needsAgency && !draft.supplierAgencyId) missing.push("la agencia proveedora");

  const blocked =
    missing.length > 0 ||
    agencyMalformed ||
    percentageOverflow ||
    tripBackwards ||
    dueInPast ||
    Boolean(utility?.exceedsPrice);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await crmApi.createSale({
        clientId: draft.clientId,
        advisorId: draft.advisorId || undefined,
        quoteType: draft.quoteType,
        supplierAgencyId: needsAgency ? draft.supplierAgencyId : undefined,
        destination: draft.destination.trim(),
        tripStart: draft.tripStart || undefined,
        tripEnd: draft.tripEnd || undefined,
        finalPrice: draft.finalPrice.trim(),
        managementCommission: {
          mode: draft.managementMode,
          value: draft.managementValue.trim(),
        },
        agencyCommission:
          needsAgency && agencyTyped
            ? { mode: draft.agencyMode, value: draft.agencyValue.trim() }
            : undefined,
        paymentDueDate: draft.paymentDueDate || undefined,
      });
      onCreated(result.sale, result.confirmation);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo registrar la venta.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal title={<DialogTitle icon="cart">Registrar venta directa</DialogTitle>} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p className="modal-lead">
          Para una venta cerrada sin cotización de por medio. El expediente pasa a{" "}
          <b>Reserva / anticipo</b> y se envía la confirmación al cliente.
        </p>

        {error && (
          <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        <span className="label">Cliente</span>
        <ClientPicker
          value={draft.clientId}
          selected={client}
          disabled={submitting}
          locked={Boolean(clientId)}
          onSelect={(picked) => {
            setClient(picked);
            set("clientId", picked?.id ?? "");
          }}
        />

        <div className="modal-grid" style={{ marginTop: 14 }}>
          <div>
            <label className="label" htmlFor="saleType">
              Tipo
            </label>
            <select
              id="saleType"
              className="input"
              value={draft.quoteType}
              onChange={(e) => set("quoteType", e.target.value as QuoteType)}
              disabled={submitting}
            >
              {QUOTE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {QUOTE_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="saleDestination">
              Destino
            </label>
            <input
              id="saleDestination"
              className="input"
              value={draft.destination}
              onChange={(e) => set("destination", e.target.value)}
              placeholder="Cancún"
              disabled={submitting}
              required
            />
          </div>
        </div>

        {needsAgency && (
          <>
            <label className="label" htmlFor="saleAgency" style={{ marginTop: 14 }}>
              Agencia proveedora
            </label>
            <select
              id="saleAgency"
              className="input"
              value={draft.supplierAgencyId}
              onChange={(e) => set("supplierAgencyId", e.target.value)}
              disabled={submitting}
              required
            >
              <option value="">Elegí una agencia…</option>
              {agencies.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </>
        )}

        <div className="modal-grid" style={{ marginTop: 14 }}>
          <div>
            <label className="label" htmlFor="saleTripStart">
              Salida
            </label>
            <input
              id="saleTripStart"
              type="date"
              className="input"
              value={draft.tripStart}
              onChange={(e) => set("tripStart", e.target.value)}
              disabled={submitting}
            />
          </div>
          <div>
            <label className="label" htmlFor="saleTripEnd">
              Regreso
            </label>
            <input
              id="saleTripEnd"
              type="date"
              className="input"
              min={draft.tripStart || undefined}
              value={draft.tripEnd}
              onChange={(e) => set("tripEnd", e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        {tripBackwards && (
          <div style={{ ...hintStyle, color: "var(--red)" }}>
            <Icon name="target" width={12} height={12} />
            El regreso no puede ser anterior a la salida.
          </div>
        )}

        <div className="modal-grid" style={{ marginTop: 14 }}>
          <div>
            <label className="label" htmlFor="salePrice">
              Precio final (USD)
            </label>
            <input
              id="salePrice"
              className="input"
              inputMode="decimal"
              value={draft.finalPrice}
              onChange={(e) => set("finalPrice", e.target.value)}
              placeholder="1800.00"
              disabled={submitting}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="saleDue">
              Fecha límite de pago
            </label>
            <input
              id="saleDue"
              type="date"
              className="input"
              min={todayLocal}
              value={draft.paymentDueDate}
              onChange={(e) => set("paymentDueDate", e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        {dueInPast && (
          <div style={{ ...hintStyle, color: "var(--red)" }}>
            <Icon name="target" width={12} height={12} />
            La fecha límite de pago ya pasó.
          </div>
        )}
        {!dueInPast && dueAfterTrip && (
          <div style={hintStyle}>
            <Icon name="target" width={12} height={12} />
            El plazo de pago vence después de la salida del viaje. Se puede guardar, pero
            revisá que sea lo acordado.
          </div>
        )}

        <div
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: "1px solid var(--border-soft)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Icon name="lock" width={12} height={12} style={{ color: "var(--text-faint)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-mute)" }}>
              Zona interna · no sale en la factura ni en el correo
            </span>
          </div>

          <div className="modal-grid">
            <div>
              <label className="label" htmlFor="saleMgmtMode">
                Comisión de gestión
              </label>
              <select
                id="saleMgmtMode"
                className="input"
                value={draft.managementMode}
                onChange={(e) => set("managementMode", e.target.value as CommissionMode)}
                disabled={submitting}
              >
                {COMMISSION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {COMMISSION_MODE_LABEL[mode]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="saleMgmtValue">
                {draft.managementMode === "percentage" ? "Porcentaje" : "Monto (USD)"}
              </label>
              <input
                id="saleMgmtValue"
                className="input"
                inputMode="decimal"
                value={draft.managementValue}
                onChange={(e) => set("managementValue", e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          {needsAgency && (
            <div className="modal-grid" style={{ marginTop: 14 }}>
              <div>
                <label className="label" htmlFor="saleAgencyMode">
                  Comisión de agencia
                </label>
                <select
                  id="saleAgencyMode"
                  className="input"
                  value={draft.agencyMode}
                  onChange={(e) => set("agencyMode", e.target.value as CommissionMode)}
                  disabled={submitting}
                >
                  {COMMISSION_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {COMMISSION_MODE_LABEL[mode]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="saleAgencyValue">
                  {draft.agencyMode === "percentage" ? "Porcentaje" : "Monto (USD)"}
                </label>
                <input
                  id="saleAgencyValue"
                  className="input"
                  inputMode="decimal"
                  value={draft.agencyValue}
                  onChange={(e) => set("agencyValue", e.target.value)}
                  placeholder="Opcional"
                  disabled={submitting}
                />
              </div>
            </div>
          )}

          {agencyMalformed && (
            <div style={{ ...hintStyle, color: "var(--red)" }}>
              <Icon name="target" width={12} height={12} />
              La comisión de agencia tiene que ser un número como 12 o 350.00. Corregila o
              dejá el campo vacío: escrita así no se guardaría.
            </div>
          )}
          {percentageOverflow && (
            <div style={{ ...hintStyle, color: "var(--red)" }}>
              <Icon name="target" width={12} height={12} />
              Una comisión en porcentaje no puede superar el 100 %.
            </div>
          )}

          {/* `E4` · lo que se va a congelar, a la vista antes de guardar. */}
          {utility && (
            <div className="utility-preview">
              <div>
                <span className="k">Gestión</span>
                <span className="v num">${utility.management}</span>
              </div>
              {needsAgency && (
                <div>
                  <span className="k">Agencia</span>
                  <span className="v num">${utility.agency}</span>
                </div>
              )}
              <div>
                <span className="k">Utilidad total</span>
                <span
                  className="v num"
                  style={{
                    fontWeight: 700,
                    color: utility.exceedsPrice ? "var(--red)" : "var(--green)",
                  }}
                >
                  ${utility.total}
                </span>
              </div>
            </div>
          )}
          {utility?.exceedsPrice && (
            <div style={{ ...hintStyle, color: "var(--red)" }}>
              <Icon name="target" width={12} height={12} />
              La utilidad supera el precio final: revisá las comisiones.
            </div>
          )}
        </div>

        {/* Un Asesor vende siempre a su nombre; el backend lo vuelve a validar. */}
        {user?.role !== "advisor" && (
          <>
            <label className="label" htmlFor="saleAdvisor" style={{ marginTop: 14 }}>
              Asesor responsable
            </label>
            <select
              id="saleAdvisor"
              className="input"
              value={draft.advisorId}
              onChange={(e) => set("advisorId", e.target.value)}
              disabled={submitting}
            >
              <option value="">Yo mismo</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName}
                </option>
              ))}
            </select>
          </>
        )}

        {missing.length > 0 && (
          <div style={hintStyle}>
            <Icon name="target" width={12} height={12} />
            Falta {missing.join(", ")}.
          </div>
        )}

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={submitting || blocked}>
            {submitting ? "Registrando…" : "Registrar venta"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

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
              <div style={hintStyle}>Sugerido según el monto. Podés cambiarlo.</div>
            )}
          </div>
        </div>

        {exceedsBalance && (
          <div style={{ ...hintStyle, color: "var(--red)" }}>
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
        <div style={hintStyle}>
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
          <div style={{ ...hintStyle, color: "var(--red)" }}>
            <Icon name="target" width={12} height={12} />
            El archivo pesa {(receipt!.size / 1024 / 1024).toFixed(1)} MB y el máximo es 10 MB.
          </div>
        ) : fileWrongType ? (
          <div style={{ ...hintStyle, color: "var(--red)" }}>
            <Icon name="target" width={12} height={12} />
            Solo se aceptan PDF, JPG y PNG.
          </div>
        ) : (
          <div style={hintStyle}>
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
            <b className="num">${balanceAfter}</b>.
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
          <div style={{ ...hintStyle, color: "var(--red)" }}>
            <Icon name="target" width={12} height={12} />
            No parece un correo: {malformed.join(", ")}.
          </div>
        ) : (
          <div style={hintStyle}>
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
          <div style={{ ...hintStyle, color: "var(--red)" }}>
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
        <div style={hintStyle}>
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

const hintStyle = {
  fontSize: 12,
  color: "var(--text-mute)",
  marginTop: 8,
  display: "flex",
  gap: 6,
  alignItems: "center",
} as const;
