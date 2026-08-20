"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence, type Auth } from "firebase/auth";

/**
 * Cliente de Firebase Auth para el navegador.
 *
 * Estos valores son públicos por diseño: identifican al proyecto, no autorizan
 * nada. Quien controla el acceso es el backend, que valida el ID token y
 * resuelve el rol contra la colección `users` en CADA petición (HU-AUT-05).
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error(
      "Firebase no está configurado. Completá las variables NEXT_PUBLIC_FIREBASE_* en .env.local",
    );
  }
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

let authInstance: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
    // Persistencia local: la sesión sobrevive al cierre de la pestaña. El límite
    // real de 12 h lo impone la cookie `vt-session` (DV-10).
    void setPersistence(authInstance, browserLocalPersistence);
  }
  return authInstance;
}

/**
 * ID token vigente del usuario, o null si no hay sesión.
 *
 * El SDK lo renueva solo cuando está por expirar (los tokens de Firebase duran
 * una hora), así que se puede llamar antes de cada petición sin costo.
 */
export async function getIdToken(): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  const user = getFirebaseAuth().currentUser;
  return user ? user.getIdToken() : null;
}
