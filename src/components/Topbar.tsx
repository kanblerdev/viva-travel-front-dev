"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "./Icon";
import { MobileMenuButton } from "./MobileMenuButton";
import { useSession } from "@/lib/auth/AuthProvider";
import { USER_ROLE_LABEL } from "@/lib/domain/enums";
import type { ReactNode } from "react";

/**
 * Miga de pan · hallazgo `G4`.
 *
 * `href` la convierte en enlace. Antes ninguna lo era: desde el detalle de una
 * venta la única salida al listado era el menú lateral, y el botón "Volver"
 * solo existía en la pantalla de error.
 */
type Crumb = { label: string; href?: string; current?: boolean };

type Props = {
  crumbs: Crumb[];
  showSearch?: boolean;
  rightExtras?: ReactNode;
};

/**
 * Barra superior.
 *
 * El buscador era un `div` con texto adentro: parecía un campo, invitaba a
 * escribir y no hacía nada. Ahora busca de verdad, y busca CLIENTES — que es lo
 * único que hay para buscar hasta que llegue la búsqueda global (HU-NAV-03, y
 * depende de módulos del Sprint 6). El texto dice exactamente eso: un control
 * que promete menos y cumple vale más que uno que promete todo y no responde.
 */
export function Topbar({ crumbs, showSearch = true, rightExtras }: Props) {
  const { user } = useSession();
  const router = useRouter();
  const [term, setTerm] = useState("");

  function search(event: FormEvent) {
    event.preventDefault();
    const query = term.trim();
    router.push(query ? `/clientes?search=${encodeURIComponent(query)}` : "/clientes");
  }

  return (
    <div className="topbar">
      <MobileMenuButton />
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span
            key={i}
            className={i < crumbs.length - 1 ? "crumb-prev" : undefined}
            style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
          >
            {c.current ? (
              <b>{c.label}</b>
            ) : c.href ? (
              <Link href={c.href} className="crumb-link">
                {c.label}
              </Link>
            ) : (
              <span>{c.label}</span>
            )}
            {i < crumbs.length - 1 && <span className="sep">›</span>}
          </span>
        ))}
      </div>
      <div className="grow" />
      {showSearch && (
        <form className="searchbox" onSubmit={search} role="search">
          <Icon name="search" />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar un cliente por nombre, teléfono o correo…"
            aria-label="Buscar un cliente"
          />
        </form>
      )}
      {rightExtras && <span className="topbar-extras">{rightExtras}</span>}
      <button type="button" className="iconbtn topbar-bell" aria-label="Notificaciones">
        <Icon name="bell" />
        <span className="bullet" />
      </button>
      <div className="userpill">
        <div className="av">{user?.initials ?? "··"}</div>
        <div className="who">
          {user?.fullName ?? "Cargando…"}
          <span>{user ? USER_ROLE_LABEL[user.role] : ""}</span>
        </div>
      </div>
    </div>
  );
}
