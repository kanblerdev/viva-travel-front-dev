"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth/AuthProvider";

/**
 * Puerta de acceso a las rutas privadas.
 *
 * El middleware ya redirige cuando falta la cookie de sesión, pero esa cookie es
 * solo una marca: no prueba nada. Esta comprobación cierra los casos que el
 * middleware no puede ver — sesión expirada mientras la pestaña estaba abierta,
 * cuenta desactivada por un administrador, cierre de sesión en otra pestaña.
 *
 * No es una medida de seguridad: es evitarle al usuario una pantalla llena de
 * errores. Los datos los protege el backend, que valida token y rol en cada
 * petición (HU-AUT-05).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, connectionError } = useSession();
  const router = useRouter();

  useEffect(() => {
    // Un fallo de conexión NO es una sesión inválida: mandar al login solo
    // esconde el problema y hace creer que la cuenta dejó de servir.
    if (!loading && !user && !connectionError) router.replace("/login");
  }, [loading, user, connectionError, router]);

  if (!loading && connectionError) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div className="card" style={{ maxWidth: 440, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, margin: "0 0 10px", color: "var(--navy)" }}>
            No hay conexión con el servidor
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-mute)", lineHeight: 1.6, margin: 0 }}>
            {connectionError}
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => window.location.reload()}
            style={{ width: "100%", justifyContent: "center", marginTop: 22 }}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (loading || !user) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "var(--text-mute)",
          fontSize: 14,
        }}
      >
        {loading ? "Verificando sesión…" : "Redirigiendo al inicio de sesión…"}
      </div>
    );
  }

  return <>{children}</>;
}
