"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { ClientPicker } from "@/components/ClientPicker";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/AuthProvider";
import {
  crmApi,
  type ClientSummary,
  type ConfirmationResult,
  type SaleDetail,
  type Supplier,
  type TeamMember,
} from "@/lib/api/crm";
import { commissionAmount, fromCents, isValidAmount, toCents } from "@/lib/domain/money";
import {
  COMMISSION_MODE_LABEL,
  COMMISSION_MODES,
  QUOTE_TYPE_LABEL,
  QUOTE_TYPES,
  type CommissionMode,
  type QuoteType,
} from "@/lib/domain/enums";
import { DialogTitle, todayLocal } from "@/components/DialogTitle";

/*
 * Vive en `components/` y no en `app/(app)/ventas/` · `D3`.
 *
 * Lo abren dos pantallas: el listado de Ventas y el expediente del cliente. Con
 * el archivo dentro de la carpeta de una ruta, la otra tenía que subir dos
 * niveles (`../../ventas/modals`) para alcanzarlo, y ese import cruzado ataba
 * dos módulos que no se conocen entre sí.
 */

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
          <div className="field-hint is-error">
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
          <div className="field-hint is-error">
            <Icon name="target" width={12} height={12} />
            La fecha límite de pago ya pasó.
          </div>
        )}
        {!dueInPast && dueAfterTrip && (
          <div className="field-hint">
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
            <div className="field-hint is-error">
              <Icon name="target" width={12} height={12} />
              La comisión de agencia tiene que ser un número como 12 o 350.00. Corregila o
              dejá el campo vacío: escrita así no se guardaría.
            </div>
          )}
          {percentageOverflow && (
            <div className="field-hint is-error">
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
            <div className="field-hint is-error">
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
          <div className="field-hint">
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
