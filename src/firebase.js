// src/firebase.js
import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("auth persistence setup failed:", error);
});

export function isInAppBrowser() {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent || "";
  return /Line|FBAN|FBAV|Instagram/i.test(ua);
}

/* =========================
   Google Login
========================= */
export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

/* =========================
   Email Signup（認証付き）
========================= */
export async function signupWithEmail(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);

  await sendEmailVerification(cred.user);
  await signOut(auth);

  return cred.user;
}

/* =========================
   Email Login（認証チェック付き）
========================= */
export async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);

  if (!cred.user.emailVerified) {
    await sendEmailVerification(cred.user).catch(() => null);
    await signOut(auth);
    throw new Error("メール認証が完了していません");
  }

  return cred.user;
}

export async function sendPasswordReset(email) {
  await sendPasswordResetEmail(auth, email);
}

/* =========================
   Logout
========================= */
export async function logoutFirebase() {
  await signOut(auth);
}

/* =========================
   互換（使ってるから残す）
========================= */
export async function handleGoogleRedirectResult() {
  return null;
}
