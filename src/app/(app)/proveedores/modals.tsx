"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { ApiError } from "@/lib/api/client";
import {
  crmApi,
  type Supplier,
  type SupplierInput,
  type SupplierUsage,
} from "@/lib/api/crm";
import {
  COMMISSION_MODES,
  COMMISSION_MODE_LABEL,
  SERVICE_TYPES,
  SERVICE_TYPE_LABEL,
  SUPPLIER_TYPES,
  SUPPLIER_TYPE_LABEL,
  type CommissionMode,
  type ServiceType,
  type SupplierType,
} from "@/lib/domain/enums";

/* ─────────────────────────────── Envoltorio ───────────────────────────────── */

function Modal({
  title,
  onClose,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** "a, b , c" → ["a", "b", "c"] sin vacíos ni repetidos. */
function splitList(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

const DECIMAL_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/* ─────────────────── Alta y edición · HU-PRO-01 y HU-PRO-02 ───────────────── */

export function SupplierFormModal({
  supplier,
  onClose,
  onSaved,
}: {
  /** Sin proveedor es un alta; con proveedor, una edición. */
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: (saved: Supplier) => void;
}) {
  const editing = supplier !== null;

  const [name, setName] = useState(supplier?.name ?? "");
  const [type, setType] = useState<SupplierType>(supplier?.type ?? "agency");
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>(
    supplier?.serviceTypes ?? [],
  );
  const [phones, setPhones] = useState(supplier?.contacts.phones.join(", ") ?? "");
  const [emails, setEmails] = useState(supplier?.contacts.emails.join(", ") ?? "");
  const [whatsapp, setWhatsapp] = useState(supplier?.contacts.whatsapp ?? "");
  const [website, setWebsite] = useState(supplier?.contacts.website ?? "");
  const [commissionMode, setCommissionMode] = useState<CommissionMode | "">(
    supplier?.defaultCommission?.mode ?? "",
  );
  const [commissionValue, setCommissionValue] = useState(
    supplier?.defaultCommission?.value ?? "",
  );
  const [internalNotes, setInternalNotes] = useState(supplier?.internalNotes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Espejo de las reglas del backend, para no gastar un viaje en un error
  // evitable. El servidor las vuelve a comprobar igual.
  const needsServiceTypes = type === "tourism_service" && serviceTypes.length === 0;
  const badCommission =
    commissionMode !== "" &&
    (!DECIMAL_PATTERN.test(commissionValue.trim()) ||
      (commissionMode === "percentage" && Number(commissionValue) > 100));

  function toggleService(service: ServiceType) {
    setServiceTypes((prev) =>
      prev.includes(service) ? prev.filter((s) => s !== service) : [...prev, service],
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const payload: SupplierInput = {
      name: name.trim(),
      type,
      serviceTypes: type === "tourism_service" ? serviceTypes : [],
      contacts: {
        phones: splitList(phones),
        emails: splitList(emails),
        whatsapp: whatsapp.trim() || undefined,
        website: website.trim() || undefined,
      },
      defaultCommission:
        commissionMode === ""
          ? null
          : { mode: commissionMode, value: commissionValue.trim() },
      internalNotes: internalNotes.trim() || undefined,
    };

    try {
      onSaved(
        editing
          ? await crmApi.updateSupplier(supplier.id, {
              // El tipo es inmutable: no viaja en la edición.
              name: payload.name,
              serviceTypes: payload.serviceTypes,
              contacts: payload.contacts,
              defaultCommission: payload.defaultCommission,
              internalNotes: payload.internalNotes,
            })
          : await crmApi.createSupplier(payload),
      );
    } catch (caught) {
      // El backend explica los duplicados nombrando al proveedor existente.
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo guardar el proveedor.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={
        <>
          <Icon name={editing ? "edit" : "plus"} style={{ color: "var(--orange)" }} />
          {editing ? "Editar proveedor" : "Nuevo proveedor"}
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

        <div className="modal-grid">
          <div>
            <label className="label" htmlFor="supplierName">
              Nombre *
            </label>
            <input
              id="supplierName"
              className="input"
              required
              minLength={3}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mayorista Caribe"
              disabled={submitting}
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="supplierType">
              Tipo
            </label>
            <select
              id="supplierType"
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as SupplierType)}
              disabled={submitting || editing}
            >
              {SUPPLIER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SUPPLIER_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            {editing && (
              <div style={hintStyle}>
                <Icon name="lock" width={12} height={12} />
                El tipo no se cambia: las cotizaciones viejas dejarían de cuadrar.
              </div>
            )}
          </div>
        </div>

        {type === "tourism_service" && (
          <div style={{ marginTop: 14 }}>
            <span className="label">Servicios que provee *</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {SERVICE_TYPES.map((service) => (
                <button
                  key={service}
                  type="button"
                  className="tagpick"
                  aria-pressed={serviceTypes.includes(service)}
                  onClick={() => toggleService(service)}
                  disabled={submitting}
                >
                  {serviceTypes.includes(service) && <Icon name="check" />}
                  {SERVICE_TYPE_LABEL[service]}
                </button>
              ))}
            </div>
            {needsServiceTypes && (
              <div style={hintStyle}>
                <Icon name="target" width={12} height={12} />
                Elegí al menos uno: es lo que permite encontrarlo al armar un paquete.
              </div>
            )}
          </div>
        )}

        <div className="modal-grid" style={{ marginTop: 14 }}>
          <div>
            <label className="label" htmlFor="supplierEmails">
              Correos
            </label>
            <input
              id="supplierEmails"
              className="input"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="ventas@proveedor.com, reservas@proveedor.com"
              disabled={submitting}
            />
          </div>
          <div>
            <label className="label" htmlFor="supplierPhones">
              Teléfonos
            </label>
            <input
              id="supplierPhones"
              className="input"
              value={phones}
              onChange={(e) => setPhones(e.target.value)}
              placeholder="+503 2222 3333"
              disabled={submitting}
            />
          </div>
        </div>

        <div className="modal-grid" style={{ marginTop: 14 }}>
          <div>
            <label className="label" htmlFor="supplierWhatsapp">
              WhatsApp
            </label>
            <input
              id="supplierWhatsapp"
              className="input"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+503 7000 0000"
              disabled={submitting}
            />
          </div>
          <div>
            <label className="label" htmlFor="supplierWebsite">
              Sitio web
            </label>
            <input
              id="supplierWebsite"
              className="input"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://proveedor.com"
              disabled={submitting}
            />
          </div>
        </div>

        <div className="modal-grid" style={{ marginTop: 14 }}>
          <div>
            <label className="label" htmlFor="commissionMode">
              Comisión habitual
            </label>
            <select
              id="commissionMode"
              className="input"
              value={commissionMode}
              onChange={(e) => setCommissionMode(e.target.value as CommissionMode | "")}
              disabled={submitting}
            >
              <option value="">Sin comisión de referencia</option>
              {COMMISSION_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {COMMISSION_MODE_LABEL[mode]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="commissionValue">
              {commissionMode === "percentage" ? "Porcentaje" : "Monto en USD"}
            </label>
            <input
              id="commissionValue"
              className="input"
              inputMode="decimal"
              value={commissionValue}
              onChange={(e) => setCommissionValue(e.target.value)}
              placeholder={commissionMode === "percentage" ? "10" : "150.00"}
              disabled={submitting || commissionMode === ""}
            />
          </div>
        </div>

        <div style={hintStyle}>
          <Icon name="lock" width={12} height={12} />
          Es una referencia para precargar cotizaciones nuevas. Cambiarla no toca las
          ya emitidas.
        </div>

        <label className="label" htmlFor="supplierNotes" style={{ marginTop: 14 }}>
          Notas internas
        </label>
        <textarea
          id="supplierNotes"
          className="input"
          rows={3}
          style={{ resize: "vertical", lineHeight: 1.6 }}
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          placeholder="Condiciones de pago, contacto de referencia, plazos…"
          disabled={submitting}
        />

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={submitting || needsServiceTypes || badCommission}
          >
            {submitting ? "Guardando…" : editing ? "Guardar cambios" : "Crear proveedor"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ──────────── Eliminar proveedor · wireframe 13 · HU-PRO-05 · DM-06 ───────── */

/**
 * El botón dice "Eliminar" porque es lo que el usuario cree que hace, pero el
 * sistema desactiva: un proveedor con cotizaciones emitidas no puede
 * desaparecer sin romper el historial. El modal explica exactamente eso, con el
 * número real de cotizaciones que lo usan.
 */
export function DeleteSupplierModal({
  supplier,
  onClose,
  onDeactivated,
}: {
  supplier: Supplier;
  onClose: () => void;
  onDeactivated: (updated: Supplier) => void;
}) {
  const [usage, setUsage] = useState<SupplierUsage | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    crmApi
      .supplierUsage(supplier.id)
      .then(setUsage)
      .catch(() =>
        setError("No se pudo consultar dónde se usa este proveedor. Probá de nuevo."),
      );
  }, [supplier.id]);

  async function handleDeactivate() {
    setSubmitting(true);
    setError(null);
    try {
      onDeactivated(await crmApi.deactivateSupplier(supplier.id));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo desactivar el proveedor.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={
        <>
          <Icon name="trash" style={{ color: "var(--red)" }} />
          Eliminar proveedor
        </>
      }
      onClose={onClose}
    >
      <p className="modal-lead">
        <b>{supplier.name}</b> dejará de ofrecerse al armar cotizaciones nuevas.
      </p>

      {error && (
        <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
          <Icon name="target" />
          <div>{error}</div>
        </div>
      )}

      {usage === null ? (
        <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
          Revisando dónde se usa…
        </div>
      ) : usage.totalQuotes === 0 ? (
        <div className="auth-alert info" style={{ marginBottom: 14 }}>
          <Icon name="check" />
          <div>
            No aparece en ninguna cotización todavía. Aun así se <b>desactiva</b> en vez
            de borrarse, para que el registro exista si mañana se reconstruye un
            histórico.
          </div>
        </div>
      ) : (
        <>
          <div className="auth-alert error" style={{ marginBottom: 14 }}>
            <Icon name="target" />
            <div>
              Está referenciado en <b>{usage.totalQuotes} cotización(es)</b>
              {usage.asAgency > 0 && ` · como agencia en ${usage.asAgency}`}
              {usage.inServiceLines > 0 &&
                ` · en líneas de servicio de ${usage.inServiceLines} versión(es)`}
              . Por eso <b>no se elimina</b>: esas cotizaciones seguirían apuntando a un
              proveedor inexistente.
            </div>
          </div>

          {usage.quotes.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 4 }}>
              <table className="t">
                <thead>
                  <tr>
                    <th>Cotización</th>
                    <th>Cliente</th>
                    <th>Uso</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.quotes.map((quote) => (
                    <tr key={quote.id}>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {quote.code}
                      </td>
                      <td>{quote.clientName ?? "—"}</td>
                      <td>
                        <span className="chip">
                          {quote.role === "agency" ? "Agencia" : "Línea de servicio"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div className="modal-foot">
        <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={() => void handleDeactivate()}
          disabled={submitting || usage === null}
        >
          {submitting ? "Desactivando…" : "Desactivar proveedor"}
        </button>
      </div>
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
