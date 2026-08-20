"use client";

import { useState } from "react";
import { Icon } from "./Icon";

/**
 * Teléfono y correo, accionables.
 *
 * Eran texto plano: el asesor seleccionaba con el mouse, copiaba y pegaba en
 * WhatsApp, varias veces por día. Para una agencia cuyo canal principal es
 * WhatsApp, el enlace directo es de lo más barato que se puede agregar.
 */

/** Deja solo dígitos: `wa.me` no acepta espacios, guiones ni el `+`. */
function digitsOf(phone: string): string {
  return phone.replace(/\D/g, "");
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="contact-action"
      title={`Copiar ${label}`}
      aria-label={`Copiar ${label}`}
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          // Sin permiso de portapapeles no hay nada que hacer, pero tampoco hay
          // nada que romper: el número sigue seleccionable a mano.
          .catch(() => undefined);
      }}
    >
      <Icon name={copied ? "check" : "paperclip"} />
    </button>
  );
}

export function PhoneLinks({ phone }: { phone: string | null }) {
  if (!phone) return <span style={{ color: "var(--text-faint)" }}>—</span>;

  const digits = digitsOf(phone);

  return (
    <span className="contact-links">
      <span className="mono">{phone}</span>
      {digits.length >= 8 && (
        <>
          <a
            className="contact-action wa"
            href={`https://wa.me/${digits}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Escribir por WhatsApp"
            aria-label="Escribir por WhatsApp"
          >
            <Icon name="mail" />
          </a>
          <a
            className="contact-action"
            href={`tel:${digits}`}
            title="Llamar"
            aria-label="Llamar"
          >
            <Icon name="phone" />
          </a>
        </>
      )}
      <CopyButton value={phone} label="el teléfono" />
    </span>
  );
}

export function EmailLinks({ email }: { email: string | null }) {
  if (!email) return <span style={{ color: "var(--text-faint)" }}>—</span>;

  return (
    <span className="contact-links">
      <a href={`mailto:${email}`} className="contact-value">
        {email}
      </a>
      <CopyButton value={email} label="el correo" />
    </span>
  );
}
