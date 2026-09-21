"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { NuevaVentaModal } from "@/components/NuevaVentaModal";
import { RelativeTime } from "@/components/RelativeTime";
import { SignedFileLink } from "@/components/SignedFileLink";
import { EmptyState, ErrorCard, LoadingCard } from "@/components/StateCards";
import { ApiError } from "@/lib/api/client";
import {
  crmApi,
  formatAmount,
  formatMoney,
  type ConfirmationResult,
  type ConversationSummary,
  type QuoteSummary,
  type SaleDetail,
  type SaleSummary,
  type StoredFileRef,
  type TeamMember,
} from "@/lib/api/crm";
import {
  CHANNEL_LABEL,
  CONVERSATION_STATUS_LABEL,
  FILE_TYPE_LABEL,
  QUOTE_STATUS_CHIP,
  QUOTE_STATUS_LABEL,
  SALE_STATUS_CHIP,
  SALE_STATUS_LABEL,
  type FileType,
} from "@/lib/domain/enums";

/** Clase del chip por canal, igual que en la bandeja. */
const CONVERSATION_CHANNEL_CLASS = { whatsapp: "wa", messenger: "ms", instagram: "ig" } as const;

/*
 * Las cuatro pestañas del expediente · `D3`.
 *
 * Salieron de `ExpedienteView.tsx`, que pasaba de las dos mil líneas y mezclaba
 * la cáscara del expediente con el contenido de cada solapa. Cada una trae sus
 * propios datos y no comparte estado con las demás: son el corte natural.
 */

/**
 * Cotizaciones del expediente · HU-EXP-01.
 *
 * Solo las de este cliente, con el estado y los avisos del listado general para
 * no obligar a saltar de pantalla para saber cómo va cada una.
 */
export function CotizacionesTab({ clientId }: { clientId: string }) {
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    crmApi
      .listQuotes({ clientId, sortBy: "created", sortDir: "desc" })
      .then((page) => setQuotes(page.items))
      .catch(() => setError("No se pudieron cargar las cotizaciones."));
  }, [clientId]);

  if (error) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--red)" }}>
        {error}
      </div>
    );
  }

  if (quotes === null) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--text-mute)" }}>
        Cargando cotizaciones…
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Sin cotizaciones todavía</div>
        <div style={{ fontSize: 13, color: "var(--text-mute)", marginBottom: 18 }}>
          Creá la primera con el cliente ya precargado.
        </div>
        <Link href={`/cotizaciones/nueva?clientId=${clientId}`} className="btn primary">
          <Icon name="doc" />
          Nueva cotización
        </Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead>
            <tr>
              <th>Código</th>
              <th>Destino</th>
              <th>Total</th>
              <th>Ver.</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((quote) => (
              <tr key={quote.id}>
                <td>
                  <Link
                    href={`/cotizaciones/${quote.id}`}
                    className="mono"
                    style={{ fontSize: 12, color: "var(--navy)", fontWeight: 600 }}
                  >
                    {quote.code}
                  </Link>
                </td>
                <td>{quote.destination ?? "—"}</td>
                <td>
                  <b className="num">{formatMoney(quote.finalPrice)}</b>
                </td>
                <td>
                  <span className="chip">v{quote.versionCount}</span>
                </td>
                <td>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className={`chip ${QUOTE_STATUS_CHIP[quote.status]}`}>
                      {QUOTE_STATUS_LABEL[quote.status]}
                    </span>
                    {quote.noAnswer && <span className="chip orange">Sin respuesta</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Ventas del expediente · HU-EXP-06.
 *
 * Muestra el cobro de cada operación, no solo el monto: desde el expediente lo
 * que se consulta es si el cliente quedó a paz y salvo.
 */
export function VentasTab({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const [sales, setSales] = useState<SaleSummary[] | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [creating, setCreating] = useState(false);
  const [saleNotice, setSaleNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    crmApi
      .listSales({ clientId, sortBy: "created", sortDir: "desc" })
      .then((page) => setSales(page.items))
      .catch(() => setError("No se pudieron cargar las ventas."));
  }, [clientId]);

  useEffect(() => {
    load();
    crmApi.team().then(setTeam).catch(() => undefined);
  }, [load]);

  if (error) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--red)" }}>
        {error}
      </div>
    );
  }

  if (sales === null) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--text-mute)" }}>
        Cargando ventas…
      </div>
    );
  }

  return (
    <>
      {sales.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Sin ventas todavía</div>
          <div style={{ fontSize: 13, color: "var(--text-mute)", marginBottom: 18 }}>
            Una venta nace al aceptar una cotización. Si se cerró por fuera, registrala
            directo.
          </div>
          {canEdit && (
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>
              <Icon name="cart" />
              Registrar venta
            </button>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Destino</th>
                  <th>Total</th>
                  <th>Saldo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      <Link
                        href={`/ventas/${sale.id}`}
                        className="mono"
                        style={{ fontSize: 12, color: "var(--navy)", fontWeight: 600 }}
                      >
                        {sale.code}
                      </Link>
                    </td>
                    <td>{sale.destination}</td>
                    <td>
                      <b className="num">{formatMoney(sale.finalPrice)}</b>
                    </td>
                    <td>
                      <span
                        className="num"
                        style={{
                          color:
                            Number(sale.balanceAmount) > 0
                              ? "var(--orange-deep)"
                              : "var(--green)",
                        }}
                      >
                        {Number(sale.balanceAmount) > 0
                          ? formatAmount(sale.balanceAmount)
                          : "Pagada"}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span className={`chip ${SALE_STATUS_CHIP[sale.saleStatus]}`}>
                          {SALE_STATUS_LABEL[sale.saleStatus]}
                        </span>
                        {sale.isPaymentOverdue && (
                          <span className="chip red">Cobro atrasado</span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {saleNotice && (
        <div className="auth-alert info dismissable" style={{ marginBottom: 14 }} role="status">
          <Icon name="check" />
          <div>{saleNotice}</div>
          <button
            type="button"
            className="iconbtn"
            onClick={() => setSaleNotice(null)}
            aria-label="Cerrar aviso"
          >
            <Icon name="x" />
          </button>
        </div>
      )}

      {creating && (
        <NuevaVentaModal
          team={team}
          clientId={clientId}
          onClose={() => setCreating(false)}
          onCreated={(sale, confirmation) => {
            setCreating(false);
            // `A5` · un expediente sin correo no generaba ningún aviso por este
            // camino: la venta se creaba y nadie sabía que no salió nada.
            setSaleNotice(
              confirmation.sent
                ? confirmation.simulated
                  ? `Venta ${sale.code} registrada. La confirmación quedó simulada: el CRM está en modo de prueba de correo.`
                  : `Venta ${sale.code} registrada y confirmación enviada al cliente.`
                : `Venta ${sale.code} registrada, pero NO se envió la confirmación: ${confirmation.error ?? "revisá el correo del expediente."}`,
            );
            load();
          }}
        />
      )}
    </>
  );
}

/**
 * Archivos del expediente · HU-ARC-01 y HU-ARC-02.
 *
 * Junta lo que sube el equipo —pasaportes, comprobantes— con lo que genera el
 * sistema: PDF de cotización, facturas y recibos. Todo el material del cliente
 * en un solo lugar, que es lo que pide el expediente 360°.
 */
export function ArchivosTab({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const [files, setFiles] = useState<StoredFileRef[] | null>(null);
  const [fileType, setFileType] = useState<FileType>("passport");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    crmApi
      .clientFiles(clientId)
      .then(setFiles)
      .catch(() => setError("No se pudieron cargar los archivos."));
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      await crmApi.uploadFile(file, { clientId, fileType });
      load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo subir el archivo.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {canEdit && (
        <div className="card">
          <div className="card-h">
            <span className="ttl">Subir un archivo</span>
          </div>

          {error && (
            <div className="auth-alert error" style={{ marginBottom: 14 }} role="alert">
              <Icon name="target" />
              <div>{error}</div>
            </div>
          )}

          <div className="modal-grid">
            <div>
              <label className="label" htmlFor="fileType">
                Tipo de documento
              </label>
              <select
                id="fileType"
                className="input"
                value={fileType}
                onChange={(e) => setFileType(e.target.value as FileType)}
                disabled={uploading}
              >
                {/* Los PDF que genera el sistema no se suben a mano. */}
                {(["passport", "payment_receipt", "other"] as const).map((type) => (
                  <option key={type} value={type}>
                    {FILE_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="fileInput">
                Archivo
              </label>
              <input
                id="fileInput"
                type="file"
                className="input"
                accept="application/pdf,image/jpeg,image/png"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </div>
          </div>

          <div className="field-hint">
            <Icon name="lock" width={12} height={12} />
            PDF, JPG o PNG hasta 10 MB. Ningún archivo es público: se abre con un enlace
            que caduca.
          </div>
        </div>
      )}

      {files === null ? (
        <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--text-mute)" }}>
          Cargando archivos…
        </div>
      ) : files.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Sin archivos</div>
          <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
            Acá aparecen los pasaportes y comprobantes que subas, y los PDF que genera el
            sistema.
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Tipo</th>
                  <th>Tamaño</th>
                  <th>Subido</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td style={{ fontWeight: 600 }}>{file.originalName}</td>
                    <td>
                      <span className="chip">{FILE_TYPE_LABEL[file.fileType]}</span>
                    </td>
                    <td className="num" style={{ fontSize: 12, color: "var(--text-mute)" }}>
                      {formatBytes(file.sizeBytes)}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-mute)" }}>
                      <RelativeTime iso={file.uploadedAt} />
                    </td>
                    <td>
                      <SignedFileLink
                        fileId={file.id}
                        label="Abrir"
                        fileName={file.originalName}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ───────────────────── Conversaciones del expediente · HU-EXP-05 ──────────── */

/**
 * Las conversaciones de este cliente en los tres canales.
 *
 * El hilo se lee y se atiende en la bandeja: acá está el índice, con un enlace
 * directo que abre la conversación ya seleccionada.
 */
export function ConversacionesTab({ clientId }: { clientId: string }) {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    crmApi
      .listConversations({ clientId, view: "all", pageSize: 100 })
      .then((page) => setConversations(page.items))
      .catch(() => setError("No se pudieron cargar las conversaciones."));
  }, [clientId]);

  if (error) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--red)" }}>
        {error}
      </div>
    );
  }

  if (conversations === null) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--text-mute)" }}>
        Cargando conversaciones…
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Sin conversaciones</div>
        <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
          Este cliente todavía no escribió por WhatsApp, Messenger ni Instagram.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead>
            <tr>
              <th>Canal</th>
              <th>Último mensaje</th>
              <th>Atiende</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {conversations.map((conversation) => (
              <tr key={conversation.id}>
                <td>
                  <span className={`chip ${CONVERSATION_CHANNEL_CLASS[conversation.channel]}`}>
                    {CHANNEL_LABEL[conversation.channel]}
                  </span>
                </td>
                <td style={{ maxWidth: 320 }}>
                  <div className="ellipsis">{conversation.lastMessagePreview ?? "—"}</div>
                  <time
                    dateTime={conversation.lastMessageAt}
                    style={{ fontSize: 11, color: "var(--text-mute)" }}
                  >
                    <RelativeTime iso={conversation.lastMessageAt} />
                  </time>
                </td>
                <td>
                  {conversation.advisor?.fullName ?? <span className="chip amber">Sin asignar</span>}
                </td>
                <td>
                  <span className={`chip ${conversation.status === "resolved" ? "green" : "navy"}`}>
                    {CONVERSATION_STATUS_LABEL[conversation.status]}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link
                    href={`/bandeja?vista=all&conversacion=${conversation.id}`}
                    className="btn ghost tiny"
                  >
                    Abrir en la bandeja
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
