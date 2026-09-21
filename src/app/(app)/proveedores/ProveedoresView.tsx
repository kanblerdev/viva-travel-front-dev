"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { EmptyState, ErrorCard, LoadingCard } from "@/components/StateCards";
import { useSession } from "@/lib/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import { crmApi, type Supplier, type SupplierFilters } from "@/lib/api/crm";
import {
  COMMISSION_MODE_LABEL,
  SERVICE_TYPES,
  SERVICE_TYPE_LABEL,
  SUPPLIER_TYPES,
  SUPPLIER_TYPE_LABEL,
  type ServiceType,
  type SupplierType,
} from "@/lib/domain/enums";
import { DeleteSupplierModal, SupplierFormModal } from "./modals";

const TYPE_STYLE: Record<SupplierType, { bg: string; color: string }> = {
  agency: { bg: "var(--orange-soft)", color: "var(--orange-deep)" },
  tourism_service: { bg: "var(--blue-bg)", color: "var(--blue)" },
};

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function ProveedoresView() {
  const { user } = useSession();
  const [filters, setFilters] = useState<SupplierFilters>({});
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<Supplier | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * El catálogo lo gestionan Gerente y Administrador (matriz 4.2). El Asesor
   * puede crear —necesita al mayorista con el que cotiza hoy— y consultar.
   * Ocultar los botones no autoriza nada: el backend lo revalida.
   */
  const canManage = user !== null && user.role !== "advisor";

  const filterKey = JSON.stringify(filters);

  const load = useCallback(async () => {
    setError(null);
    try {
      const parsed = JSON.parse(filterKey) as SupplierFilters;
      const page = await crmApi.listSuppliers({ ...parsed, pageSize: 200 });
      setSuppliers(page.items);
      setTotal(page.total);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "No se pudo cargar el catálogo de proveedores.",
      );
      setSuppliers([]);
    }
  }, [filterKey]);

  useEffect(() => {
    void load();
  }, [load]);

  function setFilter(key: keyof SupplierFilters, value: string) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === "") delete next[key];
      else next[key] = value as never;
      return next;
    });
  }

  function replaceSupplier(updated: Supplier) {
    setSuppliers((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)) ?? null);
  }

  async function activate(supplier: Supplier) {
    setBusyId(supplier.id);
    setActionError(null);
    try {
      replaceSupplier(await crmApi.activateSupplier(supplier.id));
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : "No se pudo reactivar el proveedor.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== "");
  const showingInactive = filters.status === "inactive";

  return (
    <>
      <div className="filterbar">
        <input
          className="selectfilter"
          style={{ minWidth: 220 }}
          placeholder="Buscar por nombre, correo o teléfono…"
          value={filters.search ?? ""}
          onChange={(e) => setFilter("search", e.target.value)}
          aria-label="Buscar proveedor"
        />

        <select
          className="selectfilter"
          value={filters.type ?? ""}
          onChange={(e) => setFilter("type", e.target.value)}
          aria-label="Filtrar por tipo"
        >
          <option value="">Tipo</option>
          {SUPPLIER_TYPES.map((t) => (
            <option key={t} value={t}>
              {SUPPLIER_TYPE_LABEL[t]}
            </option>
          ))}
        </select>

        <select
          className="selectfilter"
          value={filters.serviceType ?? ""}
          onChange={(e) => setFilter("serviceType", e.target.value)}
          aria-label="Filtrar por servicio"
        >
          <option value="">Servicio</option>
          {SERVICE_TYPES.map((s) => (
            <option key={s} value={s}>
              {SERVICE_TYPE_LABEL[s]}
            </option>
          ))}
        </select>

        <select
          className="selectfilter"
          value={filters.status ?? ""}
          onChange={(e) => setFilter("status", e.target.value)}
          aria-label="Filtrar por estado"
        >
          <option value="">Activos</option>
          <option value="inactive">Desactivados</option>
        </select>

        {hasFilters && (
          <button type="button" className="selectfilter" onClick={() => setFilters({})}>
            Limpiar filtros
            <Icon name="x" />
          </button>
        )}

        <span className="count">
          {suppliers === null
            ? "Cargando…"
            : `${total} ${showingInactive ? "desactivados" : "activos"}`}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setFormTarget(null);
            setShowForm(true);
          }}
        >
          <Icon name="plus" />
          Nuevo proveedor
        </button>
      </div>

      {actionError && (
        <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
          <Icon name="target" />
          <div>{actionError}</div>
        </div>
      )}

      {error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : suppliers === null ? (
        <LoadingCard>Cargando proveedores…</LoadingCard>
      ) : suppliers.length === 0 ? (
        <EmptyState
          icon="truck"
          title={hasFilters ? "Sin coincidencias" : "Todavía no hay proveedores"}
          hint={
            hasFilters
              ? "Ajustá o limpiá los filtros para ver el catálogo completo."
              : "Registrá las agencias mayoristas y los proveedores de servicios con los que trabajás."
          }
          action={
            hasFilters ? (
              <button type="button" className="btn ghost" onClick={() => setFilters({})}>
                Limpiar filtros
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setFormTarget(null);
                  setShowForm(true);
                }}
              >
                <Icon name="plus" />
                Nuevo proveedor
              </button>
            )
          }
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 14,
          }}
        >
          {suppliers.map((supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              canManage={canManage}
              busy={busyId === supplier.id}
              onEdit={() => {
                setFormTarget(supplier);
                setShowForm(true);
              }}
              onDelete={() => setDeleteTarget(supplier)}
              onActivate={() => void activate(supplier)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <SupplierFormModal
          supplier={formTarget}
          onClose={() => setShowForm(false)}
          onSaved={(saved) => {
            setShowForm(false);
            // Un alta puede caer fuera del filtro actual, así que se recarga en
            // vez de insertarla a mano en la lista.
            if (formTarget) replaceSupplier(saved);
            else void load();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteSupplierModal
          supplier={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeactivated={(updated) => {
            setDeleteTarget(null);
            // Sale del listado de activos: recargar mantiene el conteo honesto.
            if (filters.status === undefined) void load();
            else replaceSupplier(updated);
          }}
        />
      )}
    </>
  );
}

function SupplierCard({
  supplier,
  canManage,
  busy,
  onEdit,
  onDelete,
  onActivate,
}: {
  supplier: Supplier;
  canManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onActivate: () => void;
}) {
  const style = TYPE_STYLE[supplier.type];
  const inactive = supplier.status === "inactive";

  return (
    <div className="card" style={{ opacity: busy ? 0.5 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: style.bg,
            color: style.color,
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', monospace",
            flex: "none",
          }}
        >
          {initialsOf(supplier.name)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{supplier.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-mute)" }}>
            {SUPPLIER_TYPE_LABEL[supplier.type]}
          </div>
        </div>
        <span
          className={`chip ${inactive ? "" : "green"}`}
          style={{ marginLeft: "auto", flex: "none" }}
        >
          {inactive ? "Desactivado" : "Activo"}
        </span>
      </div>

      {supplier.serviceTypes.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
          {supplier.serviceTypes.map((service: ServiceType) => (
            <span key={service} className="chip">
              {SERVICE_TYPE_LABEL[service]}
            </span>
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 12,
          color: "var(--text-mute)",
        }}
      >
        <div style={contactRow}>
          <Icon name="mail" width={13} height={13} />
          {supplier.contacts.emails[0] ?? "—"}
        </div>
        <div style={contactRow}>
          <Icon name="phone" width={13} height={13} />
          {supplier.contacts.phones[0] ?? supplier.contacts.whatsapp ?? "—"}
        </div>
        {supplier.contacts.website && (
          <div style={contactRow}>
            <Icon name="globe" width={13} height={13} />
            {supplier.contacts.website}
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--border-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 12,
        }}
      >
        <span style={{ color: "var(--text-mute)" }}>
          {supplier.defaultCommission ? (
            <>
              Comisión{" "}
              <b style={{ color: "var(--text)" }}>
                {supplier.defaultCommission.mode === "percentage"
                  ? `${supplier.defaultCommission.value} %`
                  : `$${supplier.defaultCommission.value}`}
              </b>{" "}
              <span style={{ color: "var(--text-faint)" }}>
                {COMMISSION_MODE_LABEL[supplier.defaultCommission.mode].toLowerCase()}
              </span>
            </>
          ) : (
            "Sin comisión de referencia"
          )}
        </span>

        {canManage && (
          <span style={{ display: "flex", gap: 6 }}>
            {inactive ? (
              <button type="button" className="btn ghost tiny" onClick={onActivate} disabled={busy}>
                Reactivar
              </button>
            ) : (
              <>
                <button type="button" className="btn ghost tiny" onClick={onEdit} disabled={busy}>
                  <Icon name="edit" />
                  Editar
                </button>
                <button type="button" className="btn ghost tiny" onClick={onDelete} disabled={busy}>
                  <Icon name="trash" />
                </button>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

const contactRow = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;
