import { getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;

export const isFirebaseConfigured = Boolean(apiKey && projectId);

const app =
  isFirebaseConfigured && getApps().length === 0
    ? initializeApp({
        apiKey,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
        projectId,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
        appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
      })
    : getApps()[0] ?? null;

export const firebaseAuth = app ? getAuth(app) : null;

export const googleProvider = (() => {
  const p = new GoogleAuthProvider();
  p.addScope("profile");
  p.addScope("email");
  return p;
})();
