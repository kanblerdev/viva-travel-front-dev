/**
 * Funciones que se publican por entorno, no por código.
 *
 * `NEXT_PUBLIC_*` se incrusta durante el build: cambiar el valor en Vercel exige
 * un redeploy, pero no tocar una línea.
 */

/**
 * La bandeja en el menú · Sprint 6.
 *
 * Visible por defecto, también en producción y aunque Meta todavía no esté
 * conectada (decisión del 16 de septiembre de 2026). Para que una bandeja vacía
 * no parezca rota, la propia pantalla explica el estado de la conexión.
 *
 * `NEXT_PUBLIC_MESSAGING_ENABLED=false` la saca del menú si alguna vez hace falta
 * esconderla. La ruta `/bandeja` responde igual por URL.
 */
export const MESSAGING_ENABLED = process.env.NEXT_PUBLIC_MESSAGING_ENABLED !== "false";
