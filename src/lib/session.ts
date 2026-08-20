/**
 * Constantes de sesión del CRM.
 *
 * El perfil del usuario ya NO vive acá: lo entrega el backend en `/auth/me` y se
 * consume con `useSession()` de `@/lib/auth/AuthProvider`. Firebase Auth valida
 * la identidad y el backend resuelve el rol contra la colección `users`.
 */

/**
 * Marca que lee el middleware para saber a qué pantalla mandar al usuario.
 *
 * No contiene el token ni ninguna credencial. La autorización real ocurre en el
 * backend en cada petición (HU-AUT-05).
 */
export const SESSION_COOKIE = "vt-session";

/** URL del panel administrativo (proyecto `backoffice/`). */
export const BACKOFFICE_URL =
  process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "http://localhost:3001";
