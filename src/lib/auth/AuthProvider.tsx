"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase/client";
import { apiRequest, ApiError } from "@/lib/api/client";
import { SESSION_COOKIE } from "@/lib/session";
import type { UserRole } from "@/lib/domain/enums";

/** Perfil que devuelve `GET /auth/me` — la fuente de verdad del rol. */
export type SessionUser = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  initials: string;
  session: { maxAgeMinutes: number; expireOnInactivity: boolean };
};

type AuthState = {
  user: SessionUser | null;
  /** true mientras se resuelve la sesión inicial: evita parpadeos de contenido. */
  loading: boolean;
  /**
   * Falla de infraestructura, distinta de "no hay sesión".
   *
   * Sin esto, un backend caído se veía igual que un usuario deslogueado: la
   * pantalla mandaba a iniciar sesión cuando el problema real era otro.
   */
  connectionError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  recoverPassword: (email: string) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function useSession(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useSession debe usarse dentro de <AuthProvider>.");
  }
  return context;
}

/**
 * Atributos comunes de la marca de sesión.
 *
 * `Secure` solo cuando la página ya va por HTTPS: en producción impide que la
 * marca viaje en claro, y en `localhost` el navegador descartaría la cookie
 * —dejando al middleware sin nada que leer y al usuario en un bucle de login—.
 */
function cookieFlags(): string {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  return `path=/; SameSite=Lax${secure}`;
}

/**
 * Marca de sesión que lee el middleware.
 *
 * NO es una credencial: no contiene el token ni autoriza nada. Solo permite que
 * el middleware —que corre en el edge y no puede verificar firmas JWT— decida a
 * qué pantalla mandar al usuario. Si alguien la falsifica, verá el armazón de la
 * aplicación y cada llamada al API le devolverá 401: los datos siguen protegidos
 * porque la autorización real ocurre en el backend (HU-AUT-05).
 */
function setSessionCookie(maxAgeMinutes: number): void {
  document.cookie = `${SESSION_COOKIE}=1; ${cookieFlags()}; max-age=${maxAgeMinutes * 60}`;
}

function clearSessionCookie(): void {
  document.cookie = `${SESSION_COOKIE}=; ${cookieFlags()}; max-age=0`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  /** Trae el perfil del backend. Solo él conoce el rol y el estado del usuario. */
  const loadProfile = useCallback(async (path: "/auth/me" | "/auth/login") => {
    const token = await getFirebaseAuth().currentUser?.getIdToken();
    if (!token) throw new Error("No hay sesión activa.");

    const profile = await apiRequest<SessionUser>(path, {
      method: path === "/auth/login" ? "POST" : "GET",
      token,
    });

    setSessionCookie(profile.session.maxAgeMinutes);
    setUser(profile);
    return profile;
  }, []);

  // Sincroniza el estado con Firebase: cubre el arranque, la renovación
  // automática del token y el cierre de sesión desde otra pestaña.
  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setLoading(false);
      return;
    }

    return onIdTokenChanged(getFirebaseAuth(), async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        clearSessionCookie();
        setLoading(false);
        return;
      }

      try {
        await loadProfile("/auth/me");
        setConnectionError(null);
      } catch (error) {
        // Autenticado en Firebase pero rechazado por el CRM: la cuenta no está
        // registrada en `users` o fue desactivada. No debe quedar en un limbo
        // con la interfaz visible y todas las peticiones fallando.
        if (error instanceof ApiError && error.status === 401) {
          await signOut(getFirebaseAuth()).catch(() => undefined);
          clearSessionCookie();
          setUser(null);
        } else {
          // El API no respondió. La sesión de Firebase sigue siendo válida, así
          // que no se cierra: se informa y se ofrece reintentar.
          setConnectionError(
            error instanceof ApiError
              ? error.message
              : "No se pudo contactar el servidor.",
          );
        }
      } finally {
        setLoading(false);
      }
    });
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      try {
        // `POST /auth/login` además registra el último acceso (HU-AUT-04).
        await loadProfile("/auth/login");
        setConnectionError(null);
      } catch (error) {
        // status 0 = no hubo respuesta. Se marca como fallo de conexión para
        // que la pantalla lo muestre UNA vez, y no como error de credenciales.
        if (error instanceof ApiError && error.status === 0) {
          setConnectionError(error.message);
        }
        throw error;
      }
    },
    [loadProfile],
  );

  const logout = useCallback(async () => {
    await signOut(getFirebaseAuth()).catch(() => undefined);
    clearSessionCookie();
    setUser(null);
    // Navegación dura, no del router: descarta cualquier página privada que el
    // navegador tenga en caché, para que "atrás" no muestre datos (HU-AUT-03).
    window.location.replace("/login");
  }, []);

  const recoverPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
  }, []);

  const value = useMemo(
    () => ({ user, loading, connectionError, signIn, logout, recoverPassword }),
    [user, loading, connectionError, signIn, logout, recoverPassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
