/**
 * Traducción de errores de Firebase Auth a mensajes para el usuario.
 *
 * Regla de HU-AUT-01: "Con credenciales inválidas se muestra un mensaje sin
 * revelar datos sensibles". Por eso correo inexistente, contraseña incorrecta y
 * credencial inválida devuelven EL MISMO texto: distinguirlos le confirmaría a
 * un atacante qué correos están registrados.
 */

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "Correo o contraseña incorrectos.",
  "auth/invalid-email": "Correo o contraseña incorrectos.",
  "auth/user-disabled": "Esta cuenta está deshabilitada. Contactá al administrador.",
  "auth/too-many-requests":
    "Demasiados intentos fallidos. Esperá unos minutos antes de volver a probar.",
  "auth/network-request-failed":
    "No hay conexión con el servicio de autenticación. Revisá tu red.",
  "auth/missing-password": "Ingresá tu contraseña.",
};

export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code && MESSAGES[code]) return MESSAGES[code];

  if (error instanceof Error && error.message) return error.message;
  return "No se pudo completar la operación. Intentá de nuevo.";
}
