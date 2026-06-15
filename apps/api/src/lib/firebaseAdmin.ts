import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { env } from "../config/env.js";

function init() {
  if (getApps().length > 0) return;
  if (env.firebaseServiceAccountJson) {
    const sa = JSON.parse(env.firebaseServiceAccountJson) as object;
    initializeApp({ credential: cert(sa as Parameters<typeof cert>[0]) });
  } else if (env.firebaseProjectId) {
    initializeApp({ projectId: env.firebaseProjectId });
  } else {
    throw new Error("Firebase is not configured. Set FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT_JSON.");
  }
}

export function getFirebaseAuth() {
  init();
  return getAuth();
}
