"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";
import { useSidebar } from "./AppShell";
import { BACKOFFICE_URL } from "@/lib/session";
import { useSession } from "@/lib/auth/AuthProvider";
import { crmApi } from "@/lib/api/crm";
import { MESSAGING_ENABLED } from "@/lib/features";
import { usePolling } from "@/lib/hooks/usePolling";
import type { UserRole } from "@/lib/domain/enums";
import { USER_ROLE_LABEL } from "@/lib/domain/enums";

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Contador de conversaciones sin asignar (HU-NAV-04). */
  badge?: number;
  /** Roles que ven la opción. Sin valor = todos. */
  roles?: UserRole[];
  external?: boolean;
};

type NavGroup = { title: string; items: NavItem[] };

/**
 * Arquitectura de información del Levantamiento Funcional · 5.1
 * y wireframe 02 (agrupación PRINCIPAL / CRM / COMUNICACIÓN / ANÁLISIS Y SISTEMA).
 *
 * Configuración vive en el proyecto `backoffice/` y solo la ve el Administrador.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    title: "PRINCIPAL",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" }],
  },
  {
    title: "CRM",
    items: [
      { href: "/clientes", label: "Clientes", icon: "users" },
      { href: "/cotizaciones", label: "Cotizaciones", icon: "doc" },
      { href: "/ventas", label: "Ventas", icon: "cart" },
      { href: "/proveedores", label: "Proveedores", icon: "truck" },
    ],
  },
  ...(MESSAGING_ENABLED
    ? [
        {
          title: "COMUNICACIÓN",
          items: [{ href: "/bandeja", label: "Bandeja", icon: "kanban" } as NavItem],
        },
      ]
    : []),
  {
    title: "ANÁLISIS Y SISTEMA",
    items: [
      { href: "/reportes", label: "Reportes", icon: "chart" },
      {
        href: BACKOFFICE_URL,
        label: "Configuración",
        icon: "settings",
        roles: ["admin"],
        external: true,
      },
    ],
  },
];

/** Cada cuánto se refresca el contador de sin asignar del menú. */
const UNASSIGNED_POLL_MS = 30_000;

export function Sidebar() {
  const pathname = usePathname();
  const { open, close } = useSidebar();
  const { user, logout } = useSession();
  const [unassigned, setUnassigned] = useState(0);

  // HU-NAV-04: el número de conversaciones que nadie atiende. Un fallo no se
  // muestra: el contador es un aviso, y el menú no puede romperse por él.
  usePolling(
    async () => {
      const counts = await crmApi.conversationCounts().catch(() => null);
      if (counts) setUnassigned(counts.unassigned);
    },
    UNASSIGNED_POLL_MS,
    MESSAGING_ENABLED && Boolean(user),
  );

  return (
    <aside className={`sidebar${open ? " open" : ""}`}>
      <div className="sidebar-head">
        <Link href="/dashboard" className="brand" style={{ textDecoration: "none" }}>
          <Image
            src="/assets/viva-logo.png"
            alt="Viva Travel"
            width={36}
            height={36}
            style={{ height: 36, width: "auto" }}
            priority
          />
          <div className="name">
            <b>VIVA TRAVEL</b>
            <span>CRM INTEGRAL</span>
          </div>
        </Link>
        <button
          type="button"
          className="sidebar-close"
          aria-label="Cerrar menú"
          onClick={close}
        >
          <Icon name="x" width={18} height={18} />
        </button>
      </div>

      <nav className="sidebar-nav">
        {NAV_GROUPS.map((group) => {
          const visible = group.items.filter(
            (item) => !item.roles || (user && item.roles.includes(user.role)),
          );
          if (visible.length === 0) return null;

          return (
            <div key={group.title} className="sidebar-group">
              <div className="sidebar-group-title">{group.title}</div>
              {visible.map((item) => {
                const isActive =
                  !item.external &&
                  (pathname === item.href || pathname.startsWith(`${item.href}/`));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={isActive ? "active" : undefined}
                    {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                    {(item.href === "/bandeja" ? unassigned : item.badge) ? (
                      <span
                        className="nav-badge"
                        aria-label={item.href === "/bandeja" ? `${unassigned} sin asignar` : undefined}
                      >
                        {item.href === "/bandeja" ? unassigned : item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="user-foot">
        <div className="av">{user?.initials ?? "··"}</div>
        <div className="who">
          <b>{user?.fullName ?? "Cargando…"}</b>
          <span>{user ? USER_ROLE_LABEL[user.role] : ""}</span>
        </div>
        <button
          type="button"
          className="logout"
          aria-label="Cerrar sesión"
          onClick={() => void logout()}
          style={{ marginLeft: "auto" }}
        >
          <Icon name="logout" width={16} height={16} />
        </button>
      </div>
    </aside>
  );
}
