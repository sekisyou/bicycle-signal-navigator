// src/routesStore.js
import {
  addDoc,
  collection,
  getDocs,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  where,
  limit,
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "./firebase";

/* =========================================================
   helpers
========================================================= */

function normalizeSignalForRouteSave(signal) {
  if (!signal || typeof signal !== "object") return signal;

  return {
    ...signal,
    obsCount: Number.isFinite(Number(signal.obsCount))
      ? Number(signal.obsCount)
      : 0,
  };
}

function normalizeRoutePayload(route) {
  if (!route || typeof route !== "object") return route;

  return {
    ...route,
    signals: Array.isArray(route.signals)
      ? route.signals.map(normalizeSignalForRouteSave)
      : [],
  };
}

/* =========================================================
   ROUTES
========================================================= */

/**
 * users/{uid}/routes に保存
 */
export async function saveRoute(uid, route) {
  if (!uid) throw new Error("saveRoute: uid is required");
  if (!route) throw new Error("saveRoute: route is required");

  const ref = collection(db, "users", uid, "routes");

  const normalized = normalizeRoutePayload(route);

  const payload = {
    ...normalized,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(ref, payload);
  return docRef.id;
}

/**
 * users/{uid}/routes を新しい順に取得
 */
export async function listRoutes(uid) {
  if (!uid) throw new Error("listRoutes: uid is required");

  const ref = collection(db, "users", uid, "routes");
  const q = query(ref, orderBy("createdAt", "desc"));
  const snap = await getDocs(q);

  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));
}

/**
 * ルート名の重複チェック
 */
export async function routeNameExists(uid, name, excludeRouteId = null) {
  if (!uid) throw new Error("routeNameExists: uid is required");

  const n = (name ?? "").trim();
  if (!n) return false;

  const ref = collection(db, "users", uid, "routes");
  const q = query(ref, where("name", "==", n), limit(10));
  const snap = await getDocs(q);

  if (snap.empty) return false;

  const docs = snap.docs.filter((d) => d.id !== excludeRouteId);
  return docs.length > 0;
}

/**
 * 既存ルート更新
 */
export async function updateRoute(uid, routeId, data) {
  if (!uid) throw new Error("updateRoute: uid is required");
  if (!routeId) throw new Error("updateRoute: routeId is required");
  if (!data) throw new Error("updateRoute: data is required");

  const ref = doc(db, "users", uid, "routes", routeId);
  const normalized = normalizeRoutePayload(data);

  await updateDoc(ref, {
    ...normalized,
    updatedAt: serverTimestamp(),
  });
}

/**
 * ルート1件取得
 */
export async function getRoute(uid, routeId) {
  if (!uid) throw new Error("getRoute: uid is required");
  if (!routeId) throw new Error("getRoute: routeId is required");

  const ref = doc(db, "users", uid, "routes", routeId);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    ...snap.data(),
  };
}

/**
 * ルート削除
 */
export async function deleteRoute(uid, routeId) {
  if (!uid) throw new Error("deleteRoute: uid is required");
  if (!routeId) throw new Error("deleteRoute: routeId is required");

  const ref = doc(db, "users", uid, "routes", routeId);
  await deleteDoc(ref);
}

/* =========================================================
   OBSERVATIONS（Nav / inferTG 用）
========================================================= */

function toSecOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n / 1000 : null;
}

function normalizeBlueObsDoc(x, fallbackSignalId) {
  const tSec = toSecOrNull(x?.t);
  if (!Number.isFinite(tSec)) return null;

  return {
    signalId: x?.signalId ?? fallbackSignalId,
    day: Number.isFinite(Number(x?.day)) ? Number(x.day) : null,
    t: tSec,
    color: "blue",
    wait: null,
    nextGreen: null,
  };
}

function normalizeRedObsDoc(x, fallbackSignalId) {
  const tSec = toSecOrNull(x?.t);
  if (!Number.isFinite(tSec)) return null;

  const nextGreenSec = toSecOrNull(x?.nextGreen);
  const waitSec = toSecOrNull(x?.wait);

  return {
    signalId: x?.signalId ?? fallbackSignalId,
    day: Number.isFinite(Number(x?.day)) ? Number(x.day) : null,
    t: tSec,
    color: "red",
    wait: Number.isFinite(waitSec) ? waitSec : null,
    nextGreen: Number.isFinite(nextGreenSec) ? nextGreenSec : null,
  };
}

/**
 * inferTG 用の観測取得
 *
 * Firestore 側では
 * - t: ms
 * - nextGreen: ms
 * - wait: ms
 * で保存されている前提
 *
 * inferTG には sec 単位で返す
 *
 * 返却形式:
 * { signalId, day, t, color, wait?, nextGreen? }
 */
export async function getObsForInferSignalUnified(
  uid,
  routeId,
  signalId,
  { maxRed = 30, maxBlue = 10 } = {},
) {
  if (!uid) throw new Error("getObsForInferSignalUnified: uid required");
  if (!routeId) {
    throw new Error("getObsForInferSignalUnified: routeId required");
  }
  if (!signalId) {
    throw new Error("getObsForInferSignalUnified: signalId required");
  }

  const ref = collection(db, "users", uid, "routes", routeId, "observations");

  const qRed = query(
    ref,
    where("signalId", "==", signalId),
    where("color", "==", "red"),
    orderBy("t", "desc"),
    limit(maxRed),
  );

  const qGreen = query(
    ref,
    where("signalId", "==", signalId),
    where("color", "==", "green"),
    orderBy("t", "desc"),
    limit(maxBlue),
  );

  const qBlue = query(
    ref,
    where("signalId", "==", signalId),
    where("color", "==", "blue"),
    orderBy("t", "desc"),
    limit(maxBlue),
  );

  const [snapRed, snapGreen, snapBlue] = await Promise.all([
    getDocs(qRed),
    getDocs(qGreen).catch(() => null),
    getDocs(qBlue).catch(() => null),
  ]);

  const obs = [];

  snapRed.forEach((d) => {
    const x = d.data();
    const item = normalizeRedObsDoc(x, signalId);
    if (item && Number.isFinite(item.day)) obs.push(item);
  });

  if (snapGreen) {
    snapGreen.forEach((d) => {
      const x = d.data();
      const item = normalizeBlueObsDoc(x, signalId);
      if (item && Number.isFinite(item.day)) obs.push(item);
    });
  }

  if (snapBlue) {
    snapBlue.forEach((d) => {
      const x = d.data();
      const item = normalizeBlueObsDoc(x, signalId);
      if (item && Number.isFinite(item.day)) obs.push(item);
    });
  }

  obs.sort((a, b) => a.day - b.day || a.t - b.t);

  return obs;
}

/** 互換用 alias */
export const getRouteById = getRoute;
