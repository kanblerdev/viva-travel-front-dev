"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useSession } from "@/lib/auth/AuthProvider";
import { authErrorMessage } from "@/lib/auth/errors";
import { isFirebaseConfigured } from "@/lib/firebase/client";
import { ApiError } from "@/lib/api/client";

type Mode = "login" | "recover";

export function LoginForm() {
  const router = useRouter();
  const { user, loading, connectionError, signIn, recoverPassword } = useSession();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Si ya hay sesión (o se restauró al recargar), no tiene sentido el login.
  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  const configured = isFirebaseConfigured();

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await signIn(email, password);
      router.replace("/dashboard");
    } catch (caught) {
      // El backend distingue "no registrado en el CRM" de "cuenta desactivada";
      // ese matiz sí es útil mostrarlo, porque la persona ya demostró conocer
      // la contraseña y necesita saber a quién pedirle acceso.
      // El fallo de conexión ya lo muestra su propio aviso: repetirlo acá
      // llenaría la pantalla con el mismo texto dos veces.
      if (caught instanceof ApiError && caught.status === 0) {
        setSubmitting(false);
        return;
      }

      if (caught instanceof ApiError && caught.status === 401) {
        setError(
          caught.message.includes("desactivada")
            ? "Tu cuenta está desactivada. Contactá al administrador."
            : "Tu cuenta no está habilitada en el CRM. Contactá al administrador.",
        );
      } else {
        setError(authErrorMessage(caught));
      }
      setSubmitting(false);
    }
  }

  async function handleRecover(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await recoverPassword(email);
    } catch (caught) {
      // Un correo no registrado NO se distingue de uno válido: revelarlo
      // confirmaría qué cuentas existen (HU-AUT-02).
      const code = (caught as { code?: string })?.code;
      if (code && code !== "auth/user-not-found" && code !== "auth/invalid-email") {
        setError(authErrorMessage(caught));
        setSubmitting(false);
        return;
      }
    }

    setNotice(
      `Si ${email.trim()} corresponde a una cuenta registrada, te llegará un correo con el enlace para restablecer la contraseña.`,
    );
    setMode("login");
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div style={{ color: "var(--text-mute)", fontSize: 14 }}>Verificando sesión…</div>
    );
  }

  return (
    <form
      onSubmit={mode === "login" ? handleLogin : handleRecover}
      style={{ width: "100%", maxWidth: 460 }}
    >
      <div
        style={{
          fontSize: 14,
          color: "var(--text-mute)",
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          marginBottom: 14,
        }}
      >
        {mode === "login" ? "Iniciar sesión" : "Recuperar acceso"}
      </div>
      <h1
        style={{
          margin: 0,
          fontSize: 42,
          fontWeight: 800,
          color: "var(--navy)",
          letterSpacing: "-0.02em",
        }}
      >
        {mode === "login" ? "Bienvenido de vuelta" : "Restablecé tu contraseña"}
      </h1>
      <p style={{ fontSize: 16, color: "var(--text-mute)", marginTop: 12 }}>
        {mode === "login"
          ? "Ingresá con tu cuenta corporativa para continuar."
          : "Te enviamos un enlace al correo con el que ingresás al CRM."}
      </p>

      {connectionError && (
        <div className="auth-alert error" style={{ marginTop: 24 }} role="alert">
          <Icon name="target" />
          <div>
            <b>Sin conexión con el servidor.</b> {connectionError}
          </div>
        </div>
      )}

      {!configured && (
        <div className="auth-alert error" style={{ marginTop: 24 }}>
          <Icon name="shield" />
          <div>
            Firebase no está configurado. Completá las variables{" "}
            <b>NEXT_PUBLIC_FIREBASE_*</b> en <code>.env.local</code>.
          </div>
        </div>
      )}

      {notice && (
        <div className="auth-alert info" style={{ marginTop: 24 }}>
          <Icon name="mail" />
          <div>{notice}</div>
        </div>
      )}

      {error && (
        <div className="auth-alert error" style={{ marginTop: 24 }} role="alert">
          <Icon name="target" />
          <div>{error}</div>
        </div>
      )}

      <div style={{ marginTop: 30 }}>
        <label className="label" htmlFor="email" style={{ fontSize: 13 }}>
          Correo corporativo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          className="input"
          style={{ padding: "14px 16px", fontSize: 14 }}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setNotice(null);
          }}
          autoComplete="email"
          placeholder="nombre@vivatravel.com.sv"
          disabled={submitting || !configured}
        />
      </div>

      {mode === "login" && (
        <div style={{ marginTop: 18 }}>
          <label className="label" htmlFor="password" style={{ fontSize: 13 }}>
            Contraseña
          </label>
          <div style={{ position: "relative" }}>
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              className="input"
              style={{ padding: "14px 46px 14px 16px", fontSize: 14 }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={submitting || !configured}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: 0,
                padding: 8,
                cursor: "pointer",
                color: "var(--text-mute)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Icon name="eye" width={18} height={18} />
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          marginTop: 18,
          fontSize: 13,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "recover" : "login");
            setError(null);
            setNotice(null);
          }}
          style={{
            color: "var(--orange)",
            fontWeight: 600,
            background: "transparent",
            border: 0,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 13,
            padding: 0,
          }}
        >
          {mode === "login" ? "¿Olvidaste tu contraseña?" : "Volver a iniciar sesión"}
        </button>
      </div>

      <button
        type="submit"
        className="btn primary"
        disabled={submitting || !configured}
        style={{
          width: "100%",
          marginTop: 28,
          padding: 16,
          fontSize: 15,
          justifyContent: "center",
          opacity: submitting || !configured ? 0.6 : 1,
        }}
      >
        {submitting
          ? "Verificando…"
          : mode === "login"
            ? "Ingresar al CRM"
            : "Enviar enlace de recuperación"}
        {!submitting && <Icon name="arrow-right" />}
      </button>

      <div
        style={{
          marginTop: 28,
          paddingTop: 24,
          borderTop: "1px solid var(--border)",
          fontSize: 13,
          color: "var(--text-mute)",
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <Icon name="lock" width={14} height={14} style={{ color: "var(--green)" }} />
        Acceso protegido con Firebase Auth y permisos por rol
      </div>
    </form>
  );
}
