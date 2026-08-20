"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { crmApi, type ClientSummary } from "@/lib/api/crm";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";

/**
 * Buscador de expediente contra el servidor · hallazgo E1.
 *
 * Reemplaza a un `<select>` que traía los primeros 200 expedientes: con la
 * cartera real, el cliente que se buscaba podía sencillamente no estar en la
 * lista, y no había forma de llegar a él sin salir del editor.
 *
 * El cliente no se cambia una vez creada la cotización —es la identidad del
 * documento—, así que en edición se muestra fijo.
 */
export function ClientPicker({
  value,
  selected,
  disabled,
  locked,
  onSelect,
}: {
  value: string;
  /** Expediente ya elegido, para poder mostrar su nombre sin volver a pedirlo. */
  selected: ClientSummary | null;
  disabled?: boolean;
  /** En edición el cliente es fijo. */
  locked?: boolean;
  onSelect: (client: ClientSummary | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ClientSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebouncedValue(term, 300);
  const boxRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  // Cerrar al hacer clic afuera. Sin esto la lista queda flotando sobre el
  // formulario y tapa los campos de abajo.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const ticket = ++requestId.current;

    setError(null);
    crmApi
      .listClients({ search: debounced.trim() || undefined, pageSize: 20 })
      .then((page) => {
        if (ticket === requestId.current) setResults(page.items);
      })
      .catch(() => {
        if (ticket === requestId.current) {
          setError("No se pudieron cargar los expedientes.");
          setResults([]);
        }
      });
  }, [open, debounced]);

  if (locked) {
    return (
      <div className="input" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="lock" width={12} height={12} style={{ color: "var(--text-faint)" }} />
        <span style={{ fontWeight: 600 }}>{selected?.fullName ?? "—"}</span>
      </div>
    );
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="input"
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current);
          setTerm("");
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          textAlign: "left",
          cursor: disabled ? "default" : "pointer",
          fontFamily: "inherit",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon name="search" width={13} height={13} style={{ color: "var(--text-faint)" }} />
        <span
          style={{
            flex: 1,
            color: selected ? "var(--text)" : "var(--text-faint)",
            fontWeight: selected ? 600 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {selected?.fullName ?? "Buscá el expediente…"}
        </span>
        {selected && !disabled && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Quitar el expediente"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onSelect(null);
              }
            }}
            style={{ display: "flex", color: "var(--text-faint)" }}
          >
            <Icon name="x" width={12} height={12} />
          </span>
        )}
      </button>

      {open && (
        <div className="picker-pop" role="listbox">
          <input
            className="input"
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Nombre, teléfono o correo…"
            aria-label="Buscar expediente"
          />

          <div className="picker-list">
            {error ? (
              <div className="picker-empty" style={{ color: "var(--red)" }}>
                {error}
              </div>
            ) : results === null ? (
              <div className="picker-empty">Buscando…</div>
            ) : results.length === 0 ? (
              <div className="picker-empty">
                Sin coincidencias.
                <br />
                Creá el expediente antes de cotizarlo.
              </div>
            ) : (
              results.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  role="option"
                  aria-selected={client.id === value}
                  className={`picker-item${client.id === value ? " is-active" : ""}`}
                  onClick={() => {
                    onSelect(client);
                    setOpen(false);
                  }}
                >
                  <b>{client.fullName}</b>
                  {(client.primaryEmail || client.primaryPhone) && (
                    <span className="picker-item-sub">
                      {client.primaryEmail ?? client.primaryPhone}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
