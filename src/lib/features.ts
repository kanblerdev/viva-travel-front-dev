/**
 * Funciones que se publican por entorno, no por código.
 *
 * `NEXT_PUBLIC_*` se incrusta durante el build: cambiar el valor en Vercel exige
 * un redeploy, pero no tocar una línea.
 */

/**
 * La bandeja en el menú · Sprint 6.
 *
 * Está construida y conectada al API, pero en producción no recibe nada hasta
 * que la app de Meta apunte su webhook al servidor. Mostrarla antes llevaría al
 * equipo a una bandeja vacía que parece rota. Se enciende en el entorno donde
 * Meta ya está conectado —o en desarrollo, con `npm run meta:simulate`—. La ruta
 * `/bandeja` responde igual por URL.
 */
export const MESSAGING_ENABLED = process.env.NEXT_PUBLIC_MESSAGING_ENABLED === "true";
