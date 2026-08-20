"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ApiError } from "@/lib/api/client";
import { crmApi } from "@/lib/api/crm";

/**
 * Abrir y descargar un archivo del expediente · HU-ARC-02.
 *
 * Ningún archivo es público. Hasta el Sprint 8 este componente pedía la URL
 * firmada AL MONTAR y la dejaba en un enlace, lo que traía dos problemas que solo
 * se notaban con la pantalla abierta un rato (hallazgo F3):
 *
 *  1. La URL caduca a los 15 minutos. Un botón pulsado media hora después
 *     llevaba a un error de Storage, sin explicación.
 *  2. El atributo `download` no funciona contra otro dominio, así que el botón
 *     de descarga ABRÍA el PDF en una pestaña en vez de guardarlo.
 *
 * Ahora cada acción resuelve lo suyo en el momento del clic: abrir pide una URL
 * fresca, y descargar pasa por el API, que lo sirve como adjunto con su nombre
 * real y con la sesión del CRM autorizando.
 */
export function SignedFileLink({
  fileId,
  label,
  fileName,
  showDownload = true,
}: {
  fileId: string;
  label: string;
  fileName: string;
  showDownload?: boolean;
}) {
  const [busy, setBusy] = useState<"open" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy("open");
    setError(null);
    try {
      const file = await crmApi.fileUrl(fileId);
      window.open(file.url, "_blank", "noopener");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo abrir.");
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy("download");
    setError(null);
    try {
      const blob = await crmApi.downloadFile(fileId);
      // El blob va a un enlace temporal del MISMO origen, que es la única forma
      // de que `download` se respete y el archivo se guarde con su nombre.
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo descargar.");
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <span style={{ fontSize: 11, color: "var(--red)" }} role="alert">
        {error}
      </span>
    );
  }

  return (
    <span style={{ display: "flex", gap: 6 }}>
      <button
        type="button"
        className="btn ghost tiny"
        onClick={() => void open()}
        disabled={busy !== null}
      >
        <Icon name="eye" />
        {busy === "open" ? "Abriendo…" : label}
      </button>
      {showDownload && (
        <button
          type="button"
          className="btn ghost tiny"
          onClick={() => void download()}
          disabled={busy !== null}
          aria-label={`Descargar ${fileName}`}
        >
          <Icon name="download" />
        </button>
      )}
    </span>
  );
}
