"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { RelativeTime } from "@/components/RelativeTime";
import { EmailLinks, PhoneLinks } from "@/components/ContactLinks";
import { ApiError } from "@/lib/api/client";
import { crmApi, formatAmount, type SaleSummary } from "@/lib/api/crm";

/**
 * Agenda de cobro.
 *
 * El listado responde "cuánto falta cobrar". Esta vista responde la pregunta que
 * el equipo se hace de verdad cada mañana: **a quién llamo hoy**.
 *
 * Tres decisiones que la separan de una tabla ordenada por fecha:
 *
 *  1. Se agrupa por URGENCIA, no por fecha. "Vence el 14" no dice nada sin
 *     mirar el calendario; "vence esta semana" sí.
 *  2. El teléfono y el WhatsApp van en la fila. Sin eso cada gestión obliga a
 *     abrir el expediente, copiar el número y volver.
 *  3. Registra que ya se llamó. Sin esa marca, la agenda no distingue al
 *     cliente con el que nadie habló del que dijo que paga el viernes, y el
 *     equipo vuelve a llamar a los mismos todos los días.
 *
 * ⚠️ No envía nada ni programa recordatorios: los avisos automáticos siguen
 * fuera de alcance (Plan de Sprints · 14).
 */

type Bucket = {
  key: string;
  title: string;
  hint: string;
  tone: "red" | "amber" | "blue" | "mute";
  sales: SaleSummary[];
};

/** Días que faltan para el vencimiento, contra el FIN del día comprometido. */
function daysUntil(iso: string): number {
  const due = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function group(sales: SaleSummary[]): Bucket[] {
  const overdue: SaleSummary[] = [];
  const thisWeek: SaleSummary[] = [];
  const later: SaleSummary[] = [];
  const undated: SaleSummary[] = [];

  for (const sale of sales) {
    if (!sale.paymentDueDate) undated.push(sale);
    else {
      const days = daysUntil(sale.paymentDueDate);
      if (days < 0) overdue.push(sale);
      else if (days <= 7) thisWeek.push(sale);
      else later.push(sale);
    }
  }

  return [
    {
      key: "overdue",
      title: "Vencidas",
      hint: "El plazo ya pasó",
      tone: "red",
      sales: overdue,
    },
    {
      key: "week",
      title: "Vencen esta semana",
      hint: "En los próximos 7 días",
      tone: "amber",
      sales: thisWeek,
    },
    {
      key: "later",
      title: "Más adelante",
      hint: "Con plazo futuro",
      tone: "blue",
      sales: later,
    },
    {
      key: "undated",
      title: "Sin fecha límite",
      hint: "Nadie les puso plazo: conviene acordarlo",
      tone: "mute",
      sales: undated,
    },
  ].filter((bucket) => bucket.sales.length > 0) as Bucket[];
}

export function AgendaCobro({
  sales,
  onLogged,
}: {
  sales: SaleSummary[];
  onLogged: () => void;
}) {
  const buckets = group(sales);

  if (buckets.length === 0) {
    return (
      <div className="card" style={{ padding: 48, textAlign: "center" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Nada por cobrar</div>
        <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
          Ninguna venta de esta selección tiene saldo pendiente.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {buckets.map((bucket) => (
        <div className="card" key={bucket.key}>
          <div className="card-h">
            <span className="ttl">{bucket.title}</span>
            <span className={`chip ${bucket.tone === "mute" ? "" : bucket.tone}`}>
              {bucket.sales.length}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: "auto" }}>
              {bucket.hint}
            </span>
          </div>

          <div className="agenda">
            {bucket.sales.map((sale) => (
              <AgendaRow key={sale.id} sale={sale} onLogged={onLogged} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgendaRow({ sale, onLogged }: { sale: SaleSummary; onLogged: () => void }) {
  const [logging, setLogging] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = sale.paymentDueDate ? daysUntil(sale.paymentDueDate) : null;

  async function log() {
    setBusy(true);
    setError(null);
    try {
      await crmApi.logCollectionContact(sale.id, note.trim() || undefined);
      setLogging(false);
      setNote("");
      onLogged();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo registrar la gestión.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="agenda-row">
      <div className="agenda-who">
        <Link href={`/ventas/${sale.id}`} className="mono agenda-code">
          {sale.code}
        </Link>
        <div className="agenda-client">
          {sale.client ? (
            <Link href={`/clientes/${sale.client.id}`}>{sale.client.name}</Link>
          ) : (
            "—"
          )}
        </div>
        <div className="agenda-meta">
          {sale.destination}
          {sale.advisor ? ` · ${sale.advisor.name}` : ""}
        </div>
      </div>

      <div className="agenda-amount">
        <b className="num">{formatAmount(sale.balanceAmount)}</b>
        <span className="agenda-when">
          {days === null
            ? "sin plazo"
            : days < 0
              ? `${Math.abs(days)} ${Math.abs(days) === 1 ? "día" : "días"} de atraso`
              : days === 0
                ? "vence hoy"
                : `en ${days} ${days === 1 ? "día" : "días"}`}
        </span>
      </div>

      <div className="agenda-contact">
        <PhoneLinks phone={sale.clientContact?.phone ?? null} />
        <EmailLinks email={sale.clientContact?.email ?? null} />
      </div>

      <div className="agenda-action">
        {sale.lastCollectionContactAt && !logging && (
          <span className="agenda-last" title={sale.lastCollectionNote ?? undefined}>
            <Icon name="check" width={11} height={11} />
            <RelativeTime iso={sale.lastCollectionContactAt} />
          </span>
        )}
        {logging ? (
          <div className="agenda-log">
            <input
              className="input"
              value={note}
              autoFocus
              placeholder="Dijo que deposita el viernes…"
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") void log();
                if (e.key === "Escape") setLogging(false);
              }}
            />
            <button type="button" className="btn primary tiny" disabled={busy} onClick={() => void log()}>
              {busy ? "…" : "Guardar"}
            </button>
            <button
              type="button"
              className="btn ghost tiny"
              disabled={busy}
              onClick={() => setLogging(false)}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" className="btn ghost tiny" onClick={() => setLogging(true)}>
            Registrar gestión
          </button>
        )}
        {error && <span style={{ color: "var(--red)", fontSize: 11 }}>{error}</span>}
      </div>
    </div>
  );
}
