// src/observationStore.js
import {
  addDoc,
  collection,
  serverTimestamp,
  updateDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "./firebase";

/* =========================================================
   JST dayIndex / epochMs helper
   - day: JST(+09) の 0:00 区切りで dayIndex
   - t:   epoch milliseconds（保存の主軸）
   - secOfDay: 表示・デバッグ用（任意）
========================================================= */
export function jstDayAndEpochMs(ms = Date.now()) {
  const JST = 9 * 60 * 60 * 1000;

  const tMs = Number(ms);
  const safeMs = Number.isFinite(tMs) ? tMs : Date.now();

  const day = Math.floor((safeMs + JST) / 86400000);

  const d = new Date(safeMs + JST);
  const secOfDay =
    d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();

  const t = safeMs; // epoch milliseconds

  return { day, t, secOfDay };
}

/* =========================================================
   互換用 alias
   - 既存importを壊さないため
   - 名前は Sec だが返す t は「ms」
========================================================= */
export const jstDayAndEpochSec = jstDayAndEpochMs;

/* =========================================================
   route signal obsCount update
   - users/{uid}/routes/{routeId}.signals[].obsCount を +1
   - 1回の通過につき1回だけ呼ぶ
========================================================= */
async function incrementSignalObsCount(uid, routeId, signalId) {
  if (!uid) throw new Error("incrementSignalObsCount: uid missing");
  if (!routeId) throw new Error("incrementSignalObsCount: routeId missing");
  if (!signalId) throw new Error("incrementSignalObsCount: signalId missing");

  const routeRef = doc(db, "users", uid, "routes", routeId);
  const snap = await getDoc(routeRef);
  if (!snap.exists()) return;

  const route = snap.data();
  const signals = Array.isArray(route?.signals) ? route.signals : [];
  if (signals.length === 0) return;

  let changed = false;

  const nextSignals = signals.map((s) => {
    if (s?.id !== signalId) return s;

    const prev = Number(s?.obsCount);
    const obsCount = Number.isFinite(prev) ? prev + 1 : 1;
    changed = true;

    return {
      ...s,
      obsCount,
    };
  });

  if (!changed) return;

  await updateDoc(routeRef, {
    signals: nextSignals,
    updatedAt: serverTimestamp(),
  });
}

/* =========================================================
   low-level save (generic)
========================================================= */
export async function saveObservation(uid, routeId, obs) {
  if (!uid) throw new Error("saveObservation: uid missing");
  if (!routeId) throw new Error("saveObservation: routeId missing");
  if (!obs) throw new Error("saveObservation: obs missing");

  const ref = collection(db, "users", uid, "routes", routeId, "observations");

  const payload = {
    ...obs,
    createdAt: serverTimestamp(),
  };

  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k];
  }

  const docRef = await addDoc(ref, payload);
  return docRef.id;
}

/* =========================================================
   RED observation
   - start: 赤で到着した瞬間に作る（arrival ms 確定）
   - finish: 青になって出発した瞬間に埋める（green ms 確定）

   保存形式（red）:
     {
       signalId,
       color: "red",
       day,
       t,          // arrival epoch ms
       nextGreen,  // green epoch ms
       wait        // ms
     }

   ※ 観測の本質は arrival(t) と nextGreen
   ※ wait は nextGreen - t の派生量
========================================================= */
export async function startRedObservation(
  uid,
  routeId,
  signalId,
  msArrive = Date.now(),
) {
  if (!uid) throw new Error("startRedObservation: uid missing");
  if (!routeId) throw new Error("startRedObservation: routeId missing");
  if (!signalId) throw new Error("startRedObservation: signalId missing");

  const { day, t } = jstDayAndEpochMs(msArrive);

  const obsId = await saveObservation(uid, routeId, {
    signalId,
    color: "red",
    day,
    t,
    nextGreen: null,
    wait: null,
  });

  // 1通過につき1回だけ加算
  await incrementSignalObsCount(uid, routeId, signalId);

  return obsId;
}

/**
 * 赤観測を完了（青開始で確定）
 * @param arrivalEpochMs startRedObservation 時点の arrival ms
 * @param msGreen 青開始の epoch ms
 */
export async function finishRedObservation(
  uid,
  routeId,
  redObsId,
  arrivalEpochMs,
  msGreen = Date.now(),
) {
  if (!uid) throw new Error("finishRedObservation: uid missing");
  if (!routeId) throw new Error("finishRedObservation: routeId missing");
  if (!redObsId) throw new Error("finishRedObservation: redObsId missing");

  const { t: nextGreen } = jstDayAndEpochMs(msGreen);

  const tArrive = Number(arrivalEpochMs);
  const w =
    Number.isFinite(tArrive) && Number.isFinite(nextGreen)
      ? Math.max(0, nextGreen - tArrive)
      : null;

  const ref = doc(
    db,
    "users",
    uid,
    "routes",
    routeId,
    "observations",
    redObsId,
  );

  const payload = {
    nextGreen,
    wait: w,
    updatedAt: serverTimestamp(),
  };

  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k];
  }

  await updateDoc(ref, payload);
}

/* =========================================================
   BLUE observation (pass on green)

   保存形式（blue）:
     {
       signalId,
       color: "blue",
       day,
       t  // pass epoch ms
     }
========================================================= */
export async function saveBlueObservation(
  uid,
  routeId,
  signalId,
  msPass = Date.now(),
) {
  if (!uid) throw new Error("saveBlueObservation: uid missing");
  if (!routeId) throw new Error("saveBlueObservation: routeId missing");
  if (!signalId) throw new Error("saveBlueObservation: signalId missing");

  const { day, t } = jstDayAndEpochMs(msPass);

  const obsId = await saveObservation(uid, routeId, {
    signalId,
    color: "blue",
    day,
    t,
  });

  // 1通過につき1回だけ加算
  await incrementSignalObsCount(uid, routeId, signalId);

  return obsId;
}

/* =========================================================
   optional: 色の正規化ユーティリティ（互換用）
========================================================= */
export function normalizeObsColor(c) {
  const x = String(c ?? "").toLowerCase();
  if (x === "green") return "blue";
  return x;
}
