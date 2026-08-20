"use client";

import { Icon } from "./Icon";
import { useSidebar } from "./AppShell";

export function MobileMenuButton() {
  const { toggle, open } = useSidebar();
  return (
    <button
      type="button"
      className="mobile-menu-btn iconbtn"
      onClick={toggle}
      aria-label={open ? "Cerrar menú" : "Abrir menú"}
      aria-expanded={open}
    >
      <Icon name="menu" />
    </button>
  );
}
