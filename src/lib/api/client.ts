/**
 * Cliente HTTP hacia el backend NestJS.
 *
 * Cada petición debe llevar el ID token de Firebase en `Authorization`. El
 * backend valida sesión y rol en TODA consulta y mutación — la ocultación de
 * controles en la interfaz nunca sustituye esa validación
 * (Modelo de Datos · 12; HU-AUT-05).
 *
 * Se activa en el Sprint 2, cuando exista Firebase Auth. Hasta entonces las
 * pantallas consumen los datos de `src/lib/mock/`.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** ID token de Firebase. */
  token?: string;
  signal?: AbortSignal;
  /** Milisegundos antes de abandonar. Por defecto 15 s. */
  timeoutMs?: number;
};

/**
 * Tiempo máximo de espera.
 *
 * Sin límite, un backend que no responde deja la interfaz girando para siempre:
 * `fetch` no expira solo. Pasó de verdad cuando Atlas dejó de aceptar la IP del
 * servidor — la pantalla se quedaba en "Verificando sesión…" sin explicar nada.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

export async function apiRequest<T>(
  path: string,
  { method = "GET", body, token, signal, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener("abort", () => controller.abort());

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    // Se distingue "no respondió a tiempo" de "no hay servidor": son problemas
    // distintos y el mensaje debe orientar hacia el correcto.
    if ((error as Error)?.name === "AbortError") {
      throw new ApiError(
        0,
        "El servidor no respondió a tiempo. Puede estar caído o sin acceso a la base de datos.",
      );
    }
    throw new ApiError(0, "No se pudo contactar el servidor. Revisá que el API esté corriendo.");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      payload?.message ?? `Error ${response.status} al llamar ${path}`,
      payload,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/**
 * Carga de un archivo · HU-ARC-01.
 *
 * Va aparte de `apiRequest` porque el cuerpo es `multipart/form-data`: fijar
 * `Content-Type` a mano rompe el envío, ya que el navegador tiene que agregar
 * el `boundary` que genera para cada petición.
 */
export async function apiUpload<T>(
  path: string,
  file: File,
  token: string,
  timeoutMs = 60_000,
): Promise<T> {
  const form = new FormData();
  form.append("file", file);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch (error) {
    throw new ApiError(
      0,
      (error as Error)?.name === "AbortError"
        ? "La carga tardó demasiado. Probá con un archivo más liviano."
        : "No se pudo contactar el servidor.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      payload?.message ?? `No se pudo subir el archivo (error ${response.status}).`,
      payload,
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Descarga de un archivo servido por el API · HU-ARC-02.
 *
 * Va aparte de `apiRequest` porque la respuesta es binaria y no JSON. El archivo
 * lo sirve el backend en vez de enlazar a Storage: la URL firmada caduca a los
 * 15 minutos, y el atributo `download` de un enlace no aplica contra otro
 * dominio, así que el PDF se abría en una pestaña en vez de guardarse.
 */
export async function apiDownload(
  path: string,
  token: string,
  timeoutMs = 60_000,
): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new ApiError(
      0,
      (error as Error)?.name === "AbortError"
        ? "La descarga tardó demasiado. Probá de nuevo."
        : "No se pudo contactar el servidor.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      payload?.message ?? `No se pudo descargar el archivo (error ${response.status}).`,
      payload,
    );
  }

  return response.blob();
}

/** Respuesta paginada estándar del backend. */
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
